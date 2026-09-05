/**
 * Approval engine.
 *
 * Approvals are raised by the quotation service; this module is the only writer
 * that resolves them. Every action here is the legal path for a state change —
 * STATE_MACHINES.md's quoted example (`PENDING_APPROVAL → APPROVED`) is only
 * reachable through these functions, never through a client-side mutation.
 *
 * ## Sequencing
 *
 * Rungs carry `attempt` and `sequence`. A `MANAGER` rung may only be resolved by
 * a Sales Manager (or Admin); a `FINANCE` rung only by Finance/Operations (or
 * Admin); and a `FINANCE` rung may not be resolved while its attempt's `MANAGER`
 * rung is still pending. Any rejection or return supersedes the remaining
 * pending rungs of the same attempt.
 *
 * ## Versioning
 *
 * An approval is bound to the quote version it was raised against. If the quote
 * version has moved (a negotiation was applied, for example) the rung is stale
 * and cannot be acted on — it is superseded instead.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import {
  approvalInstances,
  negotiationRequests,
  quotations,
} from '@/db/schema/index.js';
import type { ApprovalLevel, ApprovalStatus, Role } from '@dealflow/shared';
import type { DbExecutor } from '@/db/client.js';
import { writeAudit, type AuditActor } from '../audit/audit.service.js';
import { conflict, forbidden, notFound } from '@/lib/errors.js';

export interface ApprovalActor extends AuditActor {
  userId: string;
  role: Role;
}

const LEVEL_ROLES: Record<ApprovalLevel, readonly Role[]> = {
  MANAGER: ['SALES_MANAGER', 'ADMIN'],
  FINANCE: ['FINANCE_OPERATIONS', 'ADMIN'],
};

export async function listApprovals(exec: DbExecutor, quoteId?: string, onlyPending = true) {
  const rows = await exec.query.approvalInstances.findMany({
    where: (table, { and, eq }) =>
      and(onlyPending ? eq(table.status, 'PENDING') : undefined, quoteId ? eq(table.quotationId, quoteId) : undefined),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
    with: { quotation: true },
  });
  return rows;
}

export async function getApproval(exec: DbExecutor, approvalId: string) {
  return exec.query.approvalInstances.findFirst({
    where: (table, { eq }) => eq(table.id, approvalId),
    with: { quotation: { with: { lines: true } } },
  });
}

/** Authorise an actor against a rung's level and return the error type. */
function assertCanAct(actor: ApprovalActor, level: ApprovalLevel) {
  const allowed = LEVEL_ROLES[level];
  if (!allowed.includes(actor.role)) {
    throw forbidden('APPROVAL_ROLE', `Only ${allowed.join(' or ')} may resolve a ${level} approval`);
  }
}

async function supersedeSiblings(exec: DbExecutor, approvalId: string): Promise<void> {
  const approval = await exec.query.approvalInstances.findFirst({
    where: (table, { eq }) => eq(table.id, approvalId),
  });
  if (!approval) return;
  await exec
    .update(approvalInstances)
    .set({ status: 'SUPERSEDED' })
    .where(
      and(
        eq(approvalInstances.quotationId, approval.quotationId),
        eq(approvalInstances.attempt, approval.attempt),
        eq(approvalInstances.status, 'PENDING'),
        sql`${approvalInstances.id} <> ${approvalId}`,
      ),
    );
}

async function findNegotiationWaiting(exec: DbExecutor, quotationId: string) {
  return exec.query.negotiationRequests.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.quotationId, quotationId), eq(table.status, 'PENDING_APPROVAL')),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  });
}

/**
 * Approve one rung.
 *
 * Only the oldest pending rung of the current attempt may be approved; acting on
 * a Finance rung before its Manager rung clears is rejected.
 */
export async function approveApproval(exec: DbExecutor, approvalId: string, actor: ApprovalActor, reason?: string) {
  const approval = await getApproval(exec, approvalId);
  if (!approval) throw notFound('APPROVAL_NOT_FOUND', 'Approval not found');
  if (approval.status !== 'PENDING') {
    throw conflict('APPROVAL_STATE', `Approval is ${approval.status} and cannot be approved`);
  }
  assertCanAct(actor, approval.level);

  const quote = approval.quotation;
  if (approval.quotationVersion !== quote.version) {
    await supersedeRung(exec, approval.id);
    throw conflict(
      'APPROVAL_STALE',
      `Approval targets quote version ${approval.quotationVersion}; quote is now ${quote.version}`,
    );
  }

  // Enforce sequencing: the previous rung of this attempt must already be approved.
  if (approval.sequence > 1) {
    const prior = await exec.query.approvalInstances.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.quotationId, approval.quotationId),
          eq(table.attempt, approval.attempt),
          eq(table.sequence, approval.sequence - 1),
        ),
    });
    if (!prior || prior.status !== 'APPROVED') {
      throw conflict('APPROVAL_SEQUENCE', `The previous approval level has not been resolved`);
    }
  }

  await exec
    .update(approvalInstances)
    .set({
      status: 'APPROVED',
      reviewerId: actor.userId,
      reason: reason ?? null,
      actedAt: new Date(),
    })
    .where(eq(approvalInstances.id, approval.id));

  const nextRung = await exec.query.approvalInstances.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.quotationId, approval.quotationId),
        eq(table.attempt, approval.attempt),
        eq(table.sequence, approval.sequence + 1),
      ),
  });

  let finalStatus: 'APPROVED' | 'SENT' = 'APPROVED';

  if (!nextRung || nextRung.status !== 'PENDING') {
    const pending = await exec.query.approvalInstances.findFirst({
      where: (table, { and, eq, not }) =>
        and(
          eq(table.quotationId, approval.quotationId),
          eq(table.attempt, approval.attempt),
          eq(table.status, 'PENDING'),
        ),
    });
    if (!pending || pending.id === approval.id) {
      // All rungs resolved → the quote is approved.
      const awaitingNegotiation = await findNegotiationWaiting(exec, approval.quotationId);
      finalStatus = awaitingNegotiation ? 'SENT' : 'APPROVED';

      await exec
        .update(quotations)
        .set({
          status: finalStatus,
          approvedVersion: quote.version,
          approvedAt: new Date(),
        })
        .where(eq(quotations.id, approval.quotationId));

      if (awaitingNegotiation) {
        await exec
          .update(negotiationRequests)
          .set({ status: 'APPLIED', resultingVersion: quote.version })
          .where(eq(negotiationRequests.id, awaitingNegotiation.id));
      }
    }
  }

  await writeAudit(exec, {
    ...actor,
    entityType: 'APPROVAL_INSTANCE',
    entityId: approval.id,
    action: 'APPROVAL_APPROVED',
    oldValue: { status: approval.status },
    newValue: { level: approval.level, sequence: approval.sequence, attempt: approval.attempt },
    quotationId: approval.quotationId,
    quotationVersion: approval.quotationVersion,
    reason: reason ?? `Approved at ${approval.level}`,
  });

  return getApproval(exec, approval.id);
}

export async function rejectApproval(exec: DbExecutor, approvalId: string, actor: ApprovalActor, reason: string) {
  const approval = await getApproval(exec, approvalId);
  if (!approval) throw notFound('APPROVAL_NOT_FOUND', 'Approval not found');
  if (approval.status !== 'PENDING') {
    throw conflict('APPROVAL_STATE', `Approval is ${approval.status} and cannot be rejected`);
  }
  assertCanAct(actor, approval.level);

  await supersedeSiblings(exec, approval.id);
  await exec
    .update(approvalInstances)
    .set({ status: 'REJECTED', reviewerId: actor.userId, reason: reason || null, actedAt: new Date() })
    .where(eq(approvalInstances.id, approval.id));

  await exec.update(quotations).set({ status: 'REJECTED' }).where(eq(quotations.id, approval.quotationId));

  await writeAudit(exec, {
    ...actor,
    entityType: 'APPROVAL_INSTANCE',
    entityId: approval.id,
    action: 'APPROVAL_REJECTED',
    oldValue: { status: approval.status },
    newValue: { level: approval.level, reason },
    quotationId: approval.quotationId,
    quotationVersion: approval.quotationVersion,
    reason,
  });

  return getApproval(exec, approval.id);
}

export async function returnForRevision(exec: DbExecutor, approvalId: string, actor: ApprovalActor, reason: string) {
  const approval = await getApproval(exec, approvalId);
  if (!approval) throw notFound('APPROVAL_NOT_FOUND', 'Approval not found');
  if (approval.status !== 'PENDING') {
    throw conflict('APPROVAL_STATE', `Approval is ${approval.status} and cannot be returned`);
  }
  assertCanAct(actor, approval.level);

  await supersedeSiblings(exec, approval.id);
  await exec
    .update(approvalInstances)
    .set({ status: 'REVISION_REQUIRED', reviewerId: actor.userId, reason: reason || null, actedAt: new Date() })
    .where(eq(approvalInstances.id, approval.id));

  await exec
    .update(quotations)
    .set({ status: 'REVISION_REQUIRED' })
    .where(eq(quotations.id, approval.quotationId));

  await writeAudit(exec, {
    ...actor,
    entityType: 'APPROVAL_INSTANCE',
    entityId: approval.id,
    action: 'REVISION_REQUESTED',
    oldValue: { status: approval.status },
    newValue: { level: approval.level, reason },
    quotationId: approval.quotationId,
    quotationVersion: approval.quotationVersion,
    reason,
  });

  return getApproval(exec, approval.id);
}

/** Mark a single rung superseded, recording why. */
async function supersedeRung(exec: DbExecutor, approvalId: string): Promise<void> {
  const approval = await exec.query.approvalInstances.findFirst({
    where: (table, { eq }) => eq(table.id, approvalId),
  });
  if (!approval) return;
  const nextStatus: ApprovalStatus = 'SUPERSEDED';
  await exec
    .update(approvalInstances)
    .set({ status: nextStatus })
    .where(eq(approvalInstances.id, approvalId));
}