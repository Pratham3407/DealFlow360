import { QuotationStatus } from '../../generated/prisma/enums';
import { InvalidStateTransitionError } from '../../http/errors';

/**
 * Quotation state machine — docs/STATE_MACHINES.md.
 *
 * Pure: a transition table plus assertions over it, no database access, so every
 * legal and illegal edge is unit testable. Clients never set `status`; they invoke
 * a domain operation and the service asks this module whether it is allowed.
 *
 * The table is the whole truth about legality. Which *actor* may perform a
 * transition is a capability question answered by the route guard, and which
 * transitions are *automatic* is answered by the risk and approval engines in
 * later slices.
 */

const S = QuotationStatus;

/**
 * Legal successor states.
 *
 * Terminal-ish states are deliberately not dead ends where the documented flow
 * continues: REJECTED and REVISION_REQUIRED both return to DRAFT, because a
 * rejected quotation is reworked rather than recreated (docs/WORKFLOWS.md 4).
 */
const TRANSITIONS: Readonly<Record<QuotationStatus, readonly QuotationStatus[]>> = {
  [S.DRAFT]: [S.PENDING_APPROVAL, S.APPROVED, S.SENT],
  [S.PENDING_APPROVAL]: [S.APPROVED, S.REJECTED, S.REVISION_REQUIRED],
  [S.APPROVED]: [S.SENT, S.REVISION_REQUIRED, S.PENDING_APPROVAL],
  [S.SENT]: [S.UNDER_NEGOTIATION, S.CONFIRMED, S.REVISION_REQUIRED],
  [S.UNDER_NEGOTIATION]: [S.CONFIRMED, S.REVISION_REQUIRED, S.PENDING_APPROVAL, S.DRAFT],
  [S.CONFIRMED]: [S.FULFILLMENT],
  [S.FULFILLMENT]: [],
  [S.REJECTED]: [S.DRAFT],
  [S.REVISION_REQUIRED]: [S.DRAFT],
};

/**
 * States in which the commercial content of a quotation may still be edited.
 *
 * Everything else is either under review, with the customer, or committed. This
 * is the gate that stops a line being added to an approved quotation behind the
 * approver's back — a material change after approval must go through revision
 * (AGENTS.md §11), not happen silently.
 */
const EDITABLE_STATES: readonly QuotationStatus[] = [S.DRAFT, S.REVISION_REQUIRED];

export function canTransition(from: QuotationStatus, to: QuotationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: QuotationStatus): readonly QuotationStatus[] {
  return TRANSITIONS[from];
}

export function assertTransition(from: QuotationStatus, to: QuotationStatus): void {
  if (from === to) {
    throw new InvalidStateTransitionError(`This quotation is already ${from}`);
  }
  if (!canTransition(from, to)) {
    const allowed = TRANSITIONS[from];
    throw new InvalidStateTransitionError(
      allowed.length === 0
        ? `A quotation in ${from} cannot change state`
        : `A quotation in ${from} cannot move to ${to}; allowed: ${allowed.join(', ')}`,
    );
  }
}

export function isEditable(status: QuotationStatus): boolean {
  return EDITABLE_STATES.includes(status);
}

/**
 * Guard for any change to commercial content — lines, discounts, the customer.
 *
 * Names the states that would accept the edit, so the caller learns what to do
 * rather than only that it failed.
 */
export function assertEditable(status: QuotationStatus): void {
  if (isEditable(status)) return;
  throw new InvalidStateTransitionError(
    `A quotation in ${status} cannot be edited. Only ${EDITABLE_STATES.join(' or ')} quotations accept commercial changes.`,
  );
}

/**
 * Whether a quotation in this state may be submitted for approval.
 *
 * Kept separate from `canTransition` because submission is a domain operation
 * whose target state depends on the risk score: a quotation needing no approval
 * goes straight to APPROVED, one needing approval goes to PENDING_APPROVAL. The
 * risk engine decides which; this only says submission is possible at all.
 */
export function canSubmit(status: QuotationStatus): boolean {
  return isEditable(status);
}
