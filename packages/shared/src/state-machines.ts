/**
 * Explicit state machines.
 *
 * STATE_MACHINES.md permits collapsing states but requires transitions to stay
 * explicit, and AGENT_INSTRUCTIONS.md §6 requires illegal transitions to be
 * rejected outright — the named example being that `PENDING_APPROVAL` must never
 * jump straight to a customer-confirmed state.
 *
 * Transition tables live in shared code so the UI can decide which buttons to
 * offer from the same source of truth the API enforces. The UI reading this table
 * is a convenience; the API reading it is the actual guard.
 */

import type {
  ApprovalStatus,
  BackorderStatus,
  FulfillmentStatus,
  InvoiceStatus,
  QuotationStatus,
  SubscriptionStatus,
} from './enums.js';

type TransitionMap<T extends string> = Readonly<Record<T, readonly T[]>>;

/**
 * Quotation lifecycle.
 *
 * `DRAFT → APPROVED` is legal and intentional: it is the "approval skipped" edge
 * from WORKFLOWS.md §3, taken only when the risk engine returns a required level
 * of `NONE`. It is not a bypass — the engine, not the caller, decides.
 *
 * `UNDER_NEGOTIATION → SENT` is the "no approval needed" outcome of the
 * negotiation risk check (STATE_MACHINES.md "Negotiation"): the customer gets an
 * updated quote back without an approval round trip.
 */
export const QUOTATION_TRANSITIONS: TransitionMap<QuotationStatus> = {
  DRAFT: ['PENDING_APPROVAL', 'APPROVED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'REVISION_REQUIRED'],
  APPROVED: ['SENT', 'PENDING_APPROVAL', 'DRAFT'],
  REJECTED: [],
  REVISION_REQUIRED: ['DRAFT'],
  SENT: ['UNDER_NEGOTIATION', 'CONFIRMED', 'PENDING_APPROVAL', 'DRAFT'],
  UNDER_NEGOTIATION: ['PENDING_APPROVAL', 'SENT', 'CONFIRMED', 'REJECTED', 'REVISION_REQUIRED', 'DRAFT'],
  CONFIRMED: ['FULFILLMENT'],
  FULFILLMENT: ['COMPLETED'],
  COMPLETED: [],
};

/** Statuses in which a quotation's commercial terms may still be edited internally. */
export const EDITABLE_QUOTATION_STATUSES: readonly QuotationStatus[] = ['DRAFT', 'REVISION_REQUIRED'];

/** Statuses that represent a live approval requirement. */
export const APPROVAL_BLOCKING_STATUSES: readonly QuotationStatus[] = ['PENDING_APPROVAL'];

/** Statuses from which the customer portal is allowed to act on a quotation. */
export const PORTAL_ACTIONABLE_STATUSES: readonly QuotationStatus[] = ['SENT', 'UNDER_NEGOTIATION'];

/** Statuses in which the customer is allowed to *see* a quotation at all. */
export const PORTAL_VISIBLE_STATUSES: readonly QuotationStatus[] = [
  'SENT',
  'UNDER_NEGOTIATION',
  'PENDING_APPROVAL',
  'CONFIRMED',
  'FULFILLMENT',
  'COMPLETED',
  'REJECTED',
];

export const APPROVAL_TRANSITIONS: TransitionMap<ApprovalStatus> = {
  PENDING: ['APPROVED', 'REJECTED', 'REVISION_REQUIRED', 'SUPERSEDED'],
  APPROVED: ['SUPERSEDED'],
  REJECTED: [],
  REVISION_REQUIRED: [],
  SUPERSEDED: [],
};

export const FULFILLMENT_TRANSITIONS: TransitionMap<FulfillmentStatus> = {
  NOT_STARTED: ['ALLOCATING'],
  ALLOCATING: ['ALLOCATED', 'PARTIALLY_ALLOCATED', 'BACKORDERED', 'NOT_STARTED'],
  PARTIALLY_ALLOCATED: ['BACKORDERED', 'ALLOCATED', 'ALLOCATING', 'PARTIALLY_FULFILLED'],
  ALLOCATED: ['PARTIALLY_FULFILLED', 'FULFILLED', 'ALLOCATING'],
  BACKORDERED: ['ALLOCATING', 'PARTIALLY_FULFILLED', 'ALLOCATED', 'FULFILLED'],
  PARTIALLY_FULFILLED: ['FULFILLED', 'BACKORDERED', 'ALLOCATING'],
  FULFILLED: [],
};

export const BACKORDER_TRANSITIONS: TransitionMap<BackorderStatus> = {
  OPEN: ['STOCK_AVAILABLE', 'CANCELLED'],
  STOCK_AVAILABLE: ['CONSOLIDATED', 'OPEN', 'CANCELLED'],
  CONSOLIDATED: [],
  CANCELLED: [],
};

export const SUBSCRIPTION_TRANSITIONS: TransitionMap<SubscriptionStatus> = {
  PENDING: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['MODIFIED', 'CANCELLED', 'EXPIRED'],
  MODIFIED: ['MODIFIED', 'CANCELLED', 'EXPIRED'],
  CANCELLED: [],
  EXPIRED: [],
};

export const INVOICE_TRANSITIONS: TransitionMap<InvoiceStatus> = {
  DRAFT: ['ISSUED'],
  ISSUED: ['PARTIALLY_PAID', 'PAID', 'OVERDUE'],
  PARTIALLY_PAID: ['PAID', 'OVERDUE'],
  OVERDUE: ['PARTIALLY_PAID', 'PAID'],
  PAID: [],
};

/** True when `to` is reachable from `from` in one step. Self-transitions are legal no-ops. */
export function canTransition<T extends string>(map: TransitionMap<T>, from: T, to: T): boolean {
  if (from === to) return true;
  return (map[from] ?? []).includes(to);
}

/** Every status reachable from `from` in one step, for UI affordances. */
export function nextStates<T extends string>(map: TransitionMap<T>, from: T): readonly T[] {
  return map[from] ?? [];
}
