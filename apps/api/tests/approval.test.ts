/**
 * AT-06 – AT-07: the approval chain.
 *
 * AT-06 is the single-rung Manager case plus the role boundary — a Sales Rep may
 * author any discount but may never clear their own exception. AT-07 is the
 * two-rung case, where the interesting property is *sequence*: Finance cannot act
 * before Manager has, and that has to be enforced structurally rather than by
 * asking reviewers to take turns.
 *
 * Each test builds its own quote so a rejection in one case cannot strand
 * another, and every terminal state is checked on the quotation as well as on the
 * rung, because the two are updated by different code paths.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, resetDatabase, sessionAs, type SeedResult, type Session } from './helpers/db.js';

const pct = (n: number) => n * 100;

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

interface Rung {
  id: string;
  level: 'MANAGER' | 'FINANCE';
  sequence: number;
  attempt: number;
  status: string;
  quotationVersion: number;
  reason: string | null;
  reviewerId: string | null;
}

/**
 * Build a submitted quote whose risk lands in the requested band.
 *
 * The discounts are chosen to sit either side of the seeded 2500bp boundary
 * between MANAGER and MANAGER_FINANCE rather than being tuned to exact scores,
 * so the fixtures survive a re-weighting of the risk components.
 */
async function submittedQuote(band: 'MANAGER' | 'MANAGER_FINANCE'): Promise<string> {
  const draft = await rep.post('/api/quotations').send({ customerId: seeded.customers.acme.id });
  expect(draft.status).toBe(201);
  const id = draft.body.quote.id as string;

  if (band === 'MANAGER') {
    // Compliant hardware bulk keeps exposure low; one modest services breach.
    await rep.post(`/api/quotations/${id}/lines`).send({
      productId: seeded.products.laptop.id, quantity: 20, discountBp: pct(12),
    });
    await rep.post(`/api/quotations/${id}/lines`).send({
      productId: seeded.products.setup.id, quantity: 5, discountBp: pct(18),
    });
  } else {
    await rep.post(`/api/quotations/${id}/lines`).send({
      productId: seeded.products.laptop.id, quantity: 20, discountBp: pct(45),
    });
    await rep.post(`/api/quotations/${id}/lines`).send({
      productId: seeded.products.setup.id, quantity: 10, discountBp: pct(50),
    });
  }

  const submit = await rep.post(`/api/quotations/${id}/confirm`).send({});
  expect(submit.status).toBe(200);
  expect(submit.body.quote.status).toBe('PENDING_APPROVAL');
  expect(submit.body.quote.requiredApprovalLevel).toBe(band);
  return id;
}

async function rungsFor(quoteId: string, includeResolved = true): Promise<Rung[]> {
  const res = await admin.get(`/api/approvals?quotationId=${quoteId}&onlyPending=${!includeResolved}`);
  expect(res.status).toBe(200);
  return (res.body.data as Rung[]).slice().sort((a, b) => a.attempt - b.attempt || a.sequence - b.sequence);
}

async function quoteStatus(quoteId: string): Promise<string> {
  const res = await admin.get(`/api/quotations/${quoteId}`);
  expect(res.status).toBe(200);
  return res.body.quote.status as string;
}

async function auditActions(quoteId: string): Promise<string[]> {
  const res = await admin.get(`/api/quotations/${quoteId}/audit?limit=100`);
  expect(res.status).toBe(200);
  return (res.body.data as Array<{ action: string }>).map((a) => a.action);
}

describe('AT-06 manager decision on a single-rung approval', () => {
  it('approves and moves the quote to APPROVED with an audit event', async () => {
    const quoteId = await submittedQuote('MANAGER');
    const [rung] = await rungsFor(quoteId);

    const res = await manager.post(`/api/approvals/${rung!.id}/approve`).send({});
    expect(res.status).toBe(200);
    expect(res.body.approval.status).toBe('APPROVED');
    expect(res.body.approval.reviewerId).toBe(seeded.users.manager.id);

    expect(await quoteStatus(quoteId)).toBe('APPROVED');
    expect(await auditActions(quoteId)).toContain('APPROVAL_APPROVED');
  });

  it('rejects with a reason, terminating the quote', async () => {
    const quoteId = await submittedQuote('MANAGER');
    const [rung] = await rungsFor(quoteId);

    const res = await manager.post(`/api/approvals/${rung!.id}/reject`).send({
      reason: 'Margin too thin for this account',
    });
    expect(res.status).toBe(200);
    expect(res.body.approval.status).toBe('REJECTED');
    expect(res.body.approval.reason).toBe('Margin too thin for this account');

    expect(await quoteStatus(quoteId)).toBe('REJECTED');
    expect(await auditActions(quoteId)).toContain('APPROVAL_REJECTED');
  });

  it('returns for revision, unlocking the quote for the rep to edit', async () => {
    const quoteId = await submittedQuote('MANAGER');
    const [rung] = await rungsFor(quoteId);

    const res = await manager.post(`/api/approvals/${rung!.id}/return`).send({
      reason: 'Bring the services discount back under 10%',
    });
    expect(res.status).toBe(200);
    expect(res.body.approval.status).toBe('REVISION_REQUIRED');

    expect(await quoteStatus(quoteId)).toBe('REVISION_REQUIRED');
    expect(await auditActions(quoteId)).toContain('REVISION_REQUESTED');

    // The point of a return is that editing becomes possible again.
    const quote = await admin.get(`/api/quotations/${quoteId}`);
    const lineId = quote.body.quote.lines[1].id as string;
    const fix = await rep.patch(`/api/quotations/${quoteId}/lines/${lineId}`).send({ discountBp: pct(9) });
    expect(fix.status).toBe(200);
  });

  it('requires a reason on reject and on return', async () => {
    const quoteId = await submittedQuote('MANAGER');
    const [rung] = await rungsFor(quoteId);

    const reject = await manager.post(`/api/approvals/${rung!.id}/reject`).send({});
    expect(reject.status).toBe(400);

    const ret = await manager.post(`/api/approvals/${rung!.id}/return`).send({ reason: '' });
    expect(ret.status).toBe(400);

    // Neither failed attempt may have moved anything.
    expect(await quoteStatus(quoteId)).toBe('PENDING_APPROVAL');
  });

  it('refuses to let the authoring Sales Rep approve their own exception', async () => {
    const quoteId = await submittedQuote('MANAGER');
    const [rung] = await rungsFor(quoteId);

    const res = await rep.post(`/api/approvals/${rung!.id}/approve`).send({});
    expect(res.status).toBe(403);

    // Nor reject, nor return — the rep has no say at this rung at all.
    expect((await rep.post(`/api/approvals/${rung!.id}/reject`).send({ reason: 'x' })).status).toBe(403);
    expect((await rep.post(`/api/approvals/${rung!.id}/return`).send({ reason: 'x' })).status).toBe(403);

    expect(await quoteStatus(quoteId)).toBe('PENDING_APPROVAL');
  });

  it('refuses Finance on a rung that asks for a Manager', async () => {
    const quoteId = await submittedQuote('MANAGER');
    const [rung] = await rungsFor(quoteId);
    expect(rung!.level).toBe('MANAGER');

    const res = await finance.post(`/api/approvals/${rung!.id}/approve`).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('APPROVAL_ROLE');
  });

  it('will not act twice on the same rung', async () => {
    const quoteId = await submittedQuote('MANAGER');
    const [rung] = await rungsFor(quoteId);

    expect((await manager.post(`/api/approvals/${rung!.id}/approve`).send({})).status).toBe(200);

    const again = await manager.post(`/api/approvals/${rung!.id}/approve`).send({});
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(again.status).toBeLessThan(500);
  });
});

describe('AT-07 manager then finance on a high-risk quote', () => {
  it('raises both rungs in sequence', async () => {
    const quoteId = await submittedQuote('MANAGER_FINANCE');
    const rungs = await rungsFor(quoteId);

    expect(rungs).toHaveLength(2);
    expect(rungs[0]!.level).toBe('MANAGER');
    expect(rungs[0]!.sequence).toBe(1);
    expect(rungs[1]!.level).toBe('FINANCE');
    expect(rungs[1]!.sequence).toBe(2);
    expect(rungs.every((r) => r.status === 'PENDING')).toBe(true);
  });

  it('blocks Finance until the Manager rung has cleared', async () => {
    const quoteId = await submittedQuote('MANAGER_FINANCE');
    const rungs = await rungsFor(quoteId);
    const financeRung = rungs.find((r) => r.level === 'FINANCE')!;

    // Finance acting first would defeat the point of an ordered chain.
    const early = await finance.post(`/api/approvals/${financeRung.id}/approve`).send({});
    expect(early.status).toBeGreaterThanOrEqual(400);
    expect(early.status).toBeLessThan(500);

    expect(await quoteStatus(quoteId)).toBe('PENDING_APPROVAL');
  });

  it('stays PENDING_APPROVAL after Manager approves, then completes on Finance', async () => {
    const quoteId = await submittedQuote('MANAGER_FINANCE');
    const rungs = await rungsFor(quoteId);
    const managerRung = rungs.find((r) => r.level === 'MANAGER')!;
    const financeRung = rungs.find((r) => r.level === 'FINANCE')!;

    const first = await manager.post(`/api/approvals/${managerRung.id}/approve`).send({});
    expect(first.status).toBe(200);
    // One rung down is not approval — the quote must not advance yet.
    expect(await quoteStatus(quoteId)).toBe('PENDING_APPROVAL');

    const second = await finance.post(`/api/approvals/${financeRung.id}/approve`).send({});
    expect(second.status).toBe(200);
    expect(await quoteStatus(quoteId)).toBe('APPROVED');

    const finalRungs = await rungsFor(quoteId);
    expect(finalRungs.every((r) => r.status === 'APPROVED')).toBe(true);
  });

  it('lets Finance reject after Manager approved, terminating the quote', async () => {
    const quoteId = await submittedQuote('MANAGER_FINANCE');
    const rungs = await rungsFor(quoteId);

    await manager.post(`/api/approvals/${rungs.find((r) => r.level === 'MANAGER')!.id}/approve`).send({});

    const res = await finance
      .post(`/api/approvals/${rungs.find((r) => r.level === 'FINANCE')!.id}/reject`)
      .send({ reason: 'Credit exposure on this account is already at limit' });
    expect(res.status).toBe(200);
    expect(res.body.approval.status).toBe('REJECTED');
    expect(await quoteStatus(quoteId)).toBe('REJECTED');
  });

  it('lets Finance return for revision after Manager approved', async () => {
    const quoteId = await submittedQuote('MANAGER_FINANCE');
    const rungs = await rungsFor(quoteId);

    await manager.post(`/api/approvals/${rungs.find((r) => r.level === 'MANAGER')!.id}/approve`).send({});

    const res = await finance
      .post(`/api/approvals/${rungs.find((r) => r.level === 'FINANCE')!.id}/return`)
      .send({ reason: 'Rework the payment terms' });
    expect(res.status).toBe(200);
    expect(await quoteStatus(quoteId)).toBe('REVISION_REQUIRED');
  });

  it('refuses a Manager on the Finance rung', async () => {
    const quoteId = await submittedQuote('MANAGER_FINANCE');
    const rungs = await rungsFor(quoteId);

    await manager.post(`/api/approvals/${rungs.find((r) => r.level === 'MANAGER')!.id}/approve`).send({});

    const res = await manager
      .post(`/api/approvals/${rungs.find((r) => r.level === 'FINANCE')!.id}/approve`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('APPROVAL_ROLE');
  });

  it('lets an ADMIN clear either rung', async () => {
    const quoteId = await submittedQuote('MANAGER_FINANCE');
    const rungs = await rungsFor(quoteId);

    expect((await admin.post(`/api/approvals/${rungs[0]!.id}/approve`).send({})).status).toBe(200);
    expect((await admin.post(`/api/approvals/${rungs[1]!.id}/approve`).send({})).status).toBe(200);
    expect(await quoteStatus(quoteId)).toBe('APPROVED');
  });

  it('starts a fresh attempt when a revised quote is resubmitted', async () => {
    const quoteId = await submittedQuote('MANAGER_FINANCE');
    const first = await rungsFor(quoteId);

    await manager
      .post(`/api/approvals/${first.find((r) => r.level === 'MANAGER')!.id}/return`)
      .send({ reason: 'Too deep — try again' });
    expect(await quoteStatus(quoteId)).toBe('REVISION_REQUIRED');

    // Rep pulls the discounts back within policy and resubmits.
    const quote = await admin.get(`/api/quotations/${quoteId}`);
    for (const line of quote.body.quote.lines as Array<{ id: string }>) {
      await rep.patch(`/api/quotations/${quoteId}/lines/${line.id}`).send({ discountBp: pct(5) });
    }

    const resubmit = await rep.post(`/api/quotations/${quoteId}/confirm`).send({});
    expect(resubmit.status).toBe(200);
    // Now within policy, so it auto-approves rather than raising a second chain.
    expect(resubmit.body.quote.status).toBe('APPROVED');

    // The original rungs are still on record — approval history is append-only.
    const all = await rungsFor(quoteId);
    expect(all.length).toBeGreaterThanOrEqual(first.length);
    expect(all.some((r) => r.status === 'REVISION_REQUIRED')).toBe(true);
  });
});

describe('AT-17 audit trail of a discount change', () => {
  it('records actor, old value and new value when a line discount moves', async () => {
    const draft = await rep.post('/api/quotations').send({ customerId: seeded.customers.acme.id });
    const quoteId = draft.body.quote.id as string;
    const added = await rep.post(`/api/quotations/${quoteId}/lines`).send({
      productId: seeded.products.laptop.id, quantity: 10, discountBp: pct(5),
    });
    expect(added.status).toBe(201);

    const quote = await admin.get(`/api/quotations/${quoteId}`);
    const lineId = quote.body.quote.lines[0].id as string;

    const patched = await rep.patch(`/api/quotations/${quoteId}/lines/${lineId}`).send({
      discountBp: pct(14),
    });
    expect(patched.status).toBe(200);

    const audit = await admin.get(`/api/quotations/${quoteId}/audit?limit=100`);
    const entry = (audit.body.data as Array<{
      action: string;
      actorRole: string | null;
      actorUserId: string | null;
      oldValue: { discountBp?: number } | null;
      newValue: { discountBp?: number } | null;
      quotationVersion: number | null;
      createdAt: string;
    }>).find((a) => a.action === 'DISCOUNT_CHANGED');

    expect(entry).toBeDefined();
    expect(entry!.actorUserId).toBe(seeded.users.rep.id);
    expect(entry!.actorRole).toBe('SALES_REP');
    expect(entry!.oldValue?.discountBp).toBe(pct(5));
    expect(entry!.newValue?.discountBp).toBe(pct(14));
    expect(entry!.quotationVersion).toBeGreaterThan(1);
    expect(new Date(entry!.createdAt).getTime()).toBeGreaterThan(0);
  });

  it('cannot be rewritten — the audit log is append-only', async () => {
    // Enforced by a database trigger, so there is no API surface to attempt it
    // through; assert the guarantee holds at the SQL level. Drizzle wraps the
    // driver error, so the trigger's own message is on the cause.
    const { db } = await import('../src/db/client.js');
    const { sql } = await import('drizzle-orm');

    const update = db.execute(sql`update audit_logs set reason = 'tampered' where true`);
    await expect(update).rejects.toThrow();

    const cause = await update.then(
      () => null,
      (err: { cause?: { message?: string }; message?: string }) => err.cause?.message ?? err.message ?? '',
    );
    expect(cause).toMatch(/append-only/i);

    const del = db.execute(sql`delete from audit_logs where true`);
    await expect(del).rejects.toThrow();
  });
});
