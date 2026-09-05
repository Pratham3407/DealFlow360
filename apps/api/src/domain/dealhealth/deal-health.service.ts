/**
 * Deal-health engine (PRD §17).
 *
 * A sweep runs detectors and upserts findings keyed by a *fingerprint*, so the
 * same condition does not generate a new row every run. Events carry severity and
 * metadata for the UI; nudging/escalation is a human action recorded on the row.
 *
 * Detectors (deliberately small, obvious, data-shaped):
 *  - STALLED            quotes with no *commercial* activity for `X` days
 *  - DISCOUNT_ANOMALY   approved quotes sitting at/over their ceiling
 *  - DELIVERY_SLIPPAGE  fulfilled allocations whose projected delivery passed
 *                       while the fulfilment is still not FULFILLED
 *
 * Thresholds are read from system settings (`dealHealth.*`, see
 * `domain/config/settings.ts`) so they live in the database, not in code
 * (AGENT_INSTRUCTIONS.md §2).
 */

import { and, eq, ne, sql } from 'drizzle-orm';
import {
  auditLogs,
  dealHealthEvents,
  fulfillments,
  quotations,
} from '@/db/schema/index.js';
import type { DbExecutor } from '@/db/client.js';
import { writeAudit } from '../audit/audit.service.js';
import type { AuditActor } from '../audit/audit.service.js';
import { conflict, notFound } from '@/lib/errors.js';
import { loadSettingsMap } from '../config/settings-map.js';
import type { AuditAction, DealHealthSeverity, DealHealthType } from '@dealflow/shared';
import dayjs from 'dayjs';

/**
 * An actor for the human actions on an event (nudge / escalate), which record
 * `nudged_by_id` / `escalated_by_id` and therefore need a real user.
 *
 * The sweep itself takes a plain `AuditActor`: it runs unattended on a timer with
 * no user, and `audit_logs.actor_user_id` is a nullable FK, so a background run
 * attributes itself by label instead of inventing a user id.
 */
export interface HealthActor extends AuditActor {
  userId: string;
}

const STOPPED_STATUSES: readonly string[] = ['PENDING_APPROVAL', 'REVISION_REQUIRED', 'APPROVED', 'UNDER_NEGOTIATION'];
const CEILING_BREACHED_STATUSES: readonly string[] = ['APPROVED', 'SENT', 'UNDER_NEGOTIATION', 'CONFIRMED'];

/** Count recent commercial activity for a quote via its audit records. */
async function lastActivityAt(exec: DbExecutor, quotationId: string): Promise<Date | null> {
  const row = await exec
    .select({ at: auditLogs.createdAt })
    .from(auditLogs)
    .where(and(eq(auditLogs.quotationId, quotationId), sql`${auditLogs.createdAt} is not null`))
    .orderBy(sql`${auditLogs.createdAt} desc`)
    .limit(1);
  return row[0]?.at ?? null;
}

async function upsertEvent(
  exec: DbExecutor,
  input: {
    quotationId: string;
    type: DealHealthType;
    severity: DealHealthSeverity;
    fingerprint: string;
    title: string;
    detail: string;
    metadata?: Record<string, unknown>;
  },
  actor: AuditActor,
) {
  const existing = await exec.query.dealHealthEvents.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.quotationId, input.quotationId), eq(table.type, input.type), eq(table.fingerprint, input.fingerprint)),
  });

  if (existing) {
    if (existing.resolvedAt) {
      // Materially different fingerprint would have missed; same finding that was
      // resolved means the quote stalled again — reopen.
      await exec
        .update(dealHealthEvents)
        .set({ resolvedAt: null, title: input.title, detail: input.detail, metadata: input.metadata })
        .where(eq(dealHealthEvents.id, existing.id));
    }
    return existing;
  }

  const [event] = await exec
    .insert(dealHealthEvents)
    .values({
      quotationId: input.quotationId,
      type: input.type,
      severity: input.severity,
      fingerprint: input.fingerprint,
      title: input.title,
      detail: input.detail,
      metadata: input.metadata ?? {},
    })
    .returning();
  if (!event) throw notFound('EVENT_CREATE_FAILED', 'Could not raise deal-health event');

  await writeAudit(exec, {
    ...actor,
    entityType: 'DEAL_HEALTH_EVENT',
    entityId: event.id,
    action: 'DEAL_HEALTH_EVENT_RAISED' as AuditAction,
    newValue: { type: input.type, severity: input.severity, fingerprint: input.fingerprint },
    quotationId: input.quotationId,
    reason: `${input.title} — ${input.detail}`,
  });

  return event;
}

async function loadQuoteCandidates(exec: DbExecutor) {
  return exec.query.quotations.findMany({
    where: (table, { notInArray }) => notInArray(table.status, ['DRAFT', 'COMPLETED', 'REJECTED']),
    with: { lines: true },
  });
}
type QuoteCandidates = Awaited<ReturnType<typeof loadQuoteCandidates>>;

/** Detect stalled, anomalous and slipping deals. Returns the events written. */
export async function runDealHealthSweep(exec: DbExecutor, actor: AuditActor) {
  const settings = await loadSettingsMap(exec);
  const staleDays = settings.dealHealth.stalledAfterDays;
  const slippageDays = settings.dealHealth.deliverySlippageDays;
  const staleCutoff = dayjs().subtract(staleDays, 'day').toDate();

  const candidates = await loadQuoteCandidates(exec);

  const events: Awaited<ReturnType<typeof upsertEvent>>[] = [];

  for (const quote of candidates) {
    const now = dayjs();
    const ageDays = now.diff(dayjs(quote.createdAt), 'day');

    // STALLED offers (mid-deal, not yet sent, no action for the window).
    if (STOPPED_STATUSES.includes(quote.status) && ageDays >= staleDays) {
      const lastAt = await lastActivityAt(exec, quote.id);
      if (!lastAt || dayjs(lastAt).isBefore(staleCutoff)) {
        events.push(
          await upsertEvent(
            exec,
            {
              quotationId: quote.id,
              type: 'STALLED',
              severity: ageDays >= staleDays * 2 ? 'HIGH' : 'MEDIUM',
              fingerprint: `stalled:${quote.status}:${ageDays}`,
              title: 'Deal has stalled',
              detail: `No activity on ${quote.quoteNumber} for ${ageDays} days (state ${quote.status})`,
              metadata: { ageDays, status: quote.status },
            },
            actor,
          ),
        );
      }
    }

    // DISCOUNT_ANOMALY: approved/sent quote whose lines still breach ceilings.
    if (CEILING_BREACHED_STATUSES.includes(quote.status)) {
      const breaching = quote.lines.filter((line) => line.violationBp > 0);
      if (breaching.length) {
        const maxBreachBp = Math.max(...breaching.map((line) => line.violationBp));
        events.push(
          await upsertEvent(
            exec,
            {
              quotationId: quote.id,
              type: 'DISCOUNT_ANOMALY',
              severity: maxBreachBp > 500 ? 'HIGH' : 'MEDIUM',
              fingerprint: `anomaly:${breaching.map((line) => `${line.id}`).sort().join(':')}`,
              title: 'Discount above ceiling',
              detail: `${breaching.length} line(s) breach their approved ceiling`,
              metadata: { lines: breaching.length, maxBreachBp },
            },
            actor,
          ),
        );
      }
    }
  }

  /**
   * DELIVERY_SLIPPAGE: an unfinished fulfilment whose projected delivery is later
   * than the promised date by more than the configured tolerance. Comparing
   * against the *promised* date (not "today") is what the setting describes, and
   * it catches a slip at planning time rather than only after the date passes.
   */
  const open = await exec
    .select({
      id: fulfillments.id,
      quotationId: fulfillments.quotationId,
      status: fulfillments.status,
      projectedDeliveryDate: fulfillments.projectedDeliveryDate,
      promisedDeliveryDate: quotations.promisedDeliveryDate,
      quoteNumber: quotations.quoteNumber,
    })
    .from(fulfillments)
    .innerJoin(quotations, eq(quotations.id, fulfillments.quotationId))
    .where(ne(fulfillments.status, 'FULFILLED'));

  for (const f of open) {
    if (!f.projectedDeliveryDate) continue;
    const projected = dayjs(f.projectedDeliveryDate);

    // Slipping against the customer promise, or already overdue and unfinished.
    const promised = f.promisedDeliveryDate ? dayjs(f.promisedDeliveryDate) : null;
    const slipDays = promised ? projected.diff(promised, 'day') : null;
    const overdueDays = dayjs().startOf('day').diff(projected.startOf('day'), 'day');

    const slipsPromise = slipDays !== null && slipDays > slippageDays;
    const overdue = overdueDays > 0;
    if (!slipsPromise && !overdue) continue;

    const detail = slipsPromise
      ? `Projected delivery for ${f.quoteNumber} is ${slipDays} day(s) after the promised ${promised!.format('YYYY-MM-DD')} (tolerance ${slippageDays})`
      : `Projected delivery ${projected.format('YYYY-MM-DD')} for ${f.quoteNumber} passed ${overdueDays} day(s) ago and the order is still ${f.status}`;

    events.push(
      await upsertEvent(
        exec,
        {
          quotationId: f.quotationId,
          type: 'DELIVERY_SLIPPAGE',
          severity: slipsPromise && slipDays! > slippageDays * 2 ? 'HIGH' : overdue ? 'HIGH' : 'MEDIUM',
          fingerprint: `slippage:${f.id}:${slipsPromise ? `promise:${slipDays}` : `overdue:${overdueDays}`}`,
          title: 'Delivery is slipping',
          detail,
          metadata: {
            projectedDeliveryDate: projected.format('YYYY-MM-DD'),
            promisedDeliveryDate: promised?.format('YYYY-MM-DD') ?? null,
            slipDays,
            overdueDays,
            status: f.status,
          },
        },
        actor,
      ),
    );
  }

  // Auto-resolve anomalies whose lines have since been renegotiated.
  await resolveClearedEvents(exec, candidates, actor);

  return events;
}

async function resolveClearedEvents(
  exec: DbExecutor,
  candidates: QuoteCandidates,
  actor: AuditActor,
) {
  const open = await exec.query.dealHealthEvents.findMany({
    where: (table, { isNull }) => isNull(table.resolvedAt),
  });
  for (const event of open) {
    if (event.type !== 'DISCOUNT_ANOMALY') continue;
    const quote = candidates.find((q) => q.id === event.quotationId);
    if (!quote) continue;
    if (!quote.lines.some((line) => line.violationBp > 0)) {
      await exec
        .update(dealHealthEvents)
        .set({ resolvedAt: new Date() })
        .where(eq(dealHealthEvents.id, event.id));
    }
  }
  void actor;
}

export async function listHealthEvents(exec: DbExecutor, filters: { type?: DealHealthType; openOnly?: boolean } = {}) {
  return exec.query.dealHealthEvents.findMany({
    where: (table, { and, eq, isNull }) =>
      and(
        filters.type ? eq(table.type, filters.type) : undefined,
        filters.openOnly ? isNull(table.resolvedAt) : undefined,
      ),
    orderBy: (table, { desc }) => desc(table.createdAt),
    with: { quotation: true },
  });
}

export async function nudgeEvent(exec: DbExecutor, eventId: string, actor: HealthActor) {
  const event = await exec.query.dealHealthEvents.findFirst({
    where: (table, { eq }) => eq(table.id, eventId),
  });
  if (!event) throw notFound('EVENT_NOT_FOUND', 'Deal-health event not found');
  if (event.resolvedAt) {
    throw conflict('EVENT_RESOLVED', 'This alert is already resolved and does not need a follow-up');
  }

  const nudgeCount = event.nudgeCount + 1;

  await exec
    .update(dealHealthEvents)
    .set({ nudgedAt: new Date(), nudgedById: actor.userId, nudgeCount })
    .where(eq(dealHealthEvents.id, eventId));

  await writeAudit(exec, {
    ...actor,
    entityType: 'DEAL_HEALTH_EVENT',
    entityId: eventId,
    action: 'DEAL_HEALTH_NUDGED',
    oldValue: { nudgeCount: event.nudgeCount, nudgedAt: event.nudgedAt },
    newValue: { type: event.type, nudgeCount },
    quotationId: event.quotationId,
    reason: `Follow-up ${nudgeCount} logged against the counterparty`,
  });

  return getHealthEvent(exec, eventId);
}

export async function escalateEvent(exec: DbExecutor, eventId: string, actor: HealthActor) {
  const event = await exec.query.dealHealthEvents.findFirst({
    where: (table, { eq }) => eq(table.id, eventId),
  });
  if (!event) throw notFound('EVENT_NOT_FOUND', 'Deal-health event not found');
  if (event.resolvedAt) {
    throw conflict('EVENT_RESOLVED', 'This alert is already resolved and cannot be escalated');
  }
  if (event.escalatedAt) {
    throw conflict('EVENT_ESCALATED', 'This alert has already been escalated to management');
  }

  await exec
    .update(dealHealthEvents)
    .set({ escalatedAt: new Date(), escalatedById: actor.userId })
    .where(eq(dealHealthEvents.id, eventId));

  await writeAudit(exec, {
    ...actor,
    entityType: 'DEAL_HEALTH_EVENT',
    entityId: eventId,
    action: 'DEAL_HEALTH_ESCALATED',
    newValue: { type: event.type },
    quotationId: event.quotationId,
    reason: 'Deal escalated to management',
  });

  return getHealthEvent(exec, eventId);
}

export async function getHealthEvent(exec: DbExecutor, eventId: string) {
  const event = await exec.query.dealHealthEvents.findFirst({
    where: (table, { eq }) => eq(table.id, eventId),
    with: { quotation: true },
  });
  if (!event) throw notFound('EVENT_NOT_FOUND', 'Deal-health event not found');
  return event;
}