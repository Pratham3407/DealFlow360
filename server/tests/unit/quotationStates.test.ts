import { describe, expect, it } from 'vitest';
import { QuotationStatus } from '../../src/generated/prisma/enums';
import { AppError } from '../../src/http/errors';
import {
  allowedTransitions,
  assertEditable,
  assertTransition,
  canSubmit,
  canTransition,
  isEditable,
} from '../../src/modules/quotations/quotationStates';

const S = QuotationStatus;

describe('legal transitions (docs/STATE_MACHINES.md)', () => {
  it('follows the documented happy path', () => {
    expect(canTransition(S.DRAFT, S.PENDING_APPROVAL)).toBe(true);
    expect(canTransition(S.PENDING_APPROVAL, S.APPROVED)).toBe(true);
    expect(canTransition(S.APPROVED, S.SENT)).toBe(true);
    expect(canTransition(S.SENT, S.UNDER_NEGOTIATION)).toBe(true);
    expect(canTransition(S.UNDER_NEGOTIATION, S.CONFIRMED)).toBe(true);
    expect(canTransition(S.CONFIRMED, S.FULFILLMENT)).toBe(true);
  });

  it('lets a low-risk quotation skip approval', () => {
    // Workflow 3: risk within threshold means approval is skipped, not forged.
    expect(canTransition(S.DRAFT, S.APPROVED)).toBe(true);
    expect(canTransition(S.DRAFT, S.SENT)).toBe(true);
  });

  it('allows a sent quotation to be confirmed without negotiating', () => {
    expect(canTransition(S.SENT, S.CONFIRMED)).toBe(true);
  });

  it('supports both rejection outcomes of a review', () => {
    expect(canTransition(S.PENDING_APPROVAL, S.REJECTED)).toBe(true);
    expect(canTransition(S.PENDING_APPROVAL, S.REVISION_REQUIRED)).toBe(true);
  });

  it('returns a rejected or returned quotation to DRAFT for rework', () => {
    expect(canTransition(S.REJECTED, S.DRAFT)).toBe(true);
    expect(canTransition(S.REVISION_REQUIRED, S.DRAFT)).toBe(true);
  });

  it('lets an approved quotation re-enter approval after a material change', () => {
    // AGENTS.md 11: a material change invalidates approval, so the quotation must
    // be able to go back for review.
    expect(canTransition(S.APPROVED, S.PENDING_APPROVAL)).toBe(true);
    expect(canTransition(S.UNDER_NEGOTIATION, S.PENDING_APPROVAL)).toBe(true);
  });
});

describe('illegal transitions', () => {
  it('refuses to jump from PENDING_APPROVAL straight to CONFIRMED', () => {
    // docs/AGENT_INSTRUCTIONS.md 6 names this explicitly.
    expect(canTransition(S.PENDING_APPROVAL, S.CONFIRMED)).toBe(false);
    expect(() => assertTransition(S.PENDING_APPROVAL, S.CONFIRMED)).toThrow(AppError);
  });

  it('refuses to skip approval into SENT from PENDING_APPROVAL', () => {
    expect(canTransition(S.PENDING_APPROVAL, S.SENT)).toBe(false);
  });

  it('refuses to confirm a draft', () => {
    expect(canTransition(S.DRAFT, S.CONFIRMED)).toBe(false);
    expect(canTransition(S.DRAFT, S.FULFILLMENT)).toBe(false);
  });

  it('treats FULFILLMENT as terminal', () => {
    expect(allowedTransitions(S.FULFILLMENT)).toEqual([]);
    expect(canTransition(S.FULFILLMENT, S.CONFIRMED)).toBe(false);
    expect(() => assertTransition(S.FULFILLMENT, S.DRAFT)).toThrow(/cannot change state/i);
  });

  it('will not reopen a rejected quotation anywhere except DRAFT', () => {
    expect(canTransition(S.REJECTED, S.APPROVED)).toBe(false);
    expect(canTransition(S.REJECTED, S.SENT)).toBe(false);
  });

  it('refuses a transition to the same state', () => {
    expect(() => assertTransition(S.DRAFT, S.DRAFT)).toThrow(/already DRAFT/);
  });

  it('reports the allowed targets when refusing', () => {
    try {
      assertTransition(S.DRAFT, S.CONFIRMED);
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('PENDING_APPROVAL');
    }
  });

  it('raises INVALID_STATE_TRANSITION with a 409', () => {
    try {
      assertTransition(S.CONFIRMED, S.DRAFT);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('INVALID_STATE_TRANSITION');
      expect((error as AppError).status).toBe(409);
    }
  });
});

describe('edit gate', () => {
  it('permits commercial edits only in DRAFT and REVISION_REQUIRED', () => {
    expect(isEditable(S.DRAFT)).toBe(true);
    expect(isEditable(S.REVISION_REQUIRED)).toBe(true);

    for (const status of [
      S.PENDING_APPROVAL,
      S.APPROVED,
      S.SENT,
      S.UNDER_NEGOTIATION,
      S.CONFIRMED,
      S.FULFILLMENT,
      S.REJECTED,
    ]) {
      expect(isEditable(status), status).toBe(false);
    }
  });

  it('refuses an edit to an approved quotation, so approval cannot be bypassed', () => {
    // Editing after approval would leave the approver's decision attached to
    // different commercial terms.
    expect(() => assertEditable(S.APPROVED)).toThrow(/cannot be edited/);
    expect(() => assertEditable(S.PENDING_APPROVAL)).toThrow(/cannot be edited/);
  });

  it('names the states that would accept the edit', () => {
    try {
      assertEditable(S.SENT);
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('DRAFT');
      expect((error as Error).message).toContain('REVISION_REQUIRED');
    }
  });

  it('allows an edit in an editable state', () => {
    expect(() => assertEditable(S.DRAFT)).not.toThrow();
    expect(() => assertEditable(S.REVISION_REQUIRED)).not.toThrow();
  });
});

describe('submission', () => {
  it('is possible exactly when the quotation is still editable', () => {
    expect(canSubmit(S.DRAFT)).toBe(true);
    expect(canSubmit(S.REVISION_REQUIRED)).toBe(true);
    expect(canSubmit(S.PENDING_APPROVAL)).toBe(false);
    expect(canSubmit(S.APPROVED)).toBe(false);
    expect(canSubmit(S.CONFIRMED)).toBe(false);
  });
});

describe('table integrity', () => {
  it('defines successors for every status, with no self-loops or duplicates', () => {
    for (const status of Object.values(S)) {
      const targets = allowedTransitions(status);
      expect(Array.isArray(targets), status).toBe(true);
      expect(targets).not.toContain(status);
      expect(new Set(targets).size).toBe(targets.length);
    }
  });

  it('leaves every status reachable from DRAFT, so no state is dead configuration', () => {
    const seen = new Set<QuotationStatus>([S.DRAFT]);
    const queue: QuotationStatus[] = [S.DRAFT];

    while (queue.length > 0) {
      for (const next of allowedTransitions(queue.shift()!)) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }

    expect(seen.size).toBe(Object.values(S).length);
  });
});
