/**
 * Quotation aggregate: the quotation, its lines, its version history, its
 * approval instances and the customer's negotiation requests.
 *
 * ## Versioning
 *
 * `quotations.version` is the current version number. Every material commercial
 * change bumps it and writes an immutable `quotation_versions` snapshot.
 * `approved_version` records which version an approval actually cleared, so
 * AGENT_INSTRUCTIONS.md §7 ("never silently mutate a commercially approved
 * quote") is checkable with a single comparison rather than inferred from
 * timestamps.
 *
 * ## Derived columns
 *
 * Totals, margin, risk and the resolved ceiling per line are persisted rather
 * than computed on read. DOMAIN_MODEL.md invariant 10 requires totals to be
 * *derivable* from lines — they are, and the recalculation service is the only
 * writer — but an approver must be able to see the exact ceiling and violation
 * that were in force when they approved, even if an admin later edits the rule.
 */

import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './_columns.js';
import { categories, products, productVariants } from './catalog.js';
import { customers, users } from './identity.js';
import {
  approvalLevelEnum,
  approvalStatusEnum,
  billingTypeEnum,
  negotiationRequestTypeEnum,
  negotiationStatusEnum,
  quotationStatusEnum,
  requiredApprovalLevelEnum,
} from './enums.js';

export const quotations = pgTable(
  'quotations',
  {
    id: primaryId(),
    quoteNumber: text('quote_number').notNull().unique(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    salesRepId: uuid('sales_rep_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: quotationStatusEnum('status').notNull().default('DRAFT'),
    version: integer('version').notNull().default(1),

    /** Order-level discount in basis points, applied on top of line discounts. */
    orderDiscountBp: integer('order_discount_bp').notNull().default(0),

    // --- Combined totals (one-time + recurring first period) ---
    subtotalPaise: integer('subtotal_paise').notNull().default(0),
    discountTotalPaise: integer('discount_total_paise').notNull().default(0),
    taxTotalPaise: integer('tax_total_paise').notNull().default(0),
    grandTotalPaise: integer('grand_total_paise').notNull().default(0),

    /**
     * One-time and recurring components are stored separately because PRD §9
     * requires them to be *displayed and billed separately* even though they
     * share one quotation.
     */
    oneTimeSubtotalPaise: integer('one_time_subtotal_paise').notNull().default(0),
    oneTimeGrandTotalPaise: integer('one_time_grand_total_paise').notNull().default(0),
    recurringSubtotalPaise: integer('recurring_subtotal_paise').notNull().default(0),
    /** Recurring charge per interval, tax inclusive. Not part of the one-time invoice. */
    recurringGrandTotalPaise: integer('recurring_grand_total_paise').notNull().default(0),

    // --- Margin (PRD §11 "live margin") ---
    estimatedCostPaise: integer('estimated_cost_paise').notNull().default(0),
    marginPaise: integer('margin_paise').notNull().default(0),
    /** Margin as a share of net revenue, in basis points. */
    marginBp: integer('margin_bp').notNull().default(0),

    // --- Discount risk (PRD §13) ---
    riskScoreBp: integer('risk_score_bp').notNull().default(0),
    /** Component breakdown, persisted so approvers see *why* the score is what it is. */
    riskBreakdown: jsonb('risk_breakdown'),
    requiredApprovalLevel: requiredApprovalLevelEnum('required_approval_level')
      .notNull()
      .default('NONE'),

    /** Version number that the current approval chain cleared. Null = never approved. */
    approvedVersion: integer('approved_version'),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true, mode: 'date' }),

    /**
     * Last commercially meaningful touch, used by stalled-deal detection
     * (PRD §17). Distinct from `updated_at`, which a background recalculation or
     * a deal-health sweep would also move.
     */
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    /** Date promised to the customer, and the date fulfillment currently supports. */
    promisedDeliveryDate: date('promised_delivery_date', { mode: 'date' }),
    projectedDeliveryDate: date('projected_delivery_date', { mode: 'date' }),

    validUntil: date('valid_until', { mode: 'date' }),
    notes: text('notes'),
    ...timestamps(),
  },
  (table) => [
    index('quotations_customer_idx').on(table.customerId),
    index('quotations_rep_idx').on(table.salesRepId),
    index('quotations_status_idx').on(table.status),
    index('quotations_activity_idx').on(table.lastActivityAt),
  ],
);

export const quotationLines = pgTable(
  'quotation_lines',
  {
    id: primaryId(),
    quotationId: uuid('quotation_id')
      .notNull()
      .references(() => quotations.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),

    /**
     * Snapshots taken when the line was created. A quotation is a commercial
     * document: renaming a product or moving it to another category must not
     * retroactively change what the customer was quoted or which ceiling the
     * approver saw.
     */
    productName: text('product_name').notNull(),
    productSku: text('product_sku').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    categoryName: text('category_name').notNull(),

    quantity: integer('quantity').notNull(),
    /** Price list price before variant extras — shown as the strike-through price. */
    listUnitPricePaise: integer('list_unit_price_paise').notNull(),
    /** Effective unit price before discount (list price + variant extra). */
    unitPricePaise: integer('unit_price_paise').notNull(),
    discountBp: integer('discount_bp').notNull().default(0),

    /** Resolved ceiling and the resulting breach, both persisted for auditability. */
    effectiveCeilingBp: integer('effective_ceiling_bp').notNull().default(0),
    violationBp: integer('violation_bp').notNull().default(0),
    /** Id of the `discount_rules` row that produced the ceiling. Null = tier fallback. */
    ceilingRuleId: uuid('ceiling_rule_id'),

    taxBp: integer('tax_bp').notNull().default(0),

    grossAmountPaise: integer('gross_amount_paise').notNull().default(0),
    discountAmountPaise: integer('discount_amount_paise').notNull().default(0),
    /** Share of the order-level discount apportioned to this line. */
    orderDiscountAmountPaise: integer('order_discount_amount_paise').notNull().default(0),
    netAmountPaise: integer('net_amount_paise').notNull().default(0),
    taxAmountPaise: integer('tax_amount_paise').notNull().default(0),
    lineTotalPaise: integer('line_total_paise').notNull().default(0),

    unitCostPaise: integer('unit_cost_paise').notNull().default(0),
    costAmountPaise: integer('cost_amount_paise').notNull().default(0),
    marginPaise: integer('margin_paise').notNull().default(0),

    lineType: billingTypeEnum('line_type').notNull().default('ONE_TIME'),
    /** Set for recurring lines; resolved from the product's eligible plans. */
    subscriptionPlanId: uuid('subscription_plan_id'),

    /** True when the line came from the recommendation panel — feeds upsell reporting. */
    addedFromRecommendation: boolean('added_from_recommendation').notNull().default(false),

    position: integer('position').notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    index('quotation_lines_quotation_idx').on(table.quotationId),
    index('quotation_lines_product_idx').on(table.productId),
  ],
);

/**
 * Immutable snapshot of a quotation at a version boundary.
 *
 * Written by the versioning service before the mutation that bumps the version,
 * so v1's snapshot is what v1 actually looked like. Negotiation requests and
 * approvals both reference a version number, which is what makes
 * "concurrent/stale version" a testable case (AGENT_INSTRUCTIONS.md §9).
 */
export const quotationVersions = pgTable(
  'quotation_versions',
  {
    id: primaryId(),
    quotationId: uuid('quotation_id')
      .notNull()
      .references(() => quotations.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    riskScoreBp: integer('risk_score_bp').notNull(),
    requiredApprovalLevel: requiredApprovalLevelEnum('required_approval_level').notNull(),
    grandTotalPaise: integer('grand_total_paise').notNull(),
    marginPaise: integer('margin_paise').notNull(),
    reason: text('reason'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamps().createdAt,
  },
  (table) => [uniqueIndex('quotation_versions_unique').on(table.quotationId, table.version)],
);

/**
 * One rung of one approval attempt.
 *
 * `attempt` groups the rungs of a single routing decision: a quote that is
 * approved, then changed by a negotiation, then re-approved has two attempts.
 * `sequence` orders rungs within an attempt (Manager = 1, Finance = 2), which is
 * how "Finance follows Manager" is enforced rather than assumed.
 */
export const approvalInstances = pgTable(
  'approval_instances',
  {
    id: primaryId(),
    quotationId: uuid('quotation_id')
      .notNull()
      .references(() => quotations.id, { onDelete: 'cascade' }),
    /** Quotation version this rung was raised against. */
    quotationVersion: integer('quotation_version').notNull(),
    attempt: integer('attempt').notNull().default(1),
    sequence: integer('sequence').notNull().default(1),
    level: approvalLevelEnum('level').notNull(),
    status: approvalStatusEnum('status').notNull().default('PENDING'),
    /** Risk score at the moment the rung was raised. */
    riskScoreBp: integer('risk_score_bp').notNull(),
    reviewerId: uuid('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason'),
    actedAt: timestamp('acted_at', { withTimezone: true, mode: 'date' }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('approval_instances_unique').on(
      table.quotationId,
      table.attempt,
      table.sequence,
    ),
    index('approval_instances_status_idx').on(table.status),
    index('approval_instances_quotation_idx').on(table.quotationId),
  ],
);

/**
 * A customer's line-level question, change request or counter-discount.
 *
 * `quotationVersion` is mandatory: BUSINESS_RULES.md §10 requires every proposed
 * commercial change to be tied to a version, which is also how a stale counter
 * (submitted against a quote that has since moved on) is detected and rejected
 * instead of silently applied.
 */
export const negotiationRequests = pgTable(
  'negotiation_requests',
  {
    id: primaryId(),
    quotationId: uuid('quotation_id')
      .notNull()
      .references(() => quotations.id, { onDelete: 'cascade' }),
    quotationVersion: integer('quotation_version').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    /** The portal user who submitted it — resolved server-side from the session. */
    submittedById: uuid('submitted_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    requestType: negotiationRequestTypeEnum('request_type').notNull(),
    lineId: uuid('line_id').references(() => quotationLines.id, { onDelete: 'set null' }),
    /** Populated for DISCOUNT_COUNTER. */
    proposedDiscountBp: integer('proposed_discount_bp'),
    /** Populated for QUANTITY_CHANGE. */
    proposedQuantity: integer('proposed_quantity'),
    comment: text('comment'),
    status: negotiationStatusEnum('status').notNull().default('SUBMITTED'),
    /** Version created by applying this request, if it was applied. */
    resultingVersion: integer('resulting_version'),
    resolutionNote: text('resolution_note'),
    resolvedById: uuid('resolved_by_id').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    ...timestamps(),
  },
  (table) => [
    index('negotiation_requests_quotation_idx').on(table.quotationId),
    index('negotiation_requests_status_idx').on(table.status),
  ],
);

/** Recommendations the rep dismissed, so the panel does not re-suggest them (PRD §12). */
export const recommendationDismissals = pgTable(
  'recommendation_dismissals',
  {
    id: primaryId(),
    quotationId: uuid('quotation_id')
      .notNull()
      .references(() => quotations.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    dismissedById: uuid('dismissed_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamps().createdAt,
  },
  (table) => [uniqueIndex('recommendation_dismissals_unique').on(table.quotationId, table.productId)],
);

export const quotationsRelations = relations(quotations, ({ one, many }) => ({
  customer: one(customers, { fields: [quotations.customerId], references: [customers.id] }),
  salesRep: one(users, { fields: [quotations.salesRepId], references: [users.id] }),
  lines: many(quotationLines),
  versions: many(quotationVersions),
  approvals: many(approvalInstances),
  negotiations: many(negotiationRequests),
  dismissals: many(recommendationDismissals),
}));

export const quotationLinesRelations = relations(quotationLines, ({ one }) => ({
  quotation: one(quotations, { fields: [quotationLines.quotationId], references: [quotations.id] }),
  product: one(products, { fields: [quotationLines.productId], references: [products.id] }),
  variant: one(productVariants, {
    fields: [quotationLines.variantId],
    references: [productVariants.id],
  }),
  category: one(categories, { fields: [quotationLines.categoryId], references: [categories.id] }),
}));

export const quotationVersionsRelations = relations(quotationVersions, ({ one }) => ({
  quotation: one(quotations, {
    fields: [quotationVersions.quotationId],
    references: [quotations.id],
  }),
  createdBy: one(users, { fields: [quotationVersions.createdById], references: [users.id] }),
}));

export const approvalInstancesRelations = relations(approvalInstances, ({ one }) => ({
  quotation: one(quotations, {
    fields: [approvalInstances.quotationId],
    references: [quotations.id],
  }),
  reviewer: one(users, { fields: [approvalInstances.reviewerId], references: [users.id] }),
}));

export const negotiationRequestsRelations = relations(negotiationRequests, ({ one }) => ({
  quotation: one(quotations, {
    fields: [negotiationRequests.quotationId],
    references: [quotations.id],
  }),
  line: one(quotationLines, {
    fields: [negotiationRequests.lineId],
    references: [quotationLines.id],
  }),
  customer: one(customers, {
    fields: [negotiationRequests.customerId],
    references: [customers.id],
  }),
  submittedBy: one(users, {
    fields: [negotiationRequests.submittedById],
    references: [users.id],
    relationName: 'negotiation_submitter',
  }),
  resolvedBy: one(users, {
    fields: [negotiationRequests.resolvedById],
    references: [users.id],
    relationName: 'negotiation_resolver',
  }),
}));
