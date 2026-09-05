/**
 * Billing engine (PRD §18, BUSINESS_RULES.md §9, WORKFLOWS.md §8).
 *
 * A confirmed quotation splits into two billing treatments:
 *  - ONE_TIME lines   → one one-time invoice (per customer per order)
 *  - RECURRING lines  → one subscription per line, each with a forward-generated
 *                       billing schedule and a period-1 invoice issued now.
 *
 * The schedule is always generated forward from the plan interval and start date
 * (DOMAIN_MODEL.md invariant 8), never accumulated by side effects.
 *
 * ## Money discipline
 * All amounts are integer paise (defensive rounding via roundHalfAwayFromZero).
 * Proration uses the plan's configured day-count convention and is calculated on
 * the *discounted* unit rate, since that is what the customer actually agreed.
 */

import { and, asc, eq, lt, sql } from 'drizzle-orm';
import {
  billingSchedules,
  creditNotes,
  invoiceLines,
  invoices,
  payments,
  quotations,
  subscriptions,
} from '@/db/schema/index.js';
import type { DbExecutor } from '@/db/client.js';
import { writeAudit } from '../audit/audit.service.js';
import type { AuditActor } from '../audit/audit.service.js';
import { badRequest, conflict, notFound } from '@/lib/errors.js';
import { BILLABLE_SUBSCRIPTION_STATUSES, BP_FULL, roundHalfAwayFromZero } from '@dealflow/shared';
import dayjs from 'dayjs';
import type { InvoiceStatus, DayCountConvention, SubscriptionInterval } from '@dealflow/shared';

export interface BillingActor extends AuditActor {
  userId: string;
}

export const PAYMENT_TERMS_DAYS = 30;
export const SCHEDULE_HORIZON_SEQUENCES = 12;

const INTERVAL_MONTHS: Record<SubscriptionInterval, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  YEARLY: 12,
};

function pad(n: number, width = 6): string {
  return String(n).padStart(width, '0');
}

async function nextNumber(exec: DbExecutor, kind: 'invoice' | 'subscription' | 'creditNote'): Promise<string> {
  const prefix = kind === 'invoice' ? 'INV-' : kind === 'subscription' ? 'SUB-' : 'CN-';
  let rows: { number: string | null }[];
  if (kind === 'invoice') {
    rows = await exec.select({ number: invoices.invoiceNumber }).from(invoices);
  } else if (kind === 'subscription') {
    rows = await exec.select({ number: subscriptions.subscriptionNumber }).from(subscriptions);
  } else {
    rows = await exec.select({ number: creditNotes.creditNoteNumber }).from(creditNotes);
  }
  const maxSeq = rows.reduce((max, row) => {
    const match = /(\d+)$/.exec(row.number ?? '');
    if (!match) return max;
    return Math.max(max, parseInt(match[1] ?? '0', 10));
  }, 0);
  return `${prefix}${pad(maxSeq + 1)}`;
}

function discountedUnitRatePaise(unitPricePaise: number, discountBp: number): number {
  return roundHalfAwayFromZero((unitPricePaise * (BP_FULL - discountBp)) / BP_FULL);
}

function intervalAmount(sub: (typeof subscriptions.$inferSelect), quantity: number): { amountPaise: number; taxAmountPaise: number; totalPaise: number } {
  const rate = discountedUnitRatePaise(sub.unitPricePaise, sub.discountBp);
  const amountPaise = rate * quantity;
  const taxAmountPaise = roundHalfAwayFromZero((amountPaise * sub.taxBp) / BP_FULL);
  return { amountPaise, taxAmountPaise, totalPaise: amountPaise + taxAmountPaise };
}

function daysInPeriod(periodStart: Date, periodEnd: Date, convention: DayCountConvention, interval: SubscriptionInterval): number {
  if (convention === 'THIRTY_DAY_MONTH') {
    return 30 * (INTERVAL_MONTHS[interval] > 1 ? INTERVAL_MONTHS[interval] : 1);
  }
  return dayjs(periodEnd).add(1, 'day').diff(dayjs(periodStart), 'day');
}

async function requireSubscription(exec: DbExecutor, subscriptionId: string) {
  const sub = await exec.query.subscriptions.findFirst({
    where: (table, { eq }) => eq(table.id, subscriptionId),
    with: { plan: true, customer: true, schedules: true },
  });
  if (!sub) throw notFound('SUBSCRIPTION_NOT_FOUND', 'Subscription not found');
  return sub;
}

/**
 * Generate invoices/subscriptions for a confirmed order. Idempotent per type:
 * re-running for a quotation that already has a one-time invoice is a no-op.
 */
/**
 * Issue the one-time invoice and open any recurring subscriptions for an order.
 *
 * Requires only that the customer has confirmed. Billing and fulfillment are
 * *siblings* downstream of `CONFIRMED`, not a sequence: a signed order is
 * invoiceable whether or not the warehouse plan has been accepted, and holding
 * the invoice until goods move would delay revenue for no commercial reason.
 * `FULFILLMENT` is accepted for the same reason — an order already being shipped
 * is equally billable.
 */
export async function generateBilling(exec: DbExecutor, quotationId: string, actor: BillingActor) {
  const quote = await exec.query.quotations.findFirst({
    where: (table, { eq }) => eq(table.id, quotationId),
    with: { lines: true, customer: true },
  });
  if (!quote) throw notFound('QUOTE_NOT_FOUND', 'Quotation not found');
  if (quote.status !== 'CONFIRMED' && quote.status !== 'FULFILLMENT' && quote.status !== 'COMPLETED') {
    throw conflict(
      'QUOTE_STATE',
      `Billing requires an order the customer has confirmed (state: ${quote.status})`,
    );
  }

  const oneTimeLines = quote.lines.filter((line) => line.lineType === 'ONE_TIME');
  const recurringLines = quote.lines.filter((line) => line.lineType === 'RECURRING');

  const existing = await exec.query.invoices.findMany({
    where: (table, { and, eq }) => and(eq(table.quotationId, quotationId), eq(table.type, 'ONE_TIME')),
  });

  if (oneTimeLines.length && existing.length === 0) {
    const invoiceAmounts = oneTimeLines.reduce(
      (acc, line) => {
        acc.subtotal += line.grossAmountPaise;
        acc.discount += line.discountAmountPaise + line.orderDiscountAmountPaise;
        acc.tax += line.taxAmountPaise;
        acc.amount += line.lineTotalPaise;
        return acc;
      },
      { subtotal: 0, discount: 0, tax: 0, amount: 0 },
    );
    const invoiceNumber = await nextNumber(exec, 'invoice');
    const issueDate = new Date();
    const dueDate = dayjs(issueDate).add(PAYMENT_TERMS_DAYS, 'day').toDate();

    const [invoice] = await exec
      .insert(invoices)
      .values({
        invoiceNumber,
        customerId: quote.customerId,
        quotationId: quote.id,
        type: 'ONE_TIME',
        status: 'ISSUED',
        subtotalPaise: invoiceAmounts.subtotal,
        discountPaise: invoiceAmounts.discount,
        taxPaise: invoiceAmounts.tax,
        amountPaise: invoiceAmounts.amount,
        issueDate,
        dueDate,
      })
      .returning();
    if (!invoice) throw conflict('INVOICE_CREATE_FAILED', 'Could not create one-time invoice');

    for (const line of oneTimeLines) {
      await exec.insert(invoiceLines).values({
        invoiceId: invoice.id,
        productId: line.productId,
        quotationLineId: line.id,
        description: line.productName,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
        discountBp: line.discountBp,
        taxBp: line.taxBp,
        netAmountPaise: line.netAmountPaise,
        taxAmountPaise: line.taxAmountPaise,
        amountPaise: line.lineTotalPaise,
      });
    }
    await writeAudit(exec, {
      ...actor,
      entityType: 'INVOICE',
      entityId: invoice.id,
      action: 'BILLING_GENERATED',
      newValue: { invoiceNumber, type: 'ONE_TIME', amountPaise: invoiceAmounts.amount },
      quotationId: quote.id,
      quotationVersion: quote.version,
      reason: 'One-time invoice generated from confirmed order',
    });
  }

  for (const line of recurringLines) {
    if (!line.subscriptionPlanId) throw badRequest('PLAN_REQUIRED', `Recurring line ${line.productName} has no plan`);

    const existingSub = await exec.query.subscriptions.findFirst({
      where: (table, { eq }) => eq(table.quotationLineId, line.id),
    });
    if (existingSub) continue;

    const plan = await exec.query.subscriptionPlans.findFirst({
      where: (table, { eq }) => eq(table.id, String(line.subscriptionPlanId)),
    });
    if (!plan) throw notFound('PLAN_NOT_FOUND', 'Subscription plan not found');

    const today = dayjs();
    const periodStart = today;
    const periodEnd = today.add(INTERVAL_MONTHS[plan.interval], 'month').subtract(1, 'day');

    const subNumber = await nextNumber(exec, 'subscription');
    const [sub] = await exec
      .insert(subscriptions)
      .values({
        subscriptionNumber: subNumber,
        customerId: quote.customerId,
        productId: line.productId!,
        planId: plan.id,
        quotationId: quote.id,
        quotationLineId: line.id,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
        discountBp: line.discountBp,
        taxBp: line.taxBp,
        status: 'ACTIVE',
        startDate: periodStart.toDate(),
        currentPeriodStart: periodStart.toDate(),
        currentPeriodEnd: periodEnd.toDate(),
        nextBillingDate: periodEnd.add(1, 'day').toDate(),
      })
      .returning();
    if (!sub) throw conflict('SUBSCRIPTION_CREATE_FAILED', 'Could not create subscription');

    await writeAudit(exec, {
      ...actor,
      entityType: 'SUBSCRIPTION',
      entityId: sub.id,
      action: 'SUBSCRIPTION_CREATED',
      newValue: { subscriptionNumber: subNumber, interval: plan.interval },
      quotationId: quote.id,
      quotationVersion: quote.version,
    });

    // Forward-generate the billing schedule; issue an invoice only for period 1.
    for (let seq = 1; seq <= SCHEDULE_HORIZON_SEQUENCES; seq += 1) {
      const start = today.add(INTERVAL_MONTHS[plan.interval] * (seq - 1), 'month');
      const end = today.add(INTERVAL_MONTHS[plan.interval] * seq, 'month').subtract(1, 'day');
      const amounts = intervalAmount(sub, line.quantity);
      await exec.insert(billingSchedules).values({
        subscriptionId: sub.id,
        sequence: seq,
        periodStart: start.toDate(),
        periodEnd: end.toDate(),
        amountPaise: amounts.amountPaise,
        taxAmountPaise: amounts.taxAmountPaise,
        totalPaise: amounts.totalPaise,
        quantity: line.quantity,
        status: seq === 1 ? 'INVOICED' : 'SCHEDULED',
      });
    }

    const schedule = await exec.query.billingSchedules.findFirst({
      where: (table, { and, eq }) => and(eq(table.subscriptionId, sub.id), eq(table.sequence, 1)),
    });
    if (!schedule) throw conflict('SCHEDULE_MISSING', 'Period-1 schedule missing after generation');

    const invNumber = await nextNumber(exec, 'invoice');
    const [invoice] = await exec
      .insert(invoices)
      .values({
        invoiceNumber: invNumber,
        customerId: quote.customerId,
        quotationId: quote.id,
        subscriptionId: sub.id,
        type: 'RECURRING',
        status: 'ISSUED',
        subtotalPaise: schedule.amountPaise,
        taxPaise: schedule.taxAmountPaise,
        amountPaise: schedule.totalPaise,
        issueDate: new Date(),
        dueDate: periodEnd.add(PAYMENT_TERMS_DAYS, 'day').toDate(),
        periodStart: schedule.periodStart,
        periodEnd: schedule.periodEnd,
      })
      .returning();
    if (!invoice) throw conflict('INVOICE_CREATE_FAILED', 'Could not create recurring invoice');

    await exec
      .update(billingSchedules)
      .set({ invoiceId: invoice.id })
      .where(eq(billingSchedules.id, schedule.id));

    await exec.insert(invoiceLines).values({
      invoiceId: invoice.id,
      productId: line.productId,
      quotationLineId: line.id,
      description: line.productName,
      quantity: line.quantity,
      unitPricePaise: line.unitPricePaise,
      discountBp: line.discountBp,
      taxBp: line.taxBp,
      netAmountPaise: schedule.amountPaise,
      taxAmountPaise: schedule.taxAmountPaise,
      amountPaise: schedule.totalPaise,
      periodStart: schedule.periodStart,
      periodEnd: schedule.periodEnd,
    });

    await writeAudit(exec, {
      ...actor,
      entityType: 'INVOICE',
      entityId: invoice.id,
      action: 'BILLING_GENERATED',
      newValue: { invoiceNumber: invNumber, type: 'RECURRING', amountPaise: schedule.totalPaise },
      quotationId: quote.id,
      quotationVersion: quote.version,
      reason: `Recurring invoice for period 1 (${plan.interval}) generated`,
    });
  }

  return getBillingForQuotation(exec, quotationId);
}

export async function getBillingForQuotation(exec: DbExecutor, quotationId: string) {
  const subs = await exec.query.subscriptions.findMany({
    where: (table, { eq }) => eq(table.quotationId, quotationId),
    with: { plan: true, schedules: { orderBy: asc(billingSchedules.sequence) } },
  });
  const invs = await exec.query.invoices.findMany({
    where: (table, { eq }) => eq(table.quotationId, quotationId),
    with: { lines: true, payments: true, creditNotes: true },
  });
  return { subscriptions: subs, invoices: invs };
}

export async function recordPayment(
  exec: DbExecutor,
  invoiceId: string,
  input: { amountPaise: number; method?: string; reference?: string },
  actor: BillingActor,
) {
  const invoice = await exec.query.invoices.findFirst({
    where: (table, { eq }) => eq(table.id, invoiceId),
  });
  if (!invoice) throw notFound('INVOICE_NOT_FOUND', 'Invoice not found');
  if (invoice.status === 'PAID') throw conflict('INVOICE_ALREADY_PAID', 'Invoice is already paid');

  const remaining = invoice.amountPaise - invoice.amountPaidPaise - invoice.creditedPaise;
  if (input.amountPaise <= 0) throw badRequest('PAYMENT_AMOUNT', 'Payment amount must be positive');
  if (input.amountPaise > remaining) {
    throw conflict('PAYMENT_OVERPAY', `Payment exceeds the outstanding balance of ${remaining} paise`);
  }

  const [payment] = await exec
    .insert(payments)
    .values({
      invoiceId,
      amountPaise: input.amountPaise,
      method: input.method ?? 'BANK_TRANSFER',
      reference: input.reference ?? null,
      status: 'COMPLETED',
      recordedById: actor.userId,
      paidAt: new Date(),
    })
    .returning();
  if (!payment) throw conflict('PAYMENT_CREATE_FAILED', 'Could not record payment');

  const newPaid = invoice.amountPaidPaise + input.amountPaise;
  const newStatus: InvoiceStatus =
    newPaid >= invoice.amountPaise - invoice.creditedPaise
      ? 'PAID'
      : newPaid > 0
        ? 'PARTIALLY_PAID'
        : 'ISSUED';

  await exec.update(invoices).set({ amountPaidPaise: newPaid, status: newStatus }).where(eq(invoices.id, invoiceId));

  if (newStatus === 'PAID') {
    const schedule = await exec.query.billingSchedules.findFirst({
      where: (table, { eq }) => eq(table.invoiceId, invoiceId),
    });
    if (schedule) {
      await exec.update(billingSchedules).set({ status: 'PAID' }).where(eq(billingSchedules.id, schedule.id));
    }
  }

  await writeAudit(exec, {
    ...actor,
    entityType: 'PAYMENT',
    entityId: payment.id,
    action: 'PAYMENT_RECORDED',
    newValue: { invoiceNumber: invoice.invoiceNumber, amountPaise: input.amountPaise, status: newStatus },
    quotationId: invoice.quotationId ?? undefined,
  });

  return { payment, status: newStatus };
}

/**
 * Mid-cycle subscription change (PRD §9, BUSINESS_RULES §9).
 *
 * Delta is prorated to the unused remainder of the current period:
 *   proration = unitRate(negated) × Δquantity × (remaining days ÷ period days)
 * POSITIVE delta → a proration invoice line (extra debit).
 * NEGATIVE delta → a proration credit on the invoice (or credit note if that
 * would be simpler for the customer). Future scheduled periods are re-priced at
 * the new quantity.
 */
export async function changeSubscriptionQuantity(
  exec: DbExecutor,
  subscriptionId: string,
  newQuantity: number,
  effectiveDate: Date | null,
  actor: BillingActor,
) {
  if (newQuantity <= 0) throw badRequest('QUANTITY', 'Subscription quantity must be a positive integer');
  const sub = await requireSubscription(exec, subscriptionId);
  if (!BILLABLE_SUBSCRIPTION_STATUSES.includes(sub.status)) {
    throw conflict('SUBSCRIPTION_STATE', `Cannot change a subscription in state ${sub.status}`);
  }

  const delta = newQuantity - sub.quantity;
  const isIncrease = delta > 0;

  const rate = discountedUnitRatePaise(sub.unitPricePaise, sub.discountBp);
  const convention = sub.plan.dayCountConvention;
  const pStart = dayjs(sub.currentPeriodStart);
  const pEnd = dayjs(sub.currentPeriodEnd);
  const periodDays = daysInPeriod(sub.currentPeriodStart, sub.currentPeriodEnd, convention, sub.plan.interval);

  // Unused fraction: for an increase we charge for the *remaining* portion; for a
  // decrease/removal the customer only keeps the portion already consumed.
  const today = dayjs(effectiveDate ?? new Date());
  const remainingDays = Math.max(0, pEnd.add(1, 'day').diff(today, 'day'));
  const fractionAlreadyConsumed = 1 - remainingDays / periodDays;

  const chargeFraction = isIncrease ? remainingDays / periodDays : 1 - fractionAlreadyConsumed;
  const prorationNet = Math.round(rate * Math.abs(delta) * chargeFraction);
  const prorationTax = roundHalfAwayFromZero((prorationNet * sub.taxBp) / BP_FULL);
  const prorationTotal = prorationNet + prorationTax;

  // Link to the latest RECURRING invoice of this subscription, creating one if absent.
  let targetInvoice = await exec.query.invoices.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.subscriptionId, subscriptionId), eq(table.type, 'RECURRING'), eq(table.status, 'ISSUED')),
  });

  if (!targetInvoice) {
    throw conflict('INVOICE_REQUIRED', 'No issued recurring invoice to attach the proration to');
  }

  if (isIncrease && prorationNet > 0) {
    await exec.insert(invoiceLines).values({
      invoiceId: targetInvoice.id,
      productId: sub.productId,
      description: `${sub.plan.name} — proration (quantity ${sub.quantity} → ${newQuantity})`,
      quantity: delta,
      unitPricePaise: Math.round(rate * chargeFraction),
      discountBp: sub.discountBp,
      taxBp: sub.taxBp,
      netAmountPaise: prorationNet,
      taxAmountPaise: prorationTax,
      amountPaise: prorationTotal,
      isProration: true,
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
    });
    await updateInvoiceTotals(exec, targetInvoice.id);
  } else {
    // Downgrade → credit line on the governing invoice.
    await exec.insert(invoiceLines).values({
      invoiceId: targetInvoice.id,
      productId: sub.productId,
      description: `${sub.plan.name} — proration credit (quantity ${sub.quantity} → ${newQuantity})`,
      quantity: Math.abs(delta),
      unitPricePaise: -Math.round(rate * chargeFraction),
      discountBp: sub.discountBp,
      taxBp: sub.taxBp,
      netAmountPaise: -prorationNet,
      taxAmountPaise: -prorationTax,
      amountPaise: -prorationTotal,
      isProration: true,
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
    });
    await updateInvoiceTotals(exec, targetInvoice.id);
  }

  // Re-price future SCHEDULED sequences at the new quantity.
  const futureSchedules = await exec.query.billingSchedules.findMany({
    where: (table, { and, eq }) => and(eq(table.subscriptionId, subscriptionId), eq(table.status, 'SCHEDULED')),
  });
  for (const schedule of futureSchedules) {
    const amounts = {
      amountPaise: discountedUnitRatePaise(sub.unitPricePaise, sub.discountBp) * newQuantity,
    };
    const tax = roundHalfAwayFromZero((amounts.amountPaise * sub.taxBp) / BP_FULL);
    await exec
      .update(billingSchedules)
      .set({ quantity: newQuantity, amountPaise: amounts.amountPaise, taxAmountPaise: tax, totalPaise: amounts.amountPaise + tax })
      .where(eq(billingSchedules.id, schedule.id));
  }

  await exec
    .update(subscriptions)
    .set({ quantity: newQuantity, status: 'MODIFIED' })
    .where(eq(subscriptions.id, subscriptionId));

  await writeAudit(exec, {
    ...actor,
    entityType: 'SUBSCRIPTION',
    entityId: subscriptionId,
    action: 'SUBSCRIPTION_CHANGED',
    oldValue: { quantity: sub.quantity },
    newValue: { quantity: newQuantity, prorationPaise: isIncrease ? prorationTotal : -prorationTotal },
    quotationId: sub.quotationId ?? undefined,
  });

  return requireSubscription(exec, subscriptionId);
}

async function updateInvoiceTotals(exec: DbExecutor, invoiceId: string): Promise<void> {
  const sum = await exec
    .select({
      net: sql<number>`coalesce(sum(net_amount_paise), 0)`,
      tax: sql<number>`coalesce(sum(tax_amount_paise), 0)`,
      total: sql<number>`coalesce(sum(amount_paise), 0)`,
    })
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId));
  const net = Number(sum[0]?.net ?? 0);
  await exec
    .update(invoices)
    .set({ subtotalPaise: net, taxPaise: Number(sum[0]?.tax ?? 0), amountPaise: Number(sum[0]?.total ?? 0) })
    .where(eq(invoices.id, invoiceId));
}

/**
 * Cancel a subscription (PRD §9 "cancel anytime", BUSINESS_RULES §9).
 *
 * `IMMEDIATE` ends it now; `END_OF_PERIOD` lets the current period run and cancels
 * the future schedule. Optional partial refund is prorated and issued as a credit
 * note against the current period's invoice when the plan's refund mode allows.
 */
export async function cancelSubscription(
  exec: DbExecutor,
  subscriptionId: string,
  input: { effectiveDate?: Date | null; reason?: string },
  actor: BillingActor,
) {
  const sub = await requireSubscription(exec, subscriptionId);
  if (sub.status === 'CANCELLED' || sub.status === 'EXPIRED') {
    throw conflict('SUBSCRIPTION_STATE', `Subscription is already ${sub.status}`);
  }

  const plan = sub.plan;
  const today = dayjs(input.effectiveDate ?? new Date());
  const currentPeriodEnd = dayjs(sub.currentPeriodEnd);

  if (plan.cancellationMode === 'IMMEDIATE' || today.isAfter(currentPeriodEnd)) {
    const refund = await maybeIssueRefund(exec, sub, actor, today);
    await exec
      .update(subscriptions)
      .set({ status: 'CANCELLED', cancelledAt: new Date(), endDate: today.toDate() })
      .where(eq(subscriptions.id, subscriptionId));
    await exec
      .update(billingSchedules)
      .set({ status: 'CANCELLED' })
      .where(and(eq(billingSchedules.subscriptionId, subscriptionId), eq(billingSchedules.status, 'SCHEDULED')));

    await writeAudit(exec, {
      ...actor,
      entityType: 'SUBSCRIPTION',
      entityId: subscriptionId,
      action: 'SUBSCRIPTION_CANCELLED',
      newValue: { mode: 'IMMEDIATE', effectiveDate: today.toDate(), refundPaise: refund?.amountPaise ?? 0 },
      quotationId: sub.quotationId ?? undefined,
      reason: input.reason ?? 'Cancelled immediately',
    });
  } else {
    await exec
      .update(subscriptions)
      .set({ status: 'CANCELLED', cancelledAt: new Date(), endDate: currentPeriodEnd.toDate() })
      .where(eq(subscriptions.id, subscriptionId));
    await exec
      .update(billingSchedules)
      .set({ status: 'CANCELLED' })
      .where(
        and(
          eq(billingSchedules.subscriptionId, subscriptionId),
          eq(billingSchedules.status, 'SCHEDULED'),
          sql`${billingSchedules.periodStart} > ${currentPeriodEnd.toDate()}`,
        ),
      );

    await writeAudit(exec, {
      ...actor,
      entityType: 'SUBSCRIPTION',
      entityId: subscriptionId,
      action: 'SUBSCRIPTION_CANCELLED',
      newValue: { mode: 'END_OF_PERIOD', endDate: currentPeriodEnd.toDate() },
      quotationId: sub.quotationId ?? undefined,
      reason: input.reason ?? 'Cancelled at end of current period',
    });
  }

  return requireSubscription(exec, subscriptionId);
}

async function maybeIssueRefund(
  exec: DbExecutor,
  sub: Awaited<ReturnType<typeof requireSubscription>>,
  actor: BillingActor,
  today: dayjs.Dayjs,
) {
  if (sub.plan.refundMode === 'NONE') return null;
  const currentInvoice = await exec.query.invoices.findFirst({
    where: (table, { and, eq }) => and(eq(table.subscriptionId, sub.id), eq(table.type, 'RECURRING')),
  });
  if (!currentInvoice || currentInvoice.amountPaidPaise <= currentInvoice.creditedPaise) return null;

  const periodDays = daysInPeriod(
    sub.currentPeriodStart,
    sub.currentPeriodEnd,
    sub.plan.dayCountConvention,
    sub.plan.interval,
  );
  const remainingDays = Math.max(0, dayjs(sub.currentPeriodEnd).add(1, 'day').diff(today, 'day'));

  if (sub.plan.refundMode === 'FULL') {
    const refundable = currentInvoice.amountPaidPaise - currentInvoice.creditedPaise;
    return issueCreditNote(exec, {
      invoiceId: currentInvoice.id,
      subscriptionId: sub.id,
      customerId: sub.customerId,
      amountPaise: refundable,
      reason: `Full refund — ${sub.subscriptionNumber} cancelled`,
      actor,
    });
  }

  // PARTIAL_PRORATA: only the unused remainder of the paid period is refunded.
  const fraction = remainingDays / periodDays;
  const refundPaise = Math.round((currentInvoice.amountPaidPaise - currentInvoice.creditedPaise) * fraction);
  if (refundPaise <= 0) return null;

  return issueCreditNote(exec, {
    invoiceId: currentInvoice.id,
    subscriptionId: sub.id,
    customerId: sub.customerId,
    amountPaise: refundPaise,
    reason: `Partial prorata refund — ${sub.subscriptionNumber} cancelled`,
    actor,
  });
}

export async function issueCreditNote(
  exec: DbExecutor,
  input: {
    invoiceId: string;
    subscriptionId?: string;
    customerId: string;
    amountPaise: number;
    reason: string;
    actor: BillingActor;
  },
) {
  if (input.amountPaise <= 0) throw badRequest('CREDIT_AMOUNT', 'Credit note amount must be positive');

  const invoice = await exec.query.invoices.findFirst({
    where: (table, { eq }) => eq(table.id, input.invoiceId),
  });
  if (!invoice) throw notFound('INVOICE_NOT_FOUND', 'Invoice not found');

  const credited = invoice.creditedPaise + input.amountPaise;
  if (credited > invoice.amountPaidPaise) {
    throw conflict('CREDIT_OVERPAID', `Cannot credit more than the ${invoice.amountPaidPaise} paise paid on this invoice`);
  }

  const cnNumber = await nextNumber(exec, 'creditNote');
  const [cn] = await exec
    .insert(creditNotes)
    .values({
      creditNoteNumber: cnNumber,
      customerId: input.customerId,
      invoiceId: input.invoiceId,
      subscriptionId: input.subscriptionId ?? null,
      amountPaise: input.amountPaise,
      reason: input.reason,
      issuedById: input.actor.userId,
      createdAt: new Date(),
    })
    .returning();
  if (!cn) throw conflict('CREDIT_NOTE_CREATE_FAILED', 'Could not issue credit note');

  await exec
    .update(invoices)
    .set({ creditedPaise: credited, status: invoice.status })
    .where(eq(invoices.id, input.invoiceId));

  await writeAudit(exec, {
    ...input.actor,
    entityType: 'CREDIT_NOTE',
    entityId: cn.id,
    action: 'CREDIT_NOTE_ISSUED',
    newValue: { creditNoteNumber: cnNumber, amountPaise: input.amountPaise },
    quotationId: invoice.quotationId ?? undefined,
  });

  return cn;
}