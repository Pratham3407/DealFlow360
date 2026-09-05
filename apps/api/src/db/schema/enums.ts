/**
 * PostgreSQL enum types.
 *
 * Every fixed vocabulary in the domain is a real database enum so an invalid
 * state cannot be persisted even by a raw SQL statement — DOMAIN_MODEL.md's
 * invariants and STATE_MACHINES.md's "never allow illegal transitions" rule are
 * enforced at the storage layer as well as the service layer.
 *
 * The `as const` string tuples come from `@dealflow/shared` so the TypeScript
 * union, the API contract, the UI label map and the database type can never
 * drift apart.
 *
 * Deliberately *not* an enum: `Category`. DOMAIN_MODEL.md states categories are
 * admin-defined rows carrying their own discount ceiling (PRD FR-3), so a fixed
 * enum would make the core "Hardware 15% / Services 10%" rule unconfigurable.
 */

import { pgEnum } from 'drizzle-orm/pg-core';
import {
  APPROVAL_LEVELS,
  APPROVAL_LEVELS_REQUIRED,
  APPROVAL_STATUSES,
  BACKORDER_STATUSES,
  BILLING_SCHEDULE_STATUSES,
  BILLING_TYPES,
  CANCELLATION_MODES,
  DAY_COUNT_CONVENTIONS,
  DEAL_HEALTH_SEVERITIES,
  DEAL_HEALTH_TYPES,
  FULFILLMENT_STATUSES,
  INVOICE_STATUSES,
  INVOICE_TYPES,
  NEGOTIATION_REQUEST_TYPES,
  NEGOTIATION_STATUSES,
  PAYMENT_STATUSES,
  PRORATION_MODES,
  QUOTATION_STATUSES,
  REFUND_MODES,
  ROLES,
  SUBSCRIPTION_INTERVALS,
  SUBSCRIPTION_STATUSES,
} from '@dealflow/shared';

export const roleEnum = pgEnum('role', ROLES);
export const quotationStatusEnum = pgEnum('quotation_status', QUOTATION_STATUSES);
export const requiredApprovalLevelEnum = pgEnum('required_approval_level', APPROVAL_LEVELS_REQUIRED);
export const approvalLevelEnum = pgEnum('approval_level', APPROVAL_LEVELS);
export const approvalStatusEnum = pgEnum('approval_status', APPROVAL_STATUSES);
export const fulfillmentStatusEnum = pgEnum('fulfillment_status', FULFILLMENT_STATUSES);
export const backorderStatusEnum = pgEnum('backorder_status', BACKORDER_STATUSES);
export const billingTypeEnum = pgEnum('billing_type', BILLING_TYPES);
export const subscriptionIntervalEnum = pgEnum('subscription_interval', SUBSCRIPTION_INTERVALS);
export const subscriptionStatusEnum = pgEnum('subscription_status', SUBSCRIPTION_STATUSES);
export const prorationModeEnum = pgEnum('proration_mode', PRORATION_MODES);
export const cancellationModeEnum = pgEnum('cancellation_mode', CANCELLATION_MODES);
export const refundModeEnum = pgEnum('refund_mode', REFUND_MODES);
export const dayCountConventionEnum = pgEnum('day_count_convention', DAY_COUNT_CONVENTIONS);
export const billingScheduleStatusEnum = pgEnum('billing_schedule_status', BILLING_SCHEDULE_STATUSES);
export const invoiceTypeEnum = pgEnum('invoice_type', INVOICE_TYPES);
export const invoiceStatusEnum = pgEnum('invoice_status', INVOICE_STATUSES);
export const paymentStatusEnum = pgEnum('payment_status', PAYMENT_STATUSES);
export const negotiationRequestTypeEnum = pgEnum('negotiation_request_type', NEGOTIATION_REQUEST_TYPES);
export const negotiationStatusEnum = pgEnum('negotiation_status', NEGOTIATION_STATUSES);
export const dealHealthTypeEnum = pgEnum('deal_health_type', DEAL_HEALTH_TYPES);
export const dealHealthSeverityEnum = pgEnum('deal_health_severity', DEAL_HEALTH_SEVERITIES);
