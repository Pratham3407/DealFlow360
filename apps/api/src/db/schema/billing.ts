/**
 * Billing: subscription plans, live subscriptions, billing schedules, invoices,
 * payments and credit notes.
 *
 * The central requirement (PRD §18, WORKFLOWS.md §8) is that one confirmed order
 * splits into two billing treatments: one-time lines become a single one-time
 * invoice, recurring lines become subscriptions with their own schedules. Both
 * point back at the same quotation, which is what lets the billing view show them
 * side by side while keeping the documents separate.
 */

import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './_columns.js';
import { products } from './catalog.js';
import { customers, users } from './identity.js';
import { quotationLines, quotations } from './quotation.js';
import {
  billingScheduleStatusEnum,
  cancellationModeEnum,
  dayCountConventionEnum,
  invoiceStatusEnum,
  invoiceTypeEnum,
  paymentStatusEnum,
  prorationModeEnum,
  refundModeEnum,
  subscriptionIntervalEnum,
  subscriptionStatusEnum,
} from './enums.js';

/**
 * Admin-configured subscription plan (PRD §9).
 *
 * The three rule columns are the configurable behaviours the source specification
 * names: proration, cancellation and partial refund. `dayCountConvention` is
 * required by BUSINESS_RULES.md §9, which insists the day-count basis be
 * configurable and documented rather than implicit in the proration formula.
 */
export const subscriptionPlans = pgTable('subscription_plans', {
  id: primaryId(),
  name: text('name').notNull().unique(),
  interval: subscriptionIntervalEnum('interval').notNull(),
  prorationMode: prorationModeEnum('proration_mode').notNull().default('DAILY_PRORATA'),
  cancellationMode: cancellationModeEnum('cancellation_mode').notNull().default('END_OF_PERIOD'),
  refundMode: refundModeEnum('refund_mode').notNull().default('PARTIAL_PRORATA'),
  dayCountConvention: dayCountConventionEnum('day_count_convention').notNull().default('ACTUAL_DAYS'),
  /** Minimum committed term in intervals. 0 = cancel any time. */
  minTermIntervals: integer('min_term_intervals').notNull().default(0),
  description: text('description'),
  active: boolean('active').notNull().default(true),
  ...timestamps(),
});

/** Which products a plan may bill (PRD §9 "eligible products/services"). */
export const subscriptionPlanProducts = pgTable(
  'subscription_plan_products',
  {
    id: primaryId(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => subscriptionPlans.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** Preferred plan for this product when several are eligible. */
    isDefault: boolean('is_default').notNull().default(false),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('subscription_plan_products_unique').on(table.planId, table.productId),
    index('subscription_plan_products_product_idx').on(table.productId),
  ],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: primaryId(),
    subscriptionNumber: text('subscription_number').notNull().unique(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => subscriptionPlans.id, { onDelete: 'restrict' }),
    quotationId: uuid('quotation_id').references(() => quotations.id, { onDelete: 'set null' }),
    quotationLineId: uuid('quotation_line_id').references(() => quotationLines.id, {
      onDelete: 'set null',
    }),
    quantity: integer('quantity').notNull(),
    /** Per-interval unit price agreed on the quotation, before discount. */
    unitPricePaise: integer('unit_price_paise').notNull(),
    discountBp: integer('discount_bp').notNull().default(0),
    taxBp: integer('tax_bp').notNull().default(0),
    status: subscriptionStatusEnum('status').notNull().default('PENDING'),
    startDate: date('start_date', { mode: 'date' }).notNull(),
    currentPeriodStart: date('current_period_start', { mode: 'date' }).notNull(),
    currentPeriodEnd: date('current_period_end', { mode: 'date' }).notNull(),
    nextBillingDate: date('next_billing_date', { mode: 'date' }).notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    /** Effective end date, which for END_OF_PERIOD cancellation is the period end. */
    endDate: date('end_date', { mode: 'date' }),
    ...timestamps(),
  },
  (table) => [
    index('subscriptions_customer_idx').on(table.customerId),
    index('subscriptions_quotation_idx').on(table.quotationId),
    index('subscriptions_status_idx').on(table.status),
  ],
);

/**
 * One billing period of a subscription.
 *
 * Generated forward from the subscription terms (DOMAIN_MODEL.md invariant 8), so
 * the schedule is always reproducible from the plan interval and the start date
 * rather than accumulated by side effects.
 */
export const billingSchedules = pgTable(
  'billing_schedules',
  {
    id: primaryId(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    periodStart: date('period_start', { mode: 'date' }).notNull(),
    periodEnd: date('period_end', { mode: 'date' }).notNull(),
    /** Net charge for the period, after discount, before tax. */
    amountPaise: integer('amount_paise').notNull(),
    taxAmountPaise: integer('tax_amount_paise').notNull().default(0),
    totalPaise: integer('total_paise').notNull(),
    quantity: integer('quantity').notNull(),
    status: billingScheduleStatusEnum('status').notNull().default('SCHEDULED'),
    invoiceId: uuid('invoice_id'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('billing_schedules_unique').on(table.subscriptionId, table.sequence),
    index('billing_schedules_status_idx').on(table.status),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: primaryId(),
    invoiceNumber: text('invoice_number').notNull().unique(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    quotationId: uuid('quotation_id').references(() => quotations.id, { onDelete: 'set null' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    type: invoiceTypeEnum('type').notNull(),
    status: invoiceStatusEnum('status').notNull().default('DRAFT'),
    subtotalPaise: integer('subtotal_paise').notNull().default(0),
    discountPaise: integer('discount_paise').notNull().default(0),
    taxPaise: integer('tax_paise').notNull().default(0),
    amountPaise: integer('amount_paise').notNull().default(0),
    /** Sum of COMPLETED payments, maintained by the payment service. */
    amountPaidPaise: integer('amount_paid_paise').notNull().default(0),
    /** Sum of credit notes raised against this invoice. */
    creditedPaise: integer('credited_paise').notNull().default(0),
    issueDate: date('issue_date', { mode: 'date' }),
    dueDate: date('due_date', { mode: 'date' }),
    periodStart: date('period_start', { mode: 'date' }),
    periodEnd: date('period_end', { mode: 'date' }),
    notes: text('notes'),
    ...timestamps(),
  },
  (table) => [
    index('invoices_customer_idx').on(table.customerId),
    index('invoices_quotation_idx').on(table.quotationId),
    index('invoices_status_idx').on(table.status),
  ],
);

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: primaryId(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    quotationLineId: uuid('quotation_line_id').references(() => quotationLines.id, {
      onDelete: 'set null',
    }),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPricePaise: integer('unit_price_paise').notNull(),
    discountBp: integer('discount_bp').notNull().default(0),
    taxBp: integer('tax_bp').notNull().default(0),
    netAmountPaise: integer('net_amount_paise').notNull(),
    taxAmountPaise: integer('tax_amount_paise').notNull().default(0),
    amountPaise: integer('amount_paise').notNull(),
    /**
     * True for a mid-cycle proration adjustment. May be negative when a downgrade
     * produces a credit within an otherwise positive invoice.
     */
    isProration: boolean('is_proration').notNull().default(false),
    periodStart: date('period_start', { mode: 'date' }),
    periodEnd: date('period_end', { mode: 'date' }),
    ...timestamps(),
  },
  (table) => [index('invoice_lines_invoice_idx').on(table.invoiceId)],
);

export const payments = pgTable(
  'payments',
  {
    id: primaryId(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    amountPaise: integer('amount_paise').notNull(),
    method: text('method').notNull().default('BANK_TRANSFER'),
    reference: text('reference'),
    status: paymentStatusEnum('status').notNull().default('COMPLETED'),
    paidAt: timestamp('paid_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    recordedById: uuid('recorded_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (table) => [index('payments_invoice_idx').on(table.invoiceId)],
);

export const creditNotes = pgTable(
  'credit_notes',
  {
    id: primaryId(),
    creditNoteNumber: text('credit_note_number').notNull().unique(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    amountPaise: integer('amount_paise').notNull(),
    reason: text('reason').notNull(),
    issuedById: uuid('issued_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (table) => [
    index('credit_notes_customer_idx').on(table.customerId),
    index('credit_notes_invoice_idx').on(table.invoiceId),
  ],
);

export const subscriptionPlansRelations = relations(subscriptionPlans, ({ many }) => ({
  eligibleProducts: many(subscriptionPlanProducts),
  subscriptions: many(subscriptions),
}));

export const subscriptionPlanProductsRelations = relations(subscriptionPlanProducts, ({ one }) => ({
  plan: one(subscriptionPlans, {
    fields: [subscriptionPlanProducts.planId],
    references: [subscriptionPlans.id],
  }),
  product: one(products, {
    fields: [subscriptionPlanProducts.productId],
    references: [products.id],
  }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  customer: one(customers, { fields: [subscriptions.customerId], references: [customers.id] }),
  product: one(products, { fields: [subscriptions.productId], references: [products.id] }),
  plan: one(subscriptionPlans, {
    fields: [subscriptions.planId],
    references: [subscriptionPlans.id],
  }),
  quotation: one(quotations, { fields: [subscriptions.quotationId], references: [quotations.id] }),
  schedules: many(billingSchedules),
  invoices: many(invoices),
}));

export const billingSchedulesRelations = relations(billingSchedules, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [billingSchedules.subscriptionId],
    references: [subscriptions.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  customer: one(customers, { fields: [invoices.customerId], references: [customers.id] }),
  quotation: one(quotations, { fields: [invoices.quotationId], references: [quotations.id] }),
  subscription: one(subscriptions, {
    fields: [invoices.subscriptionId],
    references: [subscriptions.id],
  }),
  lines: many(invoiceLines),
  payments: many(payments),
  creditNotes: many(creditNotes),
}));

export const invoiceLinesRelations = relations(invoiceLines, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceLines.invoiceId], references: [invoices.id] }),
  product: one(products, { fields: [invoiceLines.productId], references: [products.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }),
  recordedBy: one(users, { fields: [payments.recordedById], references: [users.id] }),
}));

export const creditNotesRelations = relations(creditNotes, ({ one }) => ({
  invoice: one(invoices, { fields: [creditNotes.invoiceId], references: [invoices.id] }),
  customer: one(customers, { fields: [creditNotes.customerId], references: [customers.id] }),
  subscription: one(subscriptions, {
    fields: [creditNotes.subscriptionId],
    references: [subscriptions.id],
  }),
  issuedBy: one(users, { fields: [creditNotes.issuedById], references: [users.id] }),
}));
