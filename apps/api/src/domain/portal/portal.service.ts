/**
 * Customer portal (PRD §4, RBAC.md).
 *
 * Two access channels are supported (FR-1): magic link (default for the seed
 * buyer) and email/password. Either way the *identity* always resolves on the
 * server to `users.customer_id`, and every read/write below is scoped to that
 * customer — the request body can never name a customer ID.
 *
 * The portal is deliberately a different view of the same quotation: margin and
 * cost columns are stripped, so what the customer sees is prices, discounts and
 * tax only.
 */

import { and, eq } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { magicLinkTokens, negotiationRequests, quotations } from '@/db/schema/index.js';
import type { DbExecutor } from '@/db/client.js';
import { writeAudit } from '../audit/audit.service.js';
import type { AuditActor } from '../audit/audit.service.js';
import { badRequest, conflict, notFound, unauthorized } from '@/lib/errors.js';
import type { QuotationStatus, NegotiationRequestType } from '@dealflow/shared';
import dayjs from 'dayjs';

export interface PortalActor extends AuditActor {
  userId: string;
  customerId: string;
}

export const MAGIC_LINK_TTL_HOURS = 24;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Create a single-use magic link for a customer's portal user. */
export async function createPortalMagicLink(
  exec: DbExecutor,
  input: {
    customerId: string;
    userId: string;
    quotationId?: string;
  },
  actor: AuditActor,
): Promise<{ url: string; token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = dayjs().add(MAGIC_LINK_TTL_HOURS, 'hour').toDate();

  await exec.insert(magicLinkTokens).values({
    tokenHash: hashToken(token),
    userId: input.userId,
    quotationId: input.quotationId ?? null,
    expiresAt,
  });

  const base = process.env.PORTAL_BASE_URL ?? 'http://localhost:5173';
  const query = new URLSearchParams({ token });
  if (input.quotationId) query.set('quote', input.quotationId);
  const url = `${base}/portal/enter?${query.toString()}`;

  await writeAudit(exec, {
    ...actor,
    entityType: 'USER',
    entityId: input.userId,
    action: 'LOGIN_SUCCEEDED',
    quotationId: input.quotationId ?? undefined,
    reason: 'Portal magic link issued',
  });

  return { url, token, expiresAt };
}

/** Redeem a magic link: validate hash, single use, expiry; return the user + customer. */
export async function exchangeMagicLink(exec: DbExecutor, token: string) {
  const row = await exec.query.magicLinkTokens.findFirst({
    where: (table, { eq }) => eq(table.tokenHash, hashToken(token)),
    with: { user: true },
  });
  if (!row) throw unauthorized('MAGIC_LINK_INVALID', 'Magic link is invalid');
  if (row.usedAt) throw unauthorized('MAGIC_LINK_USED', 'Magic link has already been used');
  if (row.expiresAt < new Date()) throw unauthorized('MAGIC_LINK_EXPIRED', 'Magic link has expired');
  if (!row.user.customerId) throw unauthorized('MAGIC_LINK_SCOPE', 'Portal link is not bound to a customer');

  await exec
    .update(magicLinkTokens)
    .set({ usedAt: new Date() })
    .where(eq(magicLinkTokens.id, row.id));

  return {
    user: row.user,
    customerId: row.user.customerId,
    deepLinkQuotationId: row.quotationId,
  };
}

/** Portal view of a quotation: commercial terms, never cost/margin. */
export async function getPortalQuotation(exec: DbExecutor, customerId: string, quotationId: string) {
  const quote = await exec.query.quotations.findFirst({
    where: (table, { and, eq }) => and(eq(table.id, quotationId), eq(table.customerId, customerId)),
    with: {
      lines: true,
      negotiations: { orderBy: (t, { desc }) => desc(t.createdAt) },
    },
  });
  if (!quote) throw notFound('QUOTE_NOT_FOUND', 'Quotation not found for this customer');

  return {
    ...quote,
    lines: quote.lines.map((line) => ({
      id: line.id,
      productName: line.productName,
      productSku: line.productSku,
      categoryName: line.categoryName,
      quantity: line.quantity,
      listUnitPricePaise: line.listUnitPricePaise,
      unitPricePaise: line.unitPricePaise,
      discountBp: line.discountBp,
      discountAmountPaise: line.discountAmountPaise,
      orderDiscountAmountPaise: line.orderDiscountAmountPaise,
      netAmountPaise: line.netAmountPaise,
      taxAmountPaise: line.taxAmountPaise,
      lineTotalPaise: line.lineTotalPaise,
      lineType: line.lineType,
    })),
    negotiations: quote.negotiations.map((n) => ({
      id: n.id,
      requestType: n.requestType,
      status: n.status,
      proposedDiscountBp: n.proposedDiscountBp,
      proposedQuantity: n.proposedQuantity,
      lineId: n.lineId,
      comment: n.comment,
      createdAt: n.createdAt,
    })),
  } as never;
}

export async function listPortalQuotations(exec: DbExecutor, customerId: string) {
  return exec.query.quotations.findMany({
    where: (table, { eq }) => eq(table.customerId, customerId),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
    columns: {
      id: true,
      quoteNumber: true,
      status: true,
      grandTotalPaise: true,
      createdAt: true,
      sentAt: true,
      version: true,
      riskScoreBp: true,
    },
  });
}

/** Active commerce states a customer may act on. */
const ACTABLE_STATUSES: readonly QuotationStatus[] = ['SENT', 'UNDER_NEGOTIATION'];

export async function submitPortalNegotiation(
  exec: DbExecutor,
  customerId: string,
  quotationId: string,
  input: {
    requestType: NegotiationRequestType;
    lineId?: string;
    proposedDiscountBp?: number;
    proposedQuantity?: number;
    comment?: string;
    version: number;
  },
  actor: PortalActor,
) {
  const quote = await exec.query.quotations.findFirst({
    where: (table, { and, eq }) => and(eq(table.id, quotationId), eq(table.customerId, customerId)),
    with: { lines: true },
  });
  if (!quote) throw notFound('QUOTE_NOT_FOUND', 'Quotation not found for this customer');
  if (!ACTABLE_STATUSES.includes(quote.status)) {
    throw conflict('QUOTE_STATE', `Negotiation requires a sent quote (state: ${quote.status})`);
  }
  if (input.version !== quote.version) {
    throw conflict(
      'NEGOTIATION_STALE',
      `Quote moved to version ${quote.version}; re-read before submitting`,
    );
  }

  if (input.requestType === 'DISCOUNT_COUNTER') {
    if (typeof input.proposedDiscountBp !== 'number' || input.proposedDiscountBp <= 0) {
      throw badRequest('NEGOTIATION_DISCOUNT', 'A discount counter requires proposedDiscountBp');
    }
    if (!input.lineId) throw badRequest('NEGOTIATION_LINE', 'A discount counter must name a line');
  }
  if (input.requestType === 'QUANTITY_CHANGE') {
    if (typeof input.proposedQuantity !== 'number' || input.proposedQuantity <= 0) {
      throw badRequest('NEGOTIATION_QUANTITY', 'A quantity change requires proposedQuantity');
    }
    if (!input.lineId) throw badRequest('NEGOTIATION_LINE', 'A quantity change must name a line');
  }
  if (
    input.lineId &&
    !quote.lines.some((line) => line.id === input.lineId)
  ) {
    throw notFound('QUOTE_LINE_NOT_FOUND', 'The line does not belong to this quotation');
  }

  const [request] = await exec
    .insert(negotiationRequests)
    .values({
      quotationId: quote.id,
      quotationVersion: quote.version,
      customerId,
      submittedById: actor.userId,
      requestType: input.requestType,
      lineId: input.lineId ?? null,
      proposedDiscountBp: input.proposedDiscountBp ?? null,
      proposedQuantity: input.proposedQuantity ?? null,
      comment: input.comment ?? null,
      status: 'SUBMITTED',
    })
    .returning();
  if (!request) throw conflict('NEGOTIATION_CREATE_FAILED', 'Could not record negotiation request');

  await exec
    .update(quotations)
    .set({ status: 'UNDER_NEGOTIATION' })
    .where(eq(quotations.id, quote.id));

  await writeAudit(exec, {
    ...actor,
    entityType: 'NEGOTIATION_REQUEST',
    entityId: request.id,
    action: 'NEGOTIATION_SUBMITTED',
    newValue: {
      requestType: input.requestType,
      lineId: input.lineId ?? null,
      proposedDiscountBp: input.proposedDiscountBp ?? null,
      proposedQuantity: input.proposedQuantity ?? null,
    },
    quotationId: quote.id,
    quotationVersion: quote.version,
    reason: 'Customer submitted a negotiation / counter-offer',
  });

  return request;
}

/**
 * Customer accepts the current terms.
 *
 * A quote with an approval attempt still open is *not* acceptable even if its
 * status looks actionable: AT-13 requires that a counter-offer which crossed a
 * risk threshold cannot be finalised by the customer before the internal
 * decision lands. `ACTABLE_STATUSES` already excludes `PENDING_APPROVAL`, but
 * the pending-rung check below closes the gap where a rung is open while the
 * quote sits in `UNDER_NEGOTIATION`.
 */
export async function confirmPortalQuotation(
  exec: DbExecutor,
  customerId: string,
  quotationId: string,
  actor: PortalActor,
) {
  const quote = await exec.query.quotations.findFirst({
    where: (table, { and, eq }) => and(eq(table.id, quotationId), eq(table.customerId, customerId)),
  });
  if (!quote) throw notFound('QUOTE_NOT_FOUND', 'Quotation not found for this customer');
  if (!ACTABLE_STATUSES.includes(quote.status)) {
    throw conflict('QUOTE_STATE', `Only a sent quotation can be confirmed (state: ${quote.status})`);
  }

  const pendingApproval = await exec.query.approvalInstances.findFirst({
    where: (table, { and, eq }) => and(eq(table.quotationId, quote.id), eq(table.status, 'PENDING')),
  });
  if (pendingApproval) {
    throw conflict(
      'QUOTE_AWAITING_APPROVAL',
      'This quotation is awaiting internal approval and cannot be accepted yet',
    );
  }

  const confirmedAt = new Date();
  await exec
    .update(quotations)
    .set({ status: 'CONFIRMED', confirmedAt, lastActivityAt: confirmedAt })
    .where(eq(quotations.id, quote.id));

  await writeAudit(exec, {
    ...actor,
    entityType: 'QUOTATION',
    entityId: quote.id,
    action: 'CUSTOMER_CONFIRMED',
    oldValue: { status: quote.status },
    newValue: { status: 'CONFIRMED' },
    quotationId: quote.id,
    quotationVersion: quote.version,
    reason: 'Customer accepted the quotation in the portal',
  });

  const updated = await exec.query.quotations.findFirst({
    where: (table, { eq }) => eq(table.id, quote.id),
  });
  return updated ?? quote;
}