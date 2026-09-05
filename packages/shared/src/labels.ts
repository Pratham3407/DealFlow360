/**
 * Human-readable labels and severity tones.
 *
 * Lives in shared code so a status renders identically in the internal workspace,
 * the customer portal and any exported report, and so adding a state forces the
 * label to be supplied (the records below are exhaustive by type).
 */

import type {
  ApprovalLevel,
  ApprovalStatus,
  BackorderStatus,
  BillingScheduleStatus,
  BillingType,
  DealHealthSeverity,
  DealHealthType,
  FulfillmentStatus,
  InvoiceStatus,
  NegotiationRequestType,
  NegotiationStatus,
  QuotationStatus,
  RequiredApprovalLevel,
  Role,
  SubscriptionInterval,
  SubscriptionStatus,
} from './enums.js';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'pending';

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  SALES_REP: 'Sales Rep',
  SALES_MANAGER: 'Sales Manager',
  FINANCE_OPERATIONS: 'Finance / Operations',
  CUSTOMER: 'Customer',
};

export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  REVISION_REQUIRED: 'Revision Required',
  SENT: 'Sent',
  UNDER_NEGOTIATION: 'Under Negotiation',
  CONFIRMED: 'Confirmed',
  FULFILLMENT: 'Fulfillment',
  COMPLETED: 'Completed',
};

export const QUOTATION_STATUS_TONES: Record<QuotationStatus, Tone> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'pending',
  APPROVED: 'success',
  REJECTED: 'danger',
  REVISION_REQUIRED: 'warning',
  SENT: 'info',
  UNDER_NEGOTIATION: 'warning',
  CONFIRMED: 'success',
  FULFILLMENT: 'info',
  COMPLETED: 'success',
};

/**
 * Pipeline column order for the Kanban board (PRD §10).
 * `REJECTED` is excluded from the board and surfaced through filters instead so a
 * dead deal does not occupy a lane.
 */
export const PIPELINE_STAGES: readonly QuotationStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SENT',
  'UNDER_NEGOTIATION',
  'CONFIRMED',
  'FULFILLMENT',
  'COMPLETED',
];

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  REVISION_REQUIRED: 'Returned for Revision',
  SUPERSEDED: 'Superseded',
};

export const APPROVAL_STATUS_TONES: Record<ApprovalStatus, Tone> = {
  PENDING: 'pending',
  APPROVED: 'success',
  REJECTED: 'danger',
  REVISION_REQUIRED: 'warning',
  SUPERSEDED: 'neutral',
};

export const APPROVAL_LEVEL_LABELS: Record<ApprovalLevel, string> = {
  MANAGER: 'Sales Manager',
  FINANCE: 'Finance / Operations',
};

export const REQUIRED_APPROVAL_LABELS: Record<RequiredApprovalLevel, string> = {
  NONE: 'No approval required',
  MANAGER: 'Sales Manager approval',
  MANAGER_FINANCE: 'Sales Manager → Finance approval',
};

export const FULFILLMENT_STATUS_LABELS: Record<FulfillmentStatus, string> = {
  NOT_STARTED: 'Not Started',
  ALLOCATING: 'Allocating',
  PARTIALLY_ALLOCATED: 'Partially Allocated',
  ALLOCATED: 'Allocated',
  BACKORDERED: 'Backordered',
  PARTIALLY_FULFILLED: 'Partially Fulfilled',
  FULFILLED: 'Fulfilled',
};

export const FULFILLMENT_STATUS_TONES: Record<FulfillmentStatus, Tone> = {
  NOT_STARTED: 'neutral',
  ALLOCATING: 'pending',
  PARTIALLY_ALLOCATED: 'warning',
  ALLOCATED: 'info',
  BACKORDERED: 'danger',
  PARTIALLY_FULFILLED: 'warning',
  FULFILLED: 'success',
};

export const BACKORDER_STATUS_LABELS: Record<BackorderStatus, string> = {
  OPEN: 'Awaiting Stock',
  STOCK_AVAILABLE: 'Stock Available',
  CONSOLIDATED: 'Consolidated',
  CANCELLED: 'Cancelled',
};

export const BILLING_TYPE_LABELS: Record<BillingType, string> = {
  ONE_TIME: 'One-time',
  RECURRING: 'Recurring',
};

export const SUBSCRIPTION_INTERVAL_LABELS: Record<SubscriptionInterval, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
};

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  PENDING: 'Pending',
  ACTIVE: 'Active',
  MODIFIED: 'Active (Modified)',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

export const BILLING_SCHEDULE_STATUS_LABELS: Record<BillingScheduleStatus, string> = {
  SCHEDULED: 'Scheduled',
  INVOICED: 'Invoiced',
  PAID: 'Paid',
  SKIPPED: 'Skipped',
  CANCELLED: 'Cancelled',
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  PARTIALLY_PAID: 'Partially Paid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
};

export const INVOICE_STATUS_TONES: Record<InvoiceStatus, Tone> = {
  DRAFT: 'neutral',
  ISSUED: 'info',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  OVERDUE: 'danger',
};

export const NEGOTIATION_REQUEST_TYPE_LABELS: Record<NegotiationRequestType, string> = {
  QUESTION: 'Question',
  DISCOUNT_COUNTER: 'Counter Discount',
  QUANTITY_CHANGE: 'Quantity Change',
  LINE_REMOVAL: 'Remove Line',
};

export const NEGOTIATION_STATUS_LABELS: Record<NegotiationStatus, string> = {
  SUBMITTED: 'Submitted',
  APPLIED: 'Applied',
  PENDING_APPROVAL: 'Applied — Pending Approval',
  ANSWERED: 'Answered',
  REJECTED: 'Declined',
};

export const DEAL_HEALTH_TYPE_LABELS: Record<DealHealthType, string> = {
  STALLED: 'Stalled Deal',
  DISCOUNT_ANOMALY: 'Discount Anomaly',
  DELIVERY_SLIPPAGE: 'Delivery Promise Slippage',
};

export const DEAL_HEALTH_SEVERITY_TONES: Record<DealHealthSeverity, Tone> = {
  LOW: 'info',
  MEDIUM: 'warning',
  HIGH: 'danger',
};
