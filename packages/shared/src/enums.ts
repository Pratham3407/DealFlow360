/**
 * Domain vocabularies shared by the API and both web workspaces.
 *
 * These string unions mirror the PostgreSQL enums declared in
 * `apps/api/prisma/schema.prisma`. Keeping them in one place means a state name
 * can never drift between the state machine, the API contract and the UI badge.
 *
 * `Category` is deliberately *not* here: DOMAIN_MODEL.md is explicit that
 * categories are admin-defined rows, not a fixed enum, because each category
 * carries its own discount ceiling (PRD §7 / FR-3).
 */

export const ROLES = ['ADMIN', 'SALES_REP', 'SALES_MANAGER', 'FINANCE_OPERATIONS', 'CUSTOMER'] as const;
export type Role = (typeof ROLES)[number];

/** Roles that may use the internal workspace at all. */
export const INTERNAL_ROLES: readonly Role[] = ['ADMIN', 'SALES_REP', 'SALES_MANAGER', 'FINANCE_OPERATIONS'];

export const QUOTATION_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'REVISION_REQUIRED',
  'SENT',
  'UNDER_NEGOTIATION',
  'CONFIRMED',
  'FULFILLMENT',
  'COMPLETED',
] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

/** Outcome of the approval-routing engine for a given risk score. */
export const APPROVAL_LEVELS_REQUIRED = ['NONE', 'MANAGER', 'MANAGER_FINANCE'] as const;
export type RequiredApprovalLevel = (typeof APPROVAL_LEVELS_REQUIRED)[number];

/** A single rung of the approval chain. */
export const APPROVAL_LEVELS = ['MANAGER', 'FINANCE'] as const;
export type ApprovalLevel = (typeof APPROVAL_LEVELS)[number];

export const APPROVAL_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'REVISION_REQUIRED',
  /** Voided because the quote's commercial terms changed underneath it. */
  'SUPERSEDED',
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const FULFILLMENT_STATUSES = [
  'NOT_STARTED',
  'ALLOCATING',
  'PARTIALLY_ALLOCATED',
  'ALLOCATED',
  'BACKORDERED',
  'PARTIALLY_FULFILLED',
  'FULFILLED',
] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

export const BACKORDER_STATUSES = ['OPEN', 'STOCK_AVAILABLE', 'CONSOLIDATED', 'CANCELLED'] as const;
export type BackorderStatus = (typeof BACKORDER_STATUSES)[number];

export const BILLING_TYPES = ['ONE_TIME', 'RECURRING'] as const;
export type BillingType = (typeof BILLING_TYPES)[number];

export const SUBSCRIPTION_INTERVALS = ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type SubscriptionInterval = (typeof SUBSCRIPTION_INTERVALS)[number];

export const SUBSCRIPTION_STATUSES = ['PENDING', 'ACTIVE', 'MODIFIED', 'CANCELLED', 'EXPIRED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * A `MODIFIED` subscription is still commercially live — the status records that
 * a mid-cycle change happened (STATE_MACHINES.md "Subscription"). Billing treats
 * `ACTIVE` and `MODIFIED` identically.
 */
export const BILLABLE_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = ['ACTIVE', 'MODIFIED'];

export const PRORATION_MODES = ['NONE', 'DAILY_PRORATA', 'FULL_PERIOD'] as const;
export type ProrationMode = (typeof PRORATION_MODES)[number];

export const CANCELLATION_MODES = ['IMMEDIATE', 'END_OF_PERIOD'] as const;
export type CancellationMode = (typeof CANCELLATION_MODES)[number];

export const REFUND_MODES = ['NONE', 'PARTIAL_PRORATA', 'FULL'] as const;
export type RefundMode = (typeof REFUND_MODES)[number];

/**
 * Day-count convention for proration. BUSINESS_RULES.md §9 requires this to be
 * configurable and documented rather than implicit.
 */
export const DAY_COUNT_CONVENTIONS = ['ACTUAL_DAYS', 'THIRTY_DAY_MONTH'] as const;
export type DayCountConvention = (typeof DAY_COUNT_CONVENTIONS)[number];

export const BILLING_SCHEDULE_STATUSES = ['SCHEDULED', 'INVOICED', 'PAID', 'SKIPPED', 'CANCELLED'] as const;
export type BillingScheduleStatus = (typeof BILLING_SCHEDULE_STATUSES)[number];

export const INVOICE_TYPES = ['ONE_TIME', 'RECURRING'] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_STATUSES = ['PENDING', 'COMPLETED', 'FAILED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const NEGOTIATION_REQUEST_TYPES = [
  'QUESTION',
  'DISCOUNT_COUNTER',
  'QUANTITY_CHANGE',
  'LINE_REMOVAL',
] as const;
export type NegotiationRequestType = (typeof NEGOTIATION_REQUEST_TYPES)[number];

export const NEGOTIATION_STATUSES = [
  'SUBMITTED',
  /** Applied to a new quote version; risk cleared, no approval needed. */
  'APPLIED',
  /** Applied to a new quote version, which is now waiting on approval. */
  'PENDING_APPROVAL',
  'ANSWERED',
  'REJECTED',
] as const;
export type NegotiationStatus = (typeof NEGOTIATION_STATUSES)[number];

export const DEAL_HEALTH_TYPES = ['STALLED', 'DISCOUNT_ANOMALY', 'DELIVERY_SLIPPAGE'] as const;
export type DealHealthType = (typeof DEAL_HEALTH_TYPES)[number];

export const DEAL_HEALTH_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type DealHealthSeverity = (typeof DEAL_HEALTH_SEVERITIES)[number];

/**
 * Audit actions.
 *
 * Stored as a plain `String` column rather than a PostgreSQL enum. The audit log
 * is append-only (PRD §20) and every new feature adds vocabulary, so a DB enum
 * would force a migration for each addition while providing integrity that the
 * TypeScript union already gives us at every write site.
 */
export const AUDIT_ACTIONS = [
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'CONFIG_CHANGED',
  'QUOTE_CREATED',
  'QUOTE_EDITED',
  'QUOTE_VERSION_CREATED',
  'DISCOUNT_CHANGED',
  'LINE_ADDED',
  'LINE_REMOVED',
  'RECOMMENDATION_ADDED',
  'RECOMMENDATION_DISMISSED',
  'APPROVAL_REQUESTED',
  'APPROVAL_APPROVED',
  'APPROVAL_REJECTED',
  'REVISION_REQUESTED',
  'APPROVAL_SUPERSEDED',
  'QUOTE_SENT',
  'NEGOTIATION_SUBMITTED',
  'NEGOTIATION_APPLIED',
  'NEGOTIATION_REJECTED',
  'NEGOTIATION_ANSWERED',
  'CUSTOMER_CONFIRMED',
  'ALLOCATION_RECALCULATED',
  'ALLOCATION_ACCEPTED',
  'ALLOCATION_OVERRIDDEN',
  'BACKORDER_CREATED',
  'BACKORDER_STOCK_AVAILABLE',
  'BACKORDER_CONSOLIDATED',
  'ALLOCATION_SHIPPED',
  'BILLING_GENERATED',
  'INVOICE_ISSUED',
  'SUBSCRIPTION_CREATED',
  'SUBSCRIPTION_CHANGED',
  'SUBSCRIPTION_CANCELLED',
  'CREDIT_NOTE_ISSUED',
  'PAYMENT_RECORDED',
  'DEAL_HEALTH_EVENT_RAISED',
  'DEAL_HEALTH_NUDGED',
  'DEAL_HEALTH_ESCALATED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Entity types referenced by audit rows and deal-health metadata. */
export const AUDIT_ENTITY_TYPES = [
  'USER',
  'CUSTOMER',
  'PRODUCT',
  'CATEGORY',
  'CUSTOMER_TIER',
  'PRICE_LIST',
  'DISCOUNT_RULE',
  'APPROVAL_RULE',
  'WAREHOUSE',
  'INVENTORY',
  'SUBSCRIPTION_PLAN',
  'QUOTATION',
  'QUOTATION_LINE',
  'APPROVAL_INSTANCE',
  'NEGOTIATION_REQUEST',
  'FULFILLMENT',
  'BACKORDER',
  'SUBSCRIPTION',
  'INVOICE',
  'PAYMENT',
  'CREDIT_NOTE',
  'DEAL_HEALTH_EVENT',
  'SYSTEM_SETTING',
  'PRODUCT_PAIRING',
  'PROMOTION',
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];
