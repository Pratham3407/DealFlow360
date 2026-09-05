/**
 * AT-12 – AT-14: the customer negotiation loop.
 *
 * These cover behaviour that was previously unreachable: `applyNegotiation` used
 * to bump the version without writing the customer's proposed terms onto the
 * line, and `confirmPortalQuotation` wrote a CUSTOMER_CONFIRMED audit event
 * without moving the quotation out of SENT. Both are asserted here so the fixes
 * cannot silently regress.
 *
 * AT-12 also requires that the portal view withholds internal commercials, which
 * is checked against the actual response body rather than trusting the mapper.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, resetDatabase, sessionAs, type SeedResult, type Session } from './helpers/db.js';

const pct = (n: number) => n * 100;

let seeded: SeedResult;
let rep: Session;
let manager: Session;
let finance: Session;
let buyer: Session;

beforeAll(async () => {
  seeded = await resetDatabase();
  rep = await sessionAs('rep@dealflow.local', DEMO_PASSWORD);
  manager = await sessionAs('manager@dealflow.local', DEMO_PASSWORD);
  finance = await sessionAs('finance@dealflow.local', DEMO_PASSWORD);
  buyer = await sessionAs('buyer@acme.local', DEMO_PASSWORD);
});

/**
 * Put a quote in front of the Acme buyer at a known discount.
 *
 * Kept inside the Gold ceilings so the quote reaches SENT without an approval
 * detour — each test then chooses whether its counter-offer breaches policy.
 */
async function sentQuote(discountBp = pct(5), quantity = 4): Promise<{ id: string; lineId: string; version: number }> {
  const draft = await rep.post('/api/quotations').send({ customerId: seeded.customers.acme.id });
  expect(draft.status).toBe(201);
  const id = draft.body.quote.id as string;

  const added = await rep.post(`/api/quotations/${id}/lines`).send({
    productId: seeded.products.laptop.id,
    quantity,
    discountBp,
  });
  expect(added.status).toBe(201);

  const submit = await rep.post(`/api/quotations/${id}/confirm`).send({});
  expect(submit.body.quote.status).toBe('APPROVED');

  const send = await rep.post(`/api/quotations/${id}/send`).send({});
  expect(send.status).toBe(200);
  expect(send.body.quote.status).toBe('SENT');

  const view = await buyer.get(`/api/portal/quotations/${id}`);
  expect(view.status).toBe(200);
  return {
    id,
    lineId: view.body.quote.lines[0].id as string,
    version: view.body.quote.version as number,
  };
}

async function internalQuote(id: string) {
  const res = await rep.get(`/api/quotations/${id}`);
  expect(res.status).toBe(200);
  return res.body.quote;
}

async function clearApprovals(id: string) {
  for (const reviewer of [manager, finance]) {
    const pending = await reviewer.get(`/api/approvals?quotationId=${id}`);
    for (const rung of pending.body.data as Array<{ id: string; level: string }>) {
      await reviewer.post(`/api/approvals/${rung.id}/approve`).send({});
    }
  }
}

describe('AT-12 customer views a sent quote and counters', () => {
  it('withholds cost, margin and risk internals from the portal payload', async () => {
    const { id } = await sentQuote();
    const res = await buyer.get(`/api/portal/quotations/${id}`);
    expect(res.status).toBe(200);

    const line = res.body.quote.lines[0] as Record<string, unknown>;
    // Prices, discounts and tax are the customer's business; cost and margin are not.
    expect(line).toHaveProperty('unitPricePaise');
    expect(line).toHaveProperty('discountBp');
    expect(line).toHaveProperty('taxAmountPaise');
    for (const leaked of ['costAmountPaise', 'marginPaise', 'unitCostPaise', 'effectiveCeilingBp', 'violationBp']) {
      expect(line).not.toHaveProperty(leaked);
    }
  });

  it('records a counter-offer and moves the quote under negotiation', async () => {
    const { id, lineId, version } = await sentQuote();

    const res = await buyer.post(`/api/portal/quotations/${id}/negotiations`).send({
      requestType: 'DISCOUNT_COUNTER',
      lineId,
      proposedDiscountBp: pct(9),
      version,
      comment: 'Can you meet us at 9%?',
    });
    expect(res.status).toBe(201);
    expect(res.body.request.status).toBe('SUBMITTED');
    expect(res.body.request.proposedDiscountBp).toBe(pct(9));

    expect((await internalQuote(id)).status).toBe('UNDER_NEGOTIATION');

    // The rep sees it on the quote they are working.
    const requests = (await internalQuote(id)).negotiations as Array<{ id: string; comment: string }>;
    expect(requests).toHaveLength(1);
    expect(requests[0]!.comment).toBe('Can you meet us at 9%?');
  });

  it('rejects a counter written against a stale version', async () => {
    const { id, lineId, version } = await sentQuote();

    const res = await buyer.post(`/api/portal/quotations/${id}/negotiations`).send({
      requestType: 'DISCOUNT_COUNTER',
      lineId,
      proposedDiscountBp: pct(9),
      version: version + 5,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NEGOTIATION_STALE');
  });

  it('refuses a discount counter that names no line', async () => {
    const { id, version } = await sentQuote();

    const res = await buyer.post(`/api/portal/quotations/${id}/negotiations`).send({
      requestType: 'DISCOUNT_COUNTER',
      proposedDiscountBp: pct(9),
      version,
    });
    expect(res.status).toBe(400);
  });

  it('accepts a plain question without changing any commercial term', async () => {
    const { id, version } = await sentQuote();
    const before = await internalQuote(id);

    const res = await buyer.post(`/api/portal/quotations/${id}/negotiations`).send({
      requestType: 'QUESTION',
      version,
      comment: 'Does the price include on-site install?',
    });
    expect(res.status).toBe(201);

    const requestId = res.body.request.id as string;
    const applied = await rep.post(`/api/quotations/${id}/negotiations/${requestId}/apply`).send({});
    expect(applied.status).toBe(200);

    // A question anchors the conversation to a version but must not reprice.
    expect(applied.body.quote.grandTotalPaise).toBe(before.grandTotalPaise);
    expect(applied.body.quote.lines[0].discountBp).toBe(before.lines[0].discountBp);
  });
});

describe('AT-14 counter within policy proceeds without approval', () => {
  it('writes the proposed discount onto the line and returns the quote to SENT', async () => {
    const { id, lineId, version } = await sentQuote(pct(5));

    const submitted = await buyer.post(`/api/portal/quotations/${id}/negotiations`).send({
      requestType: 'DISCOUNT_COUNTER',
      lineId,
      proposedDiscountBp: pct(9),
      version,
    });
    const requestId = submitted.body.request.id as string;

    const applied = await rep.post(`/api/quotations/${id}/negotiations/${requestId}/apply`).send({});
    expect(applied.status).toBe(200);

    const quote = applied.body.quote;
    // The whole point: the customer's number is now the line's number.
    expect(quote.lines[0].discountBp).toBe(pct(9));
    expect(quote.version).toBeGreaterThan(version);
    // 9% is inside the Gold–Hardware 15% ceiling, so no reviewer is needed.
    expect(quote.lines[0].violationBp).toBe(0);
    expect(quote.requiredApprovalLevel).toBe('NONE');
    expect(quote.status).toBe('SENT');

    const pending = await manager.get(`/api/approvals?quotationId=${id}`);
    expect(pending.body.data).toHaveLength(0);
  });

  it('applies a quantity change', async () => {
    const { id, lineId, version } = await sentQuote(pct(5), 4);

    const submitted = await buyer.post(`/api/portal/quotations/${id}/negotiations`).send({
      requestType: 'QUANTITY_CHANGE',
      lineId,
      proposedQuantity: 7,
      version,
    });
    const requestId = submitted.body.request.id as string;

    const applied = await rep.post(`/api/quotations/${id}/negotiations/${requestId}/apply`).send({});
    expect(applied.status).toBe(200);
    expect(applied.body.quote.lines[0].quantity).toBe(7);
  });

  it('marks the request APPLIED and stamps the version it produced', async () => {
    const { id, lineId, version } = await sentQuote(pct(5));

    const submitted = await buyer.post(`/api/portal/quotations/${id}/negotiations`).send({
      requestType: 'DISCOUNT_COUNTER',
      lineId,
      proposedDiscountBp: pct(8),
      version,
    });
    const requestId = submitted.body.request.id as string;
    await rep.post(`/api/quotations/${id}/negotiations/${requestId}/apply`).send({});

    const quote = await internalQuote(id);
    const request = (quote.negotiations as Array<{ id: string; status: string; resultingVersion: number }>)
      .find((n) => n.id === requestId);
    expect(request!.status).toBe('APPLIED');
    expect(request!.resultingVersion).toBe(quote.version);
  });

  it('will not apply the same request twice', async () => {
    const { id, lineId, version } = await sentQuote(pct(5));

    const submitted = await buyer.post(`/api/portal/quotations/${id}/negotiations`).send({
      requestType: 'DISCOUNT_COUNTER',
      lineId,
      proposedDiscountBp: pct(8),
      version,
    });
    const requestId = submitted.body.request.id as string;

    expect((await rep.post(`/api/quotations/${id}/negotiations/${requestId}/apply`).send({})).status).toBe(200);

    const again = await rep.post(`/api/quotations/${id}/negotiations/${requestId}/apply`).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('NEGOTIATION_STATE');
  });
});

describe('AT-13 counter beyond policy re-enters approval', () => {
  it('recalculates risk, raises the chain and blocks the customer from finalising', async () => {
    const { id, lineId, version } = await sentQuote(pct(5));

    const submitted = await buyer.post(`/api/portal/quotations/${id}/negotiations`).send({
      requestType: 'DISCOUNT_COUNTER',
      lineId,
      proposedDiscountBp: pct(40),
      version,
    });
    const requestId = submitted.body.request.id as string;

    const applied = await rep.post(`/api/quotations/${id}/negotiations/${requestId}/apply`).send({});
    expect(applied.status).toBe(200);

    const quote = applied.body.quote;
    // 40% against a 15% ceiling is a 25-point breach; risk must reflect it.
    expect(quote.lines[0].discountBp).toBe(pct(40));
    expect(quote.lines[0].violationBp).toBe(pct(25));
    expect(quote.riskScoreBp).toBeGreaterThan(0);
    expect(quote.requiredApprovalLevel).not.toBe('NONE');
    expect(quote.status).toBe('PENDING_APPROVAL');

    const rungs = await manager.get(`/api/approvals?quotationId=${id}`);
    expect((rungs.body.data as unknown[]).length).toBeGreaterThan(0);

    // The customer must not be able to lock in terms nobody has approved.
    const premature = await buyer.post(`/api/portal/quotations/${id}/confirm`).send({});
    expect(premature.status).toBe(409);
    expect(await internalQuote(id).then((q) => q.status)).toBe('PENDING_APPROVAL');
  });

  it('marks the request PENDING_APPROVAL rather than APPLIED', async () => {
    const { id, lineId, version } = await sentQuote(pct(5));

    const submitted = await buyer.post(`/api/portal/quotations/${id}/negotiations`).send({
      requestType: 'DISCOUNT_COUNTER',
      lineId,
      proposedDiscountBp: pct(40),
      version,
    });
    const requestId = submitted.body.request.id as string;
    await rep.post(`/api/quotations/${id}/negotiations/${requestId}/apply`).send({});

    const quote = await internalQuote(id);
    const request = (quote.negotiations as Array<{ id: string; status: string }>).find((n) => n.id === requestId);
    expect(request!.status).toBe('PENDING_APPROVAL');
  });

  it('lets the customer accept once the reviewers have cleared it', async () => {
    const { id, lineId, version } = await sentQuote(pct(5));

    const submitted = await buyer.post(`/api/portal/quotations/${id}/negotiations`).send({
      requestType: 'DISCOUNT_COUNTER',
      lineId,
      proposedDiscountBp: pct(40),
      version,
    });
    await rep
      .post(`/api/quotations/${id}/negotiations/${submitted.body.request.id}/apply`)
      .send({});

    await clearApprovals(id);

    const accepted = await buyer.post(`/api/portal/quotations/${id}/confirm`).send({});
    expect(accepted.status).toBe(200);
    expect(accepted.body.quote.status).toBe('CONFIRMED');
  });
});

describe('portal acceptance', () => {
  it('ships demo data the customer can actually act on', async () => {
    // Regression guard: the portal used to open on a DRAFT quotation only, so
    // there was nothing to accept and the feature looked absent.
    const list = await buyer.get('/api/portal/quotations');
    expect(list.status).toBe(200);

    const rows = list.body.data as Array<{ id: string; status: string }>;
    const actionable = rows.filter((q) => q.status === 'SENT' || q.status === 'UNDER_NEGOTIATION');
    expect(actionable.length).toBeGreaterThan(0);
    expect(rows.map((q) => q.id)).toContain(seeded.quotations.sent.id);

    // And it is genuinely acceptable, not merely labelled that way.
    const accept = await buyer.post(`/api/portal/quotations/${seeded.quotations.sent.id}/confirm`).send({});
    expect(accept.status).toBe(200);
    expect(accept.body.quote.status).toBe('CONFIRMED');
  });

  it('actually transitions the quotation to CONFIRMED and stamps confirmedAt', async () => {
    const { id } = await sentQuote();

    const res = await buyer.post(`/api/portal/quotations/${id}/confirm`).send({});
    expect(res.status).toBe(200);
    expect(res.body.quote.status).toBe('CONFIRMED');
    expect(res.body.quote.confirmedAt).not.toBeNull();

    // Read back through the internal view: the row moved, not just the response.
    const internal = await internalQuote(id);
    expect(internal.status).toBe('CONFIRMED');
    expect(internal.confirmedAt).not.toBeNull();

    const audit = await rep.get(`/api/quotations/${id}/audit?limit=50`);
    const actions = (audit.body.data as Array<{ action: string }>).map((a) => a.action);
    expect(actions).toContain('CUSTOMER_CONFIRMED');
  });

  it('refuses a second acceptance', async () => {
    const { id } = await sentQuote();
    expect((await buyer.post(`/api/portal/quotations/${id}/confirm`).send({})).status).toBe(200);

    const again = await buyer.post(`/api/portal/quotations/${id}/confirm`).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('QUOTE_STATE');
  });

  it("refuses to accept another customer's quotation", async () => {
    const res = await buyer.post(`/api/portal/quotations/${seeded.quotations.clean.id}/confirm`).send({});
    expect(res.status).toBe(404);
  });

  it('refuses to accept a draft that was never sent', async () => {
    const draft = await rep.post('/api/quotations').send({ customerId: seeded.customers.acme.id });
    const id = draft.body.quote.id as string;

    const res = await buyer.post(`/api/portal/quotations/${id}/confirm`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUOTE_STATE');
  });
});
