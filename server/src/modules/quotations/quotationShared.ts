import { Prisma } from '../../generated/prisma/client';
import { ProductType, QuotationStatus, Role } from '../../generated/prisma/enums';
import { prisma, type TransactionClient } from '../../db/prisma';
import { ForbiddenError, NotFoundError, VersionConflictError } from '../../http/errors';
import { MONEY_SCALE, formatMoney, formatPercent } from '../../http/fields';
import type { AuthContext } from '../../http/types';
import { calculateQuotation, type LineInput } from './quotationMath';

/**
 * Shared quotation internals: the read shape, the recalculation routine, the
 * concurrency-safe version bump, and visibility scoping.
 *
 * Split out so quotationService and quotationLineService cannot drift into two
 * different ideas of what a quotation is or how it adds up.
 */

export const lineSelect = {
  id: true,
  quotationId: true,
  productId: true,
  variantId: true,
  position: true,
  quantity: true,
  unitPrice: true,
  unitCost: true,
  discountPercent: true,
  taxPercent: true,
  lineSubtotal: true,
  lineDiscount: true,
  lineTax: true,
  lineTotal: true,
  margin: true,
  lineType: true,
  subscriptionPlanId: true,
  createdAt: true,
  updatedAt: true,
  product: { select: { sku: true, name: true, unit: true, categoryId: true, active: true } },
  variant: { select: { attribute: true, value: true, extraPrice: true } },
  subscriptionPlan: { select: { code: true, name: true, interval: true } },
} as const;

export const quotationSelect = {
  id: true,
  quoteNumber: true,
  customerId: true,
  salesRepId: true,
  status: true,
  version: true,
  currency: true,
  orderDiscountPercent: true,
  subtotal: true,
  discountTotal: true,
  taxTotal: true,
  grandTotal: true,
  estimatedCost: true,
  margin: true,
  riskScore: true,
  riskBand: true,
  requiredApprovalLevel: true,
  approvedVersion: true,
  notes: true,
  validUntil: true,
  sentAt: true,
  confirmedAt: true,
  lastActivityAt: true,
  createdAt: true,
  updatedAt: true,
  customer: {
    select: { code: true, name: true, tierId: true, tier: { select: { code: true, name: true } } },
  },
  salesRep: { select: { name: true, email: true } },
  _count: { select: { lines: true } },
} as const;

export interface QuotationLineView {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  unit: string;
  categoryId: string;
  variantId: string | null;
  variantLabel: string | null;
  position: number;
  quantity: number;
  unitPrice: string;
  /** Only present for callers holding margin:view. */
  unitCost?: string;
  discountPercent: string;
  taxPercent: string;
  lineSubtotal: string;
  lineDiscount: string;
  lineTax: string;
  lineTotal: string
  /** Only present for callers holding margin:view. */
  margin?: string;
  lineType: ProductType;
  subscriptionPlanId: string | null;
  subscriptionPlanName: string | null;
}

export interface QuotationView {
  id: string;
  quoteNumber: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  customerTierId: string;
  customerTierName: string;
  salesRepId: string;
  salesRepName: string;
  status: QuotationStatus;
  version: number;
  currency: string;
  orderDiscountPercent: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  /** Only present for callers holding margin:view. */
  estimatedCost?: string;
  margin?: string;
  riskScore: string;
  riskBand: string;
  requiredApprovalLevel: string;
  approvedVersion: number | null;
  /** True while the recorded approval still matches the current version. */
  approvalValid: boolean;
  notes: string | null;
  validUntil: Date | null;
  sentAt: Date | null;
  confirmedAt: Date | null;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
  lineCount: number;
  lines?: QuotationLineView[];
}

type LineRow = {
  id: string;
  productId: string;
  variantId: string | null;
  position: number;
  quantity: number;
  unitPrice: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  discountPercent: Prisma.Decimal;
  taxPercent: Prisma.Decimal;
  lineSubtotal: Prisma.Decimal;
  lineDiscount: Prisma.Decimal;
  lineTax: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  margin: Prisma.Decimal;
  lineType: ProductType;
  subscriptionPlanId: string | null;
  product: { sku: string; name: string; unit: string; categoryId: string; active: boolean };
  variant: { attribute: string; value: string; extraPrice: Prisma.Decimal } | null;
  subscriptionPlan: { code: string; name: string; interval: string } | null;
};

/**
 * `includeCost` gates unit cost and margin.
 *
 * docs/RBAC.md gives margin to every internal role and to no customer, so the
 * field is omitted rather than zeroed — a portal response must not carry it at
 * all, and an absent key cannot be misread as a zero margin.
 */
export function toLineView(row: LineRow, includeCost: boolean): QuotationLineView {
  return {
    id: row.id,
    productId: row.productId,
    sku: row.product.sku,
    productName: row.product.name,
    unit: row.product.unit,
    categoryId: row.product.categoryId,
    variantId: row.variantId,
    variantLabel: row.variant ? `${row.variant.attribute}: ${row.variant.value}` : null,
    position: row.position,
    quantity: row.quantity,
    unitPrice: formatMoney(row.unitPrice),
    ...(includeCost ? { unitCost: formatMoney(row.unitCost) } : {}),
    discountPercent: formatPercent(row.discountPercent),
    taxPercent: formatPercent(row.taxPercent),
    lineSubtotal: formatMoney(row.lineSubtotal),
    lineDiscount: formatMoney(row.lineDiscount),
    lineTax: formatMoney(row.lineTax),
    lineTotal: formatMoney(row.lineTotal),
    ...(includeCost ? { margin: formatMoney(row.margin) } : {}),
    lineType: row.lineType,
    subscriptionPlanId: row.subscriptionPlanId,
    subscriptionPlanName: row.subscriptionPlan?.name ?? null,
  };
}

type QuotationRow = {
  id: string;
  quoteNumber: string;
  customerId: string;
  salesRepId: string;
  status: QuotationStatus;
  version: number;
  currency: string;
  orderDiscountPercent: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
  estimatedCost: Prisma.Decimal;
  margin: Prisma.Decimal;
  riskScore: Prisma.Decimal;
  riskBand: string;
  requiredApprovalLevel: string;
  approvedVersion: number | null;
  notes: string | null;
  validUntil: Date | null;
  sentAt: Date | null;
  confirmedAt: Date | null;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
  customer: { code: string; name: string; tierId: string; tier: { code: string; name: string } };
  salesRep: { name: string; email: string };
  _count: { lines: number };
};

export function toQuotationView(
  row: QuotationRow,
  options: { includeCost: boolean; lines?: LineRow[] },
): QuotationView {
  return {
    id: row.id,
    quoteNumber: row.quoteNumber,
    customerId: row.customerId,
    customerCode: row.customer.code,
    customerName: row.customer.name,
    customerTierId: row.customer.tierId,
    customerTierName: row.customer.tier.name,
    salesRepId: row.salesRepId,
    salesRepName: row.salesRep.name,
    status: row.status,
    version: row.version,
    currency: row.currency,
    orderDiscountPercent: formatPercent(row.orderDiscountPercent),
    subtotal: formatMoney(row.subtotal),
    discountTotal: formatMoney(row.discountTotal),
    taxTotal: formatMoney(row.taxTotal),
    grandTotal: formatMoney(row.grandTotal),
    ...(options.includeCost
      ? { estimatedCost: formatMoney(row.estimatedCost), margin: formatMoney(row.margin) }
      : {}),
    riskScore: row.riskScore.toFixed(4),
    riskBand: row.riskBand,
    requiredApprovalLevel: row.requiredApprovalLevel,
    approvedVersion: row.approvedVersion,
    // Approval is live only while the approved version is still the current one
    // (AGENTS.md §11). Any material change bumps version and falsifies this.
    approvalValid: row.approvedVersion !== null && row.approvedVersion === row.version,
    notes: row.notes,
    validUntil: row.validUntil,
    sentAt: row.sentAt,
    confirmedAt: row.confirmedAt,
    lastActivityAt: row.lastActivityAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lineCount: row._count.lines,
    ...(options.lines
      ? { lines: options.lines.map((line) => toLineView(line, options.includeCost)) }
      : {}),
  };
}

/**
 * Recalculate every stored figure from the persisted lines.
 *
 * The only writer of the money columns. Totals are therefore always derivable
 * from the lines (docs/DOMAIN_MODEL.md invariant 10) and a client-supplied total
 * can never enter the database.
 */
export async function recalculateQuotation(
  tx: TransactionClient,
  quotationId: string,
): Promise<void> {
  const quotation = await tx.quotation.findUnique({
    where: { id: quotationId },
    select: { orderDiscountPercent: true },
  });
  if (!quotation) throw new NotFoundError('Quotation not found');

  const lines = await tx.quotationLine.findMany({
    where: { quotationId },
    select: {
      id: true,
      quantity: true,
      unitPrice: true,
      unitCost: true,
      discountPercent: true,
      taxPercent: true,
    },
    orderBy: { position: 'asc' },
  });

  const result = calculateQuotation(lines as LineInput[], quotation.orderDiscountPercent);

  for (const line of result.lines) {
    await tx.quotationLine.update({
      where: { id: line.id },
      data: {
        lineSubtotal: line.lineSubtotal.toFixed(MONEY_SCALE),
        lineDiscount: line.lineDiscount.toFixed(MONEY_SCALE),
        lineTax: line.lineTax.toFixed(MONEY_SCALE),
        lineTotal: line.lineTotal.toFixed(MONEY_SCALE),
        margin: line.margin.toFixed(MONEY_SCALE),
      },
    });
  }

  await tx.quotation.update({
    where: { id: quotationId },
    data: {
      subtotal: result.totals.subtotal.toFixed(MONEY_SCALE),
      discountTotal: result.totals.discountTotal.toFixed(MONEY_SCALE),
      taxTotal: result.totals.taxTotal.toFixed(MONEY_SCALE),
      grandTotal: result.totals.grandTotal.toFixed(MONEY_SCALE),
      estimatedCost: result.totals.estimatedCost.toFixed(MONEY_SCALE),
      margin: result.totals.margin.toFixed(MONEY_SCALE),
      lastActivityAt: new Date(),
    },
  });
}

/**
 * Claim the quotation at the version the client believes it holds, and bump it.
 *
 * A conditional update rather than read-then-write: `WHERE id = ? AND version = ?`
 * means a concurrent mutation that already moved the version leaves this one
 * matching zero rows, and it fails instead of silently overwriting newer
 * commercial state (AGENTS.md §23). Read-then-write would leave a race between
 * the two statements.
 */
export async function bumpVersion(
  tx: TransactionClient,
  quotationId: string,
  expectedVersion: number,
): Promise<number> {
  const affected = await tx.quotation.updateMany({
    where: { id: quotationId, version: expectedVersion },
    data: { version: { increment: 1 } },
  });

  if (affected.count === 0) throw new VersionConflictError();
  return expectedVersion + 1;
}

/**
 * Assert the client is not holding a stale version, without bumping it.
 *
 * For non-material edits — notes, validity date — which must still reject a stale
 * client but must not invalidate an approval.
 */
export function assertVersion(current: number, expected: number): void {
  if (current !== expected) throw new VersionConflictError();
}

/**
 * Visibility scope.
 *
 * docs/PRD.md §21 limits a Sales Rep to "assigned/authorized quotations", so a rep
 * sees only its own; every other internal role sees all. Returned as a `where`
 * fragment so list and get share one rule.
 */
export function visibilityScope(auth: AuthContext): { salesRepId?: string } {
  return auth.role === Role.SALES_REP ? { salesRepId: auth.userId } : {};
}

/** Read one quotation, applying the visibility scope. 404 rather than 403 for a scoped miss. */
export async function findQuotationForActor(
  auth: AuthContext,
  quotationId: string,
): Promise<QuotationRow> {
  const row = await prisma.quotation.findFirst({
    where: { id: quotationId, ...visibilityScope(auth) },
    select: quotationSelect,
  });
  // A rep probing another rep's id must not be able to distinguish "exists but
  // not yours" from "does not exist".
  if (!row) throw new NotFoundError('Quotation not found');
  return row;
}

/** Guard for operations only the owning rep (or a non-rep internal role) may perform. */
export function assertOwnership(auth: AuthContext, salesRepId: string): void {
  if (auth.role !== Role.SALES_REP) return;
  if (auth.userId !== salesRepId) {
    throw new ForbiddenError('You can only modify quotations you own');
  }
}
