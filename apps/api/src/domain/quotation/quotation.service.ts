/**
 * Quotation service.
 *
 * The quotation is the aggregate root of the whole platform. Every mutation flows
 * through `recalculateQuote`, which is the *only* writer of the derived columns
 * and therefore the place where DOMAIN_MODEL.md invariant 10 ("quote totals must
 * be derivable from persisted lines and pricing rules") is guaranteed.
 *
 * ## States and who may act
 *
 * - Sales Rep (or Admin) creates and edits a quote in `DRAFT` / `REVISION_REQUIRED`.
 * - `confirm` runs the risk engine and either approves automatically (risk in the
 *   `NONE` band) or raises the approval chain and moves to `PENDING_APPROVAL`.
 * - Approvers act through the approval service, not here.
 * - Customer negotiation applies versioned changes through the portal service,
 *   which calls `applyNegotiation`.
 *
 * ## Versioning
 *
 * The version counter is bumped by `recalculateQuote` when a caller asks for a
 * material change, and every bump writes an immutable `quotation_versions`
 * snapshot of the *pre-mutation* state first — so an approval can always be
 * checked against the exact terms that produced it (AGENT_INSTRUCTIONS.md §7).
 */

import { and, count, desc, eq, sql } from 'drizzle-orm';
import {
  approvalInstances,
  negotiationRequests,
  quotationLines,
  quotationVersions,
  quotations,
} from '@/db/schema/index.js';
import type { DbExecutor } from '@/db/client.js';
import { apportionPaise, multiplyPaise, sumPaise } from '@dealflow/shared';
import type { NegotiationRequestType } from '@dealflow/shared';
import { writeAudit, type AuditActor } from '../audit/audit.service.js';
import { resolveEffectiveCeiling, resolveProductPricing, strictestCeilingBp } from '../pricing/pricing.service.js';
import { classifyRisk, computeBlendedRisk, type RiskBreakdown } from '../risk/risk-engine.js';
import { loadSettingsMap } from '../config/settings-map.js';
import { badRequest, conflict, forbidden, notFound } from '@/lib/errors.js';

export interface QuotationActor extends AuditActor {
  userId: string;
}

export interface LineDerivedTotals {
  grossAmountPaise: number;
  discountAmountPaise: number;
  orderDiscountAmountPaise: number;
  netAmountPaise: number;
  taxAmountPaise: number;
  lineTotalPaise: number;
  costAmountPaise: number;
  marginPaise: number;
}

export interface QuoteTotals {
  subtotalPaise: number;
  discountTotalPaise: number;
  taxTotalPaise: number;
  grandTotalPaise: number;
  oneTimeSubtotalPaise: number;
  oneTimeGrandTotalPaise: number;
  recurringSubtotalPaise: number;
  recurringGrandTotalPaise: number;
  estimatedCostPaise: number;
  marginPaise: number;
  marginBp: number;
}

type QuoteWithDetails = NonNullable<Awaited<ReturnType<typeof getQuotation>>>;

// ---------------------------------------------------------------- queries

export interface QuoteListFilters {
  customerId?: string;
  salesRepId?: string;
  status?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export async function listQuotations(exec: DbExecutor, filters: QuoteListFilters = {}) {
  const conditions: ReturnType<typeof sql>[] = [];
  if (filters.customerId) conditions.push(sql`${quotations.customerId} = ${filters.customerId}`);
  if (filters.salesRepId) conditions.push(sql`${quotations.salesRepId} = ${filters.salesRepId}`);
  if (filters.status) conditions.push(sql`${quotations.status} = ${filters.status}`);
  if (filters.from) conditions.push(sql`${quotations.createdAt} >= ${filters.from.toISOString()}`);
  if (filters.to) conditions.push(sql`${quotations.createdAt} <= ${filters.to.toISOString()}`);

  const rows = await exec
    .select()
    .from(quotations)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(quotations.createdAt))
    .limit(filters.limit ?? 100)
    .offset(filters.offset ?? 0);

  return rows;
}

/** Load a quotation with everything attached. */
export async function getQuotation(exec: DbExecutor, quotationId: string) {
  const row = await exec.query.quotations.findFirst({
    where: (table, { eq }) => eq(table.id, quotationId),
    with: { lines: true, customer: true, salesRep: true, approvals: true, negotiations: true },
  });
  return row ?? null;
}

/** Load for mutation — mandates the quote still exists. */
export async function requireQuotation(exec: DbExecutor, quotationId: string): Promise<QuoteWithDetails> {
  const row = await getQuotation(exec, quotationId);
  if (!row) throw notFound('QUOTE_NOT_FOUND', `Quotation ${quotationId} does not exist`);
  return row;
}

async function nextQuoteNumber(exec: DbExecutor): Promise<string> {
  const rows = await exec.select({ total: count() }).from(quotations);
  return `Q${String(((rows[0]?.total as number) ?? 0) + 1).padStart(4, '0')}`;
}

async function loadApprovalBands(exec: DbExecutor) {
  const rows = await exec.query.approvalRules.findMany({
    where: (table, { eq }) => eq(table.active, true),
  });
  return rows.map((row) => ({
    minRiskBp: row.minRiskBp,
    maxRiskBp: row.maxRiskBp,
    requiredLevel: row.requiredLevel,
    priority: row.priority,
  }));
}

// ---------------------------------------------------------------- creation

export interface CreateQuotationInput {
  customerId: string;
  salesRepId: string;
  notes?: string;
  promisedDeliveryDate?: Date;
  orderDiscountBp?: number;
}

export async function createQuotation(exec: DbExecutor, input: CreateQuotationInput) {
  const customer = await exec.query.customers.findFirst({
    where: (table, { eq }) => eq(table.id, input.customerId),
  });
  if (!customer) throw notFound('CUSTOMER_NOT_FOUND', 'Customer does not exist');
  if (!customer.active) throw badRequest('CUSTOMER_INACTIVE', 'Customer is inactive');

  const quoteNumber = await nextQuoteNumber(exec);

  const [quote] = await exec
    .insert(quotations)
    .values({
      quoteNumber,
      customerId: input.customerId,
      salesRepId: input.salesRepId,
      orderDiscountBp: input.orderDiscountBp ?? 0,
      notes: input.notes ?? null,
      promisedDeliveryDate: input.promisedDeliveryDate ?? null,
      status: 'DRAFT',
    })
    .returning();
  if (!quote) throw new Error('Failed to create quotation');

  return quote;
}

// ---------------------------------------------------------------- recalculation engine

/**
 * Recompute every derived value of a quotation from its persisted lines.
 *
 * All integer arithmetic via the shared money helpers — exact by construction.
 */
export async function recalculateQuote(
  exec: DbExecutor,
  quotationId: string,
  options: { bumpVersion: boolean; reason?: string },
) {
  const quote = await requireQuotation(exec, quotationId);
  const lines = await exec.query.quotationLines.findMany({
    where: (table, { eq }) => eq(table.quotationId, quotationId),
    orderBy: (table, { asc }) => [asc(table.position)],
  });

  if (options.bumpVersion) {
    await snapshotVersion(exec, quote);
  }

  const tier = await exec.query.customers.findFirst({
    where: (table, { eq }) => eq(table.id, quote.customerId),
    with: { tier: true },
  });
  if (!tier?.tier) throw badRequest('CUSTOMER_NO_TIER', 'Customer has no configured tier');

  const lineRows: {
    line: QuoteWithDetails['lines'][number];
    ceilingBp: number;
    ceilingRuleId: string | null;
    violationBp: number;
    gross: number;
    lineDiscount: number;
    orderShare: number;
    net: number;
    tax: number;
    lineTotal: number;
    cost: number;
    margin: number;
  }[] = [];

  const ceilings: number[] = [];
  const riskLines: {
    lineId: string;
    productName: string;
    discountBp: number;
    effectiveCeilingBp: number;
    netAmountPaise: number;
  }[] = [];

  for (const line of lines) {
    const ceiling = await resolveEffectiveCeiling(exec, { tierId: tier.tier.id, categoryId: line.categoryId });
    ceilings.push(ceiling.ceilingBp);
    const gross = multiplyPaise(line.unitPricePaise, line.quantity);
    const lineDiscount = Math.round((gross * line.discountBp) / 10000);
    lineRows.push({
      line,
      ceilingBp: ceiling.ceilingBp,
      ceilingRuleId: ceiling.ruleId,
      violationBp: Math.max(0, line.discountBp - ceiling.ceilingBp),
      gross,
      lineDiscount,
      orderShare: 0,
      net: 0,
      tax: 0,
      lineTotal: 0,
      cost: multiplyPaise(line.unitCostPaise, line.quantity),
      margin: 0,
    });
  }

  const settings = await loadSettingsMap(exec);
  const weights = settings.riskWeights;

  // Order-level discount apportioned across lines proportional to pre-order net.
  const totalNetBeforeOrder = sumPaise(lineRows.map((row) => row.gross - row.lineDiscount));
  const orderDiscountTotal = Math.round((totalNetBeforeOrder * quote.orderDiscountBp) / 10000);
  const orderShares = apportionPaise(
    orderDiscountTotal,
    lineRows.map((row) => Math.max(0, row.gross - row.lineDiscount)),
  );

  let oneTimeGross = 0;
  let recurringGross = 0;
  let oneTimeTotal = 0;
  let recurringTotal = 0;

  for (let index = 0; index < lineRows.length; index += 1) {
    const row = lineRows[index];
    const share = orderShares[index] ?? 0;
    if (!row) continue;

    row.orderShare = share;
    row.net = row.gross - row.lineDiscount - share;
    row.tax = Math.round((row.net * row.line.taxBp) / 10000);
    row.lineTotal = row.net + row.tax;
    row.margin = row.net - row.cost;

    riskLines.push({
      lineId: row.line.id,
      productName: row.line.productName,
      discountBp: row.line.discountBp,
      effectiveCeilingBp: row.ceilingBp,
      netAmountPaise: row.net,
    });

    if (row.line.lineType === 'ONE_TIME') {
      oneTimeGross += row.gross;
      oneTimeTotal += row.lineTotal;
    } else {
      recurringGross += row.gross;
      recurringTotal += row.lineTotal;
    }
  }

  const totals: QuoteTotals = {
    subtotalPaise: sumPaise(lineRows.map((row) => row.gross)),
    discountTotalPaise: sumPaise(lineRows.map((row) => row.lineDiscount + row.orderShare)),
    taxTotalPaise: sumPaise(lineRows.map((row) => row.tax)),
    grandTotalPaise: sumPaise(lineRows.map((row) => row.lineTotal)),
    oneTimeSubtotalPaise: oneTimeGross,
    oneTimeGrandTotalPaise: oneTimeTotal,
    recurringSubtotalPaise: recurringGross,
    recurringGrandTotalPaise: recurringTotal,
    estimatedCostPaise: sumPaise(lineRows.map((row) => row.cost)),
    marginPaise: 0,
    marginBp: 0,
  };
  const netTotal = totals.grandTotalPaise - totals.taxTotalPaise;
  totals.marginPaise = netTotal - totals.estimatedCostPaise;
  totals.marginBp = netTotal > 0 ? Math.round((totals.marginPaise / netTotal) * 10000) : 0;

  const orderCeiling = strictestCeilingBp(ceilings);
  const risk: RiskBreakdown = computeBlendedRisk({
    lines: riskLines,
    orderDiscountBp: quote.orderDiscountBp,
    orderCeilingBp: orderCeiling,
    weights,
  });
  const requiredLevel = classifyRisk(risk.totalBp, await loadApprovalBands(exec));
  const newVersion = options.bumpVersion ? quote.version + 1 : quote.version;

  /**
   * Sequential, not `Promise.all`: `exec` is normally a transaction, and a
   * transaction is pinned to one connection. Firing these concurrently makes
   * node-postgres queue them on a busy client (deprecated in pg 8, removed in 9)
   * for no gain — the round trips are serialised either way.
   */
  for (const row of lineRows) {
    await exec
      .update(quotationLines)
      .set({
        effectiveCeilingBp: row.ceilingBp,
        ceilingRuleId: row.ceilingRuleId,
        violationBp: row.violationBp,
        grossAmountPaise: row.gross,
        discountAmountPaise: row.lineDiscount,
        orderDiscountAmountPaise: row.orderShare,
        netAmountPaise: row.net,
        taxAmountPaise: row.tax,
        lineTotalPaise: row.lineTotal,
        costAmountPaise: row.cost,
        marginPaise: row.margin,
      })
      .where(eq(quotationLines.id, row.line.id));
  }

  await exec
    .update(quotations)
    .set({
      ...totals,
      riskScoreBp: risk.totalBp,
      riskBreakdown: risk,
      requiredApprovalLevel: requiredLevel,
      version: newVersion,
      updatedAt: new Date(),
    })
    .where(eq(quotations.id, quotationId));

  return { risk, requiredLevel, newVersion, totals };
}

async function snapshotVersion(exec: DbExecutor, quote: QuoteWithDetails) {
  const { lines, approvals, negotiations, ...core } = quote;
  void approvals;
  void negotiations;

  return exec.insert(quotationVersions).values({
    quotationId: core.id,
    version: core.version,
    snapshot: {
      quoteNumber: core.quoteNumber,
      status: core.status,
      version: core.version,
      orderDiscountBp: core.orderDiscountBp,
      totals: {
        subtotalPaise: core.subtotalPaise,
        discountTotalPaise: core.discountTotalPaise,
        taxTotalPaise: core.taxTotalPaise,
        grandTotalPaise: core.grandTotalPaise,
        oneTimeGrandTotalPaise: core.oneTimeGrandTotalPaise,
        recurringSubtotalPaise: core.recurringSubtotalPaise,
        recurringGrandTotalPaise: core.recurringGrandTotalPaise,
        marginPaise: core.marginPaise,
        marginBp: core.marginBp,
      },
      risk: {
        riskScoreBp: core.riskScoreBp,
        requiredApprovalLevel: core.requiredApprovalLevel,
      },
      lines: lines.map((line) => ({
        productId: line.productId,
        productSku: line.productSku,
        productName: line.productName,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
        discountBp: line.discountBp,
        ceilingBp: line.effectiveCeilingBp,
        violationBp: line.violationBp,
        lineType: line.lineType,
        lineTotalPaise: line.lineTotalPaise,
        marginPaise: line.marginPaise,
      })),
    },
    riskScoreBp: core.riskScoreBp,
    requiredApprovalLevel: core.requiredApprovalLevel,
    grandTotalPaise: core.grandTotalPaise,
    marginPaise: core.marginPaise,
    createdById: null,
    reason: null,
  });
}

// ---------------------------------------------------------------- line mutation

export interface AddLineInput {
  productId: string;
  quantity?: number;
  variantId?: string;
  discountBp?: number;
  fromRecommendation?: boolean;
}

export async function addLine(
  exec: DbExecutor,
  quotationId: string,
  input: AddLineInput,
  actor: QuotationActor,
) {
  const quote = await requireQuotation(exec, quotationId);
  assertEditable(quote.status);

  const quantity = input.quantity ?? 1;
  if (quantity < 1) throw badRequest('INVALID_QUANTITY', 'Quantity must be at least 1');
  if ((input.discountBp ?? 0) < 0) throw badRequest('INVALID_DISCOUNT', 'Discount cannot be negative');
  if ((input.discountBp ?? 0) > 10000) throw badRequest('INVALID_DISCOUNT', 'Discount cannot exceed 100%');

  const product = await exec.query.products.findFirst({
    where: (table, { eq }) => eq(table.id, input.productId),
    with: { category: true },
  });
  if (!product || !product.active) throw notFound('PRODUCT_NOT_FOUND', 'Product not found');
  if (!product.category?.active) throw badRequest('PRODUCT_INACTIVE', 'Product category is inactive');

  let planId: string | null = null;
  if (product.billingType === 'RECURRING') {
    const planMapping = await exec.query.subscriptionPlanProducts.findFirst({
      where: (table, { and, eq }) => and(eq(table.productId, product.id), eq(table.isDefault, true)),
    });
    if (!planMapping) {
      throw badRequest(
        'NO_SUBSCRIPTION_PLAN',
        `Recurring product "${product.name}" has no eligible subscription plan configured`,
      );
    }
    planId = planMapping.planId;
  }

  const tier = await exec.query.customers.findFirst({
    where: (table, { eq }) => eq(table.id, quote.customerId),
    with: { tier: true },
  });
  if (!tier?.tier) throw badRequest('CUSTOMER_NO_TIER', 'Customer has no configured tier');

  const pricing = await resolveProductPricing(exec, product.id, tier.tier.id, input.variantId);
  const ceiling = await resolveEffectiveCeiling(exec, { tierId: tier.tier.id, categoryId: product.categoryId });

  const [maxPosition] = await exec
    .select({ max: sql<number>`coalesce(max(${quotationLines.position}), 0)` })
    .from(quotationLines)
    .where(eq(quotationLines.quotationId, quotationId));
  const position = ((maxPosition?.max as number) ?? 0) + 1;

  await exec.insert(quotationLines).values({
    quotationId,
    productId: product.id,
    variantId: input.variantId ?? null,
    productName: product.name,
    productSku: product.sku,
    categoryId: product.categoryId,
    categoryName: product.category.name,
    quantity,
    listUnitPricePaise: pricing.listUnitPricePaise,
    unitPricePaise: pricing.unitPricePaise,
    discountBp: input.discountBp ?? 0,
    effectiveCeilingBp: ceiling.ceilingBp,
    ceilingRuleId: ceiling.ruleId,
    violationBp: Math.max(0, (input.discountBp ?? 0) - ceiling.ceilingBp),
    taxBp: product.taxBp,
    unitCostPaise: pricing.unitCostPaise,
    lineType: product.billingType,
    subscriptionPlanId: planId,
    addedFromRecommendation: input.fromRecommendation ?? false,
    position,
  });

  const result = await recalculateQuote(exec, quotationId, {
    bumpVersion: true,
    reason: `Line added: ${product.name}`,
  });

  await writeAudit(exec, {
    ...actor,
    entityType: 'QUOTATION_LINE',
    entityId: product.id,
    action: input.fromRecommendation ? 'RECOMMENDATION_ADDED' : 'LINE_ADDED',
    newValue: { productId: product.id, quantity, discountBp: input.discountBp ?? 0, position },
    quotationId,
    quotationVersion: result.newVersion,
    reason: `Line added: ${product.name}`,
  });

  return result;
}

export interface UpdateLineInput {
  quantity?: number;
  discountBp?: number;
}

export async function updateLine(
  exec: DbExecutor,
  quotationId: string,
  lineId: string,
  input: UpdateLineInput,
  actor: QuotationActor,
) {
  const quote = await requireQuotation(exec, quotationId);
  assertEditable(quote.status);

  const line = await exec.query.quotationLines.findFirst({
    where: (table, { and, eq }) => and(eq(table.id, lineId), eq(table.quotationId, quotationId)),
  });
  if (!line) throw notFound('LINE_NOT_FOUND', 'Line not found');

  if (input.quantity !== undefined && input.quantity < 1) {
    throw badRequest('INVALID_QUANTITY', 'Quantity must be at least 1');
  }
  if (input.discountBp !== undefined && (input.discountBp < 0 || input.discountBp > 10000)) {
    throw badRequest('INVALID_DISCOUNT', 'Discount must be between 0 and 100%');
  }

  const previous = { quantity: line.quantity, discountBp: line.discountBp };

  await exec
    .update(quotationLines)
    .set({
      quantity: input.quantity ?? line.quantity,
      discountBp: input.discountBp ?? line.discountBp,
    })
    .where(eq(quotationLines.id, lineId));

  const result = await recalculateQuote(exec, quotationId, { bumpVersion: true, reason: `Line updated: ${line.productName}` });

  const changedDiscount = input.discountBp !== undefined && input.discountBp !== previous.discountBp;
  await writeAudit(exec, {
    ...actor,
    entityType: 'QUOTATION_LINE',
    entityId: lineId,
    action: changedDiscount ? 'DISCOUNT_CHANGED' : 'QUOTE_EDITED',
    oldValue: previous,
    newValue: { quantity: input.quantity ?? line.quantity, discountBp: input.discountBp ?? line.discountBp },
    quotationId,
    quotationVersion: result.newVersion,
    reason: changedDiscount ? 'Line discount changed' : 'Line quantity changed',
  });

  return result;
}

export async function removeLine(
  exec: DbExecutor,
  quotationId: string,
  lineId: string,
  actor: QuotationActor,
) {
  const quote = await requireQuotation(exec, quotationId);
  assertEditable(quote.status);

  const line = await exec.query.quotationLines.findFirst({
    where: (table, { and, eq }) => and(eq(table.id, lineId), eq(table.quotationId, quotationId)),
  });
  if (!line) throw notFound('LINE_NOT_FOUND', 'Line not found');

  await exec.delete(quotationLines).where(eq(quotationLines.id, lineId));

  const result = await recalculateQuote(exec, quotationId, { bumpVersion: true, reason: `Line removed: ${line.productName}` });

  await writeAudit(exec, {
    ...actor,
    entityType: 'QUOTATION_LINE',
    entityId: lineId,
    action: 'LINE_REMOVED',
    oldValue: { productId: line.productId, quantity: line.quantity },
    quotationId,
    quotationVersion: result.newVersion,
    reason: `Line removed: ${line.productName}`,
  });

  return result;
}

export async function setOrderDiscount(
  exec: DbExecutor,
  quotationId: string,
  orderDiscountBp: number,
  actor: QuotationActor,
) {
  const quote = await requireQuotation(exec, quotationId);
  assertEditable(quote.status);

  if (orderDiscountBp < 0 || orderDiscountBp > 10000) {
    throw badRequest('INVALID_DISCOUNT', 'Order discount must be between 0 and 100%');
  }

  const previous = quote.orderDiscountBp;
  await exec.update(quotations).set({ orderDiscountBp }).where(eq(quotations.id, quotationId));

  const result = await recalculateQuote(exec, quotationId, { bumpVersion: true, reason: 'Order-level discount changed' });

  await writeAudit(exec, {
    ...actor,
    entityType: 'QUOTATION',
    entityId: quotationId,
    action: 'DISCOUNT_CHANGED',
    oldValue: { orderDiscountBp: previous },
    newValue: { orderDiscountBp },
    quotationId,
    quotationVersion: result.newVersion,
    reason: 'Order-level discount changed',
  });

  return result;
}

/** Re-run the engine without a version bump (e.g. after an admin edits a rule). */
export async function refreshRiskOnly(exec: DbExecutor, quotationId: string) {
  return recalculateQuote(exec, quotationId, { bumpVersion: false, reason: 'Configuration refresh' });
}

// ---------------------------------------------------------------- confirm / send

/**
 * Transition a draft quote forward.
 *
 * On `requiredLevel = NONE` the quote is approved automatically (WORKFLOWS.md §3
 * — an engine decision, not a bypass). Otherwise the approval attempt is raised
 * and the quote enters `PENDING_APPROVAL`.
 */
export async function confirmQuotation(exec: DbExecutor, quotationId: string, actor: QuotationActor) {
  const quote = await requireQuotation(exec, quotationId);
  if (quote.status !== 'DRAFT' && quote.status !== 'REVISION_REQUIRED') {
    throw badRequest('QUOTE_NOT_DRAFT', `Cannot confirm a quotation in state ${quote.status}`);
  }

  const { risk, requiredLevel, newVersion } = await recalculateQuote(exec, quotationId, {
    bumpVersion: false,
    reason: 'Rep confirmed quotation',
  });

  if (requiredLevel === 'NONE') {
    await exec
      .update(quotations)
      .set({ status: 'APPROVED', approvedVersion: quote.version, approvedAt: new Date() })
      .where(eq(quotations.id, quotationId));

    await writeAudit(exec, {
      ...actor,
      entityType: 'QUOTATION',
      entityId: quotationId,
      action: 'APPROVAL_REQUESTED',
      newValue: { requiredLevel: 'NONE', riskScoreBp: risk.totalBp },
      quotationId,
      quotationVersion: newVersion,
      reason: 'Risk within configured limit — approval not required',
    });
    await writeAudit(exec, {
      ...actor,
      entityType: 'QUOTATION',
      entityId: quotationId,
      action: 'APPROVAL_APPROVED',
      newValue: { automatic: true, riskScoreBp: risk.totalBp },
      quotationId,
      quotationVersion: newVersion,
      reason: 'Auto-approved: required approval level is NONE',
    });
    return requireQuotation(exec, quotationId);
  }

  const attempt = await raiseApproval(exec, {
    quotationId,
    quotationVersion: quote.version,
    requiredLevel,
    riskBp: risk.totalBp,
  });

  await exec
    .update(quotations)
    .set({ status: 'PENDING_APPROVAL' })
    .where(eq(quotations.id, quotationId));

  await writeAudit(exec, {
    ...actor,
    entityType: 'QUOTATION',
    entityId: quotationId,
    action: 'APPROVAL_REQUESTED',
    newValue: { requiredLevel, riskScoreBp: risk.totalBp, attempt, levels: requiredLevel === 'MANAGER_FINANCE' ? ['MANAGER', 'FINANCE'] : ['MANAGER'] },
    quotationId,
    quotationVersion: quote.version,
    reason: `Approval required: ${requiredLevel}`,
  });

  return requireQuotation(exec, quotationId);
}

export async function sendQuotation(exec: DbExecutor, quotationId: string, actor: QuotationActor) {
  const quote = await requireQuotation(exec, quotationId);
  if (quote.status !== 'APPROVED') {
    throw badRequest('QUOTE_NOT_APPROVED', `A quotation in ${quote.status} cannot be sent to the customer`);
  }

  await exec
    .update(quotations)
    .set({ status: 'SENT', sentAt: new Date() })
    .where(eq(quotations.id, quotationId));

  await writeAudit(exec, {
    ...actor,
    entityType: 'QUOTATION',
    entityId: quotationId,
    action: 'QUOTE_SENT',
    quotationId,
    quotationVersion: quote.version,
    reason: 'Quotation sent to customer portal',
  });

  return requireQuotation(exec, quotationId);
}

// ---------------------------------------------------------------- negotiation application

/**
 * Apply a submitted negotiation request to a new quote version.
 *
 * Implements PRD §16 / WORKFLOWS.md §9: persist → apply → recalculate → decide
 * whether approval re-entry is required.
 *
 * "Apply" means the customer's proposed terms are written onto the line before
 * the recalculation runs. Recalculating without mutating the line would bump the
 * version and re-score identical numbers, which is why the counter-offer has to
 * land on `quotation_lines` first.
 */
export async function applyNegotiation(exec: DbExecutor, requestId: string, actor: QuotationActor) {
  const request = await exec.query.negotiationRequests.findFirst({
    where: (table, { eq }) => eq(table.id, requestId),
    with: { quotation: true },
  });
  if (!request) throw notFound('NEGOTIATION_NOT_FOUND', 'Negotiation request not found');
  if (request.status !== 'SUBMITTED') {
    throw conflict('NEGOTIATION_STATE', `Request is in state ${request.status}`, { requestId });
  }

  const quote = request.quotation;
  if (quote.status !== 'SENT' && quote.status !== 'UNDER_NEGOTIATION') {
    throw conflict('QUOTE_NOT_NEGOTIABLE', `Quotation is in state ${quote.status}`);
  }
  if (request.quotationVersion !== quote.version) {
    throw conflict('STALE_NEGOTIATION', `Request targets version ${request.quotationVersion} but the quote is at version ${quote.version}`, {
      requestedVersion: request.quotationVersion,
      currentVersion: quote.version,
    });
  }

  const applied = await applyNegotiationTerms(exec, request);

  const { risk, requiredLevel, newVersion } = await recalculateQuote(exec, quote.id, {
    bumpVersion: true,
    reason: `Negotiation applied: ${request.requestType}`,
  });

  await exec
    .update(negotiationRequests)
    .set({
      status: requiredLevel === 'NONE' ? 'APPLIED' : 'PENDING_APPROVAL',
      resultingVersion: newVersion,
      resolvedById: actor.userId,
      resolvedAt: new Date(),
    })
    .where(eq(negotiationRequests.id, requestId));

  await writeAudit(exec, {
    ...actor,
    entityType: 'NEGOTIATION_REQUEST',
    entityId: requestId,
    action: 'NEGOTIATION_APPLIED',
    oldValue: { version: quote.version, ...applied.before },
    newValue: { version: newVersion, riskScoreBp: risk.totalBp, requiredLevel, ...applied.after },
    quotationId: quote.id,
    quotationVersion: newVersion,
    reason: `Applied ${request.requestType} negotiation request`,
  });

  if (requiredLevel === 'NONE') {
    await exec.update(quotations).set({ status: 'SENT' }).where(eq(quotations.id, quote.id));
    return requireQuotation(exec, quote.id);
  }

  const attempt = await raiseApproval(exec, {
    quotationId: quote.id,
    quotationVersion: newVersion,
    requiredLevel,
    riskBp: risk.totalBp,
  });
  await exec
    .update(quotations)
    .set({ status: 'PENDING_APPROVAL' })
    .where(eq(quotations.id, quote.id));

  await writeAudit(exec, {
    ...actor,
    entityType: 'QUOTATION',
    entityId: quote.id,
    action: 'APPROVAL_REQUESTED',
    newValue: { requiredLevel, riskScoreBp: risk.totalBp, version: newVersion, reason: 'Negotiation re-entry' },
    quotationId: quote.id,
    quotationVersion: newVersion,
    reason: 'Negotiation crossed a risk threshold — approval re-entered',
  });

  return requireQuotation(exec, quote.id);
}

// ---------------------------------------------------------------- helpers

/** The line-level change a negotiation request asks for, and what it replaced. */
interface AppliedTerms {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/**
 * Write a customer's proposed terms onto the quote.
 *
 * `QUESTION` carries no commercial change — it still bumps the version so the
 * conversation is anchored to a specific set of numbers, but nothing is mutated.
 * The proposal is applied verbatim: a counter beyond the tier ceiling is allowed
 * to land, because it is the recalculation that must detect the violation and
 * decide on approval re-entry. Silently clamping it here would hide the very
 * risk the approval chain exists to catch.
 */
async function applyNegotiationTerms(
  exec: DbExecutor,
  request: {
    requestType: NegotiationRequestType;
    lineId: string | null;
    proposedDiscountBp: number | null;
    proposedQuantity: number | null;
    quotationId: string;
  },
): Promise<AppliedTerms> {
  if (request.requestType === 'QUESTION') return { before: {}, after: {} };
  if (!request.lineId) {
    throw badRequest('NEGOTIATION_LINE', `A ${request.requestType} request must name a line`);
  }

  const line = await exec.query.quotationLines.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.id, request.lineId!), eq(table.quotationId, request.quotationId)),
  });
  if (!line) throw notFound('LINE_NOT_FOUND', 'The negotiated line no longer exists on this quotation');

  if (request.requestType === 'LINE_REMOVAL') {
    await exec.delete(quotationLines).where(eq(quotationLines.id, line.id));
    return {
      before: { lineId: line.id, productName: line.productName, quantity: line.quantity },
      after: { lineId: line.id, removed: true },
    };
  }

  if (request.requestType === 'DISCOUNT_COUNTER') {
    if (request.proposedDiscountBp === null) {
      throw badRequest('NEGOTIATION_DISCOUNT', 'A discount counter requires proposedDiscountBp');
    }
    await exec
      .update(quotationLines)
      .set({ discountBp: request.proposedDiscountBp })
      .where(eq(quotationLines.id, line.id));
    return {
      before: { lineId: line.id, discountBp: line.discountBp },
      after: { lineId: line.id, discountBp: request.proposedDiscountBp },
    };
  }

  // QUANTITY_CHANGE
  if (request.proposedQuantity === null) {
    throw badRequest('NEGOTIATION_QUANTITY', 'A quantity change requires proposedQuantity');
  }
  await exec
    .update(quotationLines)
    .set({ quantity: request.proposedQuantity })
    .where(eq(quotationLines.id, line.id));
  return {
    before: { lineId: line.id, quantity: line.quantity },
    after: { lineId: line.id, quantity: request.proposedQuantity },
  };
}

interface RaiseApprovalInput {
  quotationId: string;
  quotationVersion: number;
  requiredLevel: 'MANAGER' | 'MANAGER_FINANCE';
  riskBp: number;
}

/**
 * Create the rungs of a new approval attempt for a risk decision.
 *
 * `MANAGER` always is rung 1; `MANAGER_FINANCE` adds a Finance rung at rung 2,
 * which enforces "Finance follows Manager" structurally (SEQ 2 cannot pass until
 * SEQ 1 has) rather than through workflow prose.
 */
async function raiseApproval(
  exec: DbExecutor,
  input: RaiseApprovalInput,
): Promise<number> {
  const levels: readonly ('MANAGER' | 'FINANCE')[] =
    input.requiredLevel === 'MANAGER_FINANCE' ? ['MANAGER', 'FINANCE'] : ['MANAGER'];
  const attempt = await nextApprovalAttempt(exec, input.quotationId);

  // One insert per rung, sequentially: see the note in `recalculateQuote`.
  await exec.insert(approvalInstances).values(
    levels.map((level, index) => ({
      quotationId: input.quotationId,
      quotationVersion: input.quotationVersion,
      attempt,
      sequence: index + 1,
      level,
      status: 'PENDING' as const,
      riskScoreBp: input.riskBp,
    })),
  );

  return attempt;
}

async function nextApprovalAttempt(exec: DbExecutor, quotationId: string): Promise<number> {
  const rows = await exec
    .select({ attempt: approvalInstances.attempt })
    .from(approvalInstances)
    .where(eq(approvalInstances.quotationId, quotationId))
    .orderBy(desc(approvalInstances.attempt))
    .limit(1);
  return ((rows[0]?.attempt as number) ?? 0) + 1;
}

function assertEditable(status: string) {
  if (status !== 'DRAFT' && status !== 'REVISION_REQUIRED') {
    throw forbidden('QUOTE_LOCKED', `Quotation is ${status} and cannot be edited`);
  }
}