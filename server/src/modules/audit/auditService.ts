import { Prisma } from '../../generated/prisma/client';
import type { Role } from '../../generated/prisma/enums';
import type { Db } from '../../db/prisma';

/**
 * Canonical audit actions.
 *
 * The list mirrors the minimum event set in docs/PRD.md 20 so that action names
 * stay stable across modules and reports. Later slices consume the entries that
 * belong to their domain; auth-related actions are already in use.
 */
export const AuditAction = {
  // Authentication and user administration
  USER_LOGGED_IN: 'USER_LOGGED_IN',
  USER_LOGIN_FAILED: 'USER_LOGIN_FAILED',
  USER_LOGGED_OUT: 'USER_LOGGED_OUT',
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',

  // Quotation lifecycle
  QUOTATION_CREATED: 'QUOTATION_CREATED',
  QUOTATION_EDITED: 'QUOTATION_EDITED',
  QUOTATION_LINE_ADDED: 'QUOTATION_LINE_ADDED',
  QUOTATION_LINE_REMOVED: 'QUOTATION_LINE_REMOVED',
  DISCOUNT_CHANGED: 'DISCOUNT_CHANGED',
  QUOTATION_SENT: 'QUOTATION_SENT',
  QUOTATION_CONFIRMED: 'QUOTATION_CONFIRMED',

  // Approval
  APPROVAL_REQUESTED: 'APPROVAL_REQUESTED',
  APPROVAL_APPROVED: 'APPROVAL_APPROVED',
  APPROVAL_REJECTED: 'APPROVAL_REJECTED',
  APPROVAL_REVISION_REQUESTED: 'APPROVAL_REVISION_REQUESTED',
  APPROVAL_INVALIDATED: 'APPROVAL_INVALIDATED',

  // Negotiation
  NEGOTIATION_STARTED: 'NEGOTIATION_STARTED',
  NEGOTIATION_SUBMITTED: 'NEGOTIATION_SUBMITTED',
  NEGOTIATION_RESPONDED: 'NEGOTIATION_RESPONDED',
  CUSTOMER_CONFIRMED: 'CUSTOMER_CONFIRMED',

  // Fulfillment
  ALLOCATION_ACCEPTED: 'ALLOCATION_ACCEPTED',
  ALLOCATION_OVERRIDDEN: 'ALLOCATION_OVERRIDDEN',
  BACKORDER_CREATED: 'BACKORDER_CREATED',
  BACKORDER_CONSOLIDATED: 'BACKORDER_CONSOLIDATED',

  // Billing
  INVOICE_ISSUED: 'INVOICE_ISSUED',
  PAYMENT_RECORDED: 'PAYMENT_RECORDED',
  SUBSCRIPTION_CHANGED: 'SUBSCRIPTION_CHANGED',
  SUBSCRIPTION_CANCELLED: 'SUBSCRIPTION_CANCELLED',
  CREDIT_NOTE_ISSUED: 'CREDIT_NOTE_ISSUED',

  // Configuration
  CONFIGURATION_CHANGED: 'CONFIGURATION_CHANGED',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/** Entity type names used in audit rows. Kept as data so reports can group on them. */
export const AuditEntity = {
  USER: 'User',
  SESSION: 'Session',

  // Master data
  CUSTOMER_TIER: 'CustomerTier',
  CUSTOMER: 'Customer',
  CATEGORY: 'Category',
  PRODUCT: 'Product',
  PRODUCT_VARIANT: 'ProductVariant',
  PRICE_LIST: 'PriceList',
  PRICE_LIST_ITEM: 'PriceListItem',
  DISCOUNT_RULE: 'DiscountRule',
  APPROVAL_RULE: 'ApprovalRule',
  WAREHOUSE: 'Warehouse',
  INVENTORY: 'Inventory',
  SUBSCRIPTION_PLAN: 'SubscriptionPlan',
  PRODUCT_PAIRING: 'ProductPairing',
  PROMOTION: 'Promotion',

  // Transactional
  QUOTATION: 'Quotation',
  QUOTATION_LINE: 'QuotationLine',
  APPROVAL_INSTANCE: 'ApprovalInstance',
  NEGOTIATION_REQUEST: 'NegotiationRequest',
  FULFILLMENT: 'Fulfillment',
  INVOICE: 'Invoice',
  PAYMENT: 'Payment',
  SUBSCRIPTION: 'Subscription',
} as const;

export type AuditEntity = (typeof AuditEntity)[keyof typeof AuditEntity];

export interface AuditInput {
  action: AuditAction;
  entityType: AuditEntity;
  /** Usually a UUID. For pre-authentication events it may be the submitted email. */
  entityId: string;
  actorUserId?: string | null;
  actorRole?: Role | null;
  oldValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
  reason?: string | null;
  /** Quotation (or other entity) version the action applied to. */
  entityVersion?: number | null;
  ip?: string | null;
}

/**
 * Append an audit record.
 *
 * Pass the transaction client when the audited change is itself transactional,
 * so the record and the state change commit or roll back together
 * (AGENTS.md 25). There is deliberately no update or delete counterpart: audit
 * history is append-only (AGENTS.md 20), and the actor foreign key is
 * ON DELETE RESTRICT so attribution cannot be erased by removing a user.
 */
export async function recordAudit(db: Db, input: AuditInput): Promise<void> {
  await db.auditLog.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      actorUserId: input.actorUserId ?? null,
      actorRole: input.actorRole ?? null,
      // Prisma distinguishes SQL NULL (DbNull) from the JSON value `null`
      // (JsonNull) for nullable Json columns. "Nothing recorded" is SQL NULL.
      oldValue: input.oldValue ?? Prisma.DbNull,
      newValue: input.newValue ?? Prisma.DbNull,
      reason: input.reason ?? null,
      entityVersion: input.entityVersion ?? null,
      ip: input.ip ?? null,
    },
  });
}
