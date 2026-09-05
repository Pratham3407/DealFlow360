/**
 * Deal-health follow-ups and escalation.
 *
 * `nudgeEvent` only ever stamped `nudgedAt`, so a second follow-up changed one
 * hidden timestamp and appeared to do nothing at all. The count added here is
 * what makes repeated chasing observable, and these tests hold that behaviour in
 * place along with the guards that stop pointless actions on a closed alert.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, resetDatabase, sessionAs, type SeedResult, type Session } from './helpers/db.js';

let seeded: SeedResult;
let rep: Session;
let manager: Session;
let finance: Session;
let admin: Session;

beforeAll(async () => {
  seeded = await resetDatabase();
  rep = await sessionAs('rep@dealflow.local', DEMO_PASSWORD);
  manager = await sessionAs('manager@dealflow.local', DEMO_PASSWORD);
  finance = await sessionAs('finance@dealflow.local', DEMO_PASSWORD);
  admin = await sessionAs('admin@dealflow.local', DEMO_PASSWORD);
});

interface HealthEvent {
  id: string;
  quotationId: string;
  type: string;
  severity: string;
  nudgeCount: number;
  nudgedAt: string | null;
  escalatedAt: string | null;
  resolvedAt: string | null;
}

const pct = (n: number) => n * 100;

/**
 * Build the DISCOUNT_ANOMALY condition on demand.
 *
 * The sweep only flags a ceiling breach on a quote that has *reached the customer*
 * — `APPROVED`, `SENT`, `UNDER_NEGOTIATION` or `CONFIRMED`. The seeded canonical
 * quote is a DRAFT, so a fresh database legitimately produces no alerts; the
 * fixture has to push a breaching quote through approval first.
 */
async function quoteWithLiveBreach(): Promise<{ quotationId: string; lineId: string }> {
  const draft = await rep.post('/api/quotations').send({ customerId: seeded.customers.acme.id });
  expect(draft.status).toBe(201);
  const quotationId = draft.body.quote.id as string;

  // Compliant hardware bulk keeps risk in the MANAGER band rather than escalating
  // to Finance, so one approval is enough to reach APPROVED.
  await rep.post(`/api/quotations/${quotationId}/lines`).send({
    productId: seeded.products.laptop.id, quantity: 20, discountBp: pct(12),
  });
  await rep.post(`/api/quotations/${quotationId}/lines`).send({
    productId: seeded.products.setup.id, quantity: 5, discountBp: pct(18),
  });

  const submit = await rep.post(`/api/quotations/${quotationId}/confirm`).send({});
  expect(submit.body.quote.status).toBe('PENDING_APPROVAL');

  const rungs = await manager.get(`/api/approvals?quotationId=${quotationId}`);
  const rung = (rungs.body.data as Array<{ id: string; level: string }>).find((r) => r.level === 'MANAGER');
  expect(rung).toBeDefined();
  const approve = await manager.post(`/api/approvals/${rung!.id}/approve`).send({});
  expect(approve.status).toBe(200);

  // Approved with the 8-point services breach still on the line: exactly the
  // "approved anyway" situation the anomaly alert exists to surface.
  const quote = await rep.get(`/api/quotations/${quotationId}`);
  expect(quote.body.quote.status).toBe('APPROVED');
  const breaching = (quote.body.quote.lines as Array<{ id: string; violationBp: number }>).find(
    (l) => l.violationBp > 0,
  );
  expect(breaching).toBeDefined();

  return { quotationId, lineId: breaching!.id };
}

/** Run the sweep and return the open alerts. */
async function sweep(): Promise<HealthEvent[]> {
  const res = await manager.post('/api/deal-health/sweep').send({});
  expect(res.status).toBe(200);
  const list = await manager.get('/api/deal-health?openOnly=true');
  expect(list.status).toBe(200);
  return list.body.data as HealthEvent[];
}

/** An open anomaly alert, creating the underlying condition if needed. */
async function anomalyAlert(): Promise<HealthEvent> {
  const { quotationId } = await quoteWithLiveBreach();
  const events = await sweep();
  const found = events.find((e) => e.type === 'DISCOUNT_ANOMALY' && e.quotationId === quotationId);
  expect(found).toBeDefined();
  return found!;
}

async function readEvent(id: string): Promise<HealthEvent> {
  const res = await manager.get(`/api/deal-health/${id}`);
  expect(res.status).toBe(200);
  return res.body.event as HealthEvent;
}

describe('deal-health sweep', () => {
  it('produces no alerts on a freshly seeded database', async () => {
    // Every seeded quote is either a draft or freshly sent, so nothing is stalled
    // and no live quote carries a breach. Silence here is the correct answer.
    const events = await sweep();
    expect(events).toHaveLength(0);
  });

  it('flags a breach that survived approval', async () => {
    const { quotationId } = await quoteWithLiveBreach();
    const events = await sweep();

    const anomaly = events.find((e) => e.type === 'DISCOUNT_ANOMALY' && e.quotationId === quotationId);
    expect(anomaly).toBeDefined();
    // An 8-point breach is above the 500bp threshold for HIGH.
    expect(anomaly!.severity).toBe('HIGH');
    expect(anomaly!.nudgeCount).toBe(0);
  });

  it('is idempotent — a second sweep does not duplicate an open alert', async () => {
    await quoteWithLiveBreach();
    const first = await sweep();
    expect(first.length).toBeGreaterThan(0);

    const second = await sweep();
    expect(second.length).toBe(first.length);
    expect(new Set(second.map((e) => e.id))).toEqual(new Set(first.map((e) => e.id)));
  });

  it('refuses the sweep to a Sales Rep', async () => {
    expect((await rep.post('/api/deal-health/sweep').send({})).status).toBe(403);
  });
});

describe('follow-ups', () => {
  it('starts at zero and increments on every follow-up', async () => {
    const event = await anomalyAlert();
    expect(event.nudgeCount).toBe(0);

    const first = await rep.post(`/api/deal-health/${event.id}/nudge`).send({});
    expect(first.status).toBe(200);
    expect(first.body.event.nudgeCount).toBe(1);

    // The second follow-up is the case that previously looked like a no-op.
    const second = await rep.post(`/api/deal-health/${event.id}/nudge`).send({});
    expect(second.status).toBe(200);
    expect(second.body.event.nudgeCount).toBe(2);

    const third = await rep.post(`/api/deal-health/${event.id}/nudge`).send({});
    expect(third.body.event.nudgeCount).toBe(3);

    expect((await readEvent(event.id)).nudgeCount).toBe(3);
  });

  it('advances the timestamp on each follow-up', async () => {
    const event = await anomalyAlert();
    await rep.post(`/api/deal-health/${event.id}/nudge`).send({});
    const after1 = await readEvent(event.id);
    expect(after1.nudgedAt).not.toBeNull();

    await new Promise((r) => setTimeout(r, 15));
    await rep.post(`/api/deal-health/${event.id}/nudge`).send({});
    const after2 = await readEvent(event.id);

    expect(new Date(after2.nudgedAt!).getTime()).toBeGreaterThan(new Date(after1.nudgedAt!).getTime());
  });

  it('keeps the alert open — a follow-up is not a resolution', async () => {
    const event = await anomalyAlert();
    await rep.post(`/api/deal-health/${event.id}/nudge`).send({});
    expect((await readEvent(event.id)).resolvedAt).toBeNull();
  });

  it('writes one audit entry per follow-up, carrying the running count', async () => {
    const event = await anomalyAlert();
    await rep.post(`/api/deal-health/${event.id}/nudge`).send({});
    await rep.post(`/api/deal-health/${event.id}/nudge`).send({});

    const { db } = await import('../src/db/client.js');
    const entries = await db.query.auditLogs.findMany({
      where: (t, { and, eq }) => and(eq(t.entityId, event.id), eq(t.action, 'DEAL_HEALTH_NUDGED')),
    });
    expect(entries).toHaveLength(2);
    const counts = entries
      .map((e) => (e.newValue as { nudgeCount?: number } | null)?.nudgeCount)
      .sort();
    expect(counts).toEqual([1, 2]);
  });

  it('lets a manager follow up as well as a rep', async () => {
    const event = await anomalyAlert();
    expect((await manager.post(`/api/deal-health/${event.id}/nudge`).send({})).status).toBe(200);
  });

  it('refuses a follow-up from Finance', async () => {
    const event = await anomalyAlert();
    expect((await finance.post(`/api/deal-health/${event.id}/nudge`).send({})).status).toBe(403);
  });

  it('404s on an unknown event rather than silently succeeding', async () => {
    const res = await rep
      .post('/api/deal-health/00000000-0000-0000-0000-000000000000/nudge')
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
  });
});

describe('escalation', () => {
  it('stamps the escalation and refuses a second one', async () => {
    const event = await anomalyAlert();

    const first = await manager.post(`/api/deal-health/${event.id}/escalate`).send({});
    expect(first.status).toBe(200);
    expect(first.body.event.escalatedAt).not.toBeNull();

    // Escalating twice is not a meaningful action; it used to silently re-stamp.
    const second = await manager.post(`/api/deal-health/${event.id}/escalate`).send({});
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('EVENT_ESCALATED');
  });

  it('refuses escalation from a Sales Rep', async () => {
    const event = await anomalyAlert();
    expect((await rep.post(`/api/deal-health/${event.id}/escalate`).send({})).status).toBe(403);
  });

  it('still allows follow-ups after escalation', async () => {
    const event = await anomalyAlert();
    await manager.post(`/api/deal-health/${event.id}/escalate`).send({});

    const nudge = await rep.post(`/api/deal-health/${event.id}/nudge`).send({});
    expect(nudge.status).toBe(200);
    expect(nudge.body.event.nudgeCount).toBe(1);
  });
});

describe('resolved alerts', () => {
  /**
   * Clear the breach the way it can actually be cleared on an approved quote.
   *
   * Line edits are refused once a quote is APPROVED — that guard is the point of
   * the state machine — so the exception is retired by widening the governing
   * ceiling and recalculating. The quote is re-scored against the new policy, the
   * violation disappears, and the sweep closes the alert on its own.
   */
  async function resolveBreach(quotationId: string) {
    const rules = await admin.get('/api/discount-rules');
    const goldServices = (rules.body.data as Array<{ id: string; name: string; maxDiscountBp: number }>).find(
      (r) => r.name === 'Gold — Services',
    );
    expect(goldServices).toBeDefined();
    const original = goldServices!.maxDiscountBp;

    const widen = await admin.patch(`/api/discount-rules/${goldServices!.id}`).send({ maxDiscountBp: pct(25) });
    expect(widen.status).toBe(200);

    const recalc = await rep.post(`/api/quotations/${quotationId}/recalculate`).send({});
    expect(recalc.status).toBe(200);

    const quote = await rep.get(`/api/quotations/${quotationId}`);
    expect(
      (quote.body.quote.lines as Array<{ violationBp: number }>).every((l) => l.violationBp === 0),
    ).toBe(true);

    await manager.post('/api/deal-health/sweep').send({});

    /*
     * Put the ceiling back. Governance is shared state, so leaving it widened
     * would silently stop later fixtures from breaching anything at all. The
     * already-resolved quote keeps its snapshotted zero violation, so restoring
     * the rule does not reopen the alert.
     */
    const restore = await admin.patch(`/api/discount-rules/${goldServices!.id}`).send({ maxDiscountBp: original });
    expect(restore.status).toBe(200);
  }

  it('rejects a follow-up and an escalation once the cause is gone', async () => {
    const { quotationId } = await quoteWithLiveBreach();
    const events = await sweep();
    const anomaly = events.find((e) => e.type === 'DISCOUNT_ANOMALY' && e.quotationId === quotationId);
    expect(anomaly).toBeDefined();

    await resolveBreach(quotationId);

    const closed = await readEvent(anomaly!.id);
    expect(closed.resolvedAt).not.toBeNull();

    const nudge = await rep.post(`/api/deal-health/${anomaly!.id}/nudge`).send({});
    expect(nudge.status).toBe(409);
    expect(nudge.body.error.code).toBe('EVENT_RESOLVED');

    const escalate = await manager.post(`/api/deal-health/${anomaly!.id}/escalate`).send({});
    expect(escalate.status).toBe(409);
    expect(escalate.body.error.code).toBe('EVENT_RESOLVED');
  });

  it('hides resolved alerts from the open list but keeps them readable', async () => {
    const { quotationId } = await quoteWithLiveBreach();
    const events = await sweep();
    const anomaly = events.find((e) => e.type === 'DISCOUNT_ANOMALY' && e.quotationId === quotationId);
    expect(anomaly).toBeDefined();

    await resolveBreach(quotationId);

    const open = await manager.get('/api/deal-health?openOnly=true');
    expect((open.body.data as HealthEvent[]).map((e) => e.id)).not.toContain(anomaly!.id);

    const all = await manager.get('/api/deal-health');
    expect((all.body.data as HealthEvent[]).map((e) => e.id)).toContain(anomaly!.id);
  });

  it('refuses to edit a line on an approved quote, which is why widening is the route', async () => {
    const { quotationId, lineId } = await quoteWithLiveBreach();
    const res = await rep.patch(`/api/quotations/${quotationId}/lines/${lineId}`).send({ discountBp: pct(5) });
    expect(res.status).toBe(403);
  });
});
