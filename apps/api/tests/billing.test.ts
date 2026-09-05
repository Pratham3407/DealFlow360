/**
 * Billing authority and its ordering against fulfillment.
 *
 * Two things are asserted here. Issuing an invoice is open to the whole
 * commercial side — the rep who closed the deal should not have to wait on
 * Finance to press a button — while money movement (payments, credit notes)
 * stays with Finance. And billing does not queue behind fulfillment: both are
 * downstream of the customer confirming, and either may happen first.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, resetDatabase, sessionAs, type SeedResult, type Session } from './helpers/db.js';

let seeded: SeedResult;
let rep: Session;
let manager: Session;
let finance: Session;
let admin: Session;
let buyer: Session;

beforeAll(async () => {
  seeded = await resetDatabase();
  rep = await sessionAs('rep@dealflow.local', DEMO_PASSWORD);
  manager = await sessionAs('manager@dealflow.local', DEMO_PASSWORD);
  finance = await sessionAs('finance@dealflow.local', DEMO_PASSWORD);
  admin = await sessionAs('admin@dealflow.local', DEMO_PASSWORD);
  buyer = await sessionAs('buyer@acme.local', DEMO_PASSWORD);
});

const pct = (n: number) => n * 100;

/** A quote the customer has accepted, with one one-time and one recurring line. */
async function confirmedOrder(): Promise<string> {
  const draft = await rep.post('/api/quotations').send({ customerId: seeded.customers.acme.id });
  expect(draft.status).toBe(201);
  const id = draft.body.quote.id as string;

  await rep.post(`/api/quotations/${id}/lines`).send({
    productId: seeded.products.laptop.id, quantity: 4, discountBp: pct(10),
  });
  await rep.post(`/api/quotations/${id}/lines`).send({
    productId: seeded.products.support.id, quantity: 4, discountBp: pct(5),
  });

  const submit = await rep.post(`/api/quotations/${id}/confirm`).send({});
  expect(submit.body.quote.status).toBe('APPROVED');
  expect((await rep.post(`/api/quotations/${id}/send`).send({})).status).toBe(200);
  expect((await buyer.post(`/api/portal/quotations/${id}/confirm`).send({})).status).toBe(200);

  const quote = await rep.get(`/api/quotations/${id}`);
  expect(quote.body.quote.status).toBe('CONFIRMED');
  return id;
}

async function billing(id: string) {
  const res = await finance.get(`/api/orders/${id}/billing`);
  expect(res.status).toBe(200);
  return res.body as { invoices: Array<{ id: string; type: string; amountPaise: number }>; subscriptions: unknown[] };
}

describe('billing does not wait for fulfillment', () => {
  it('invoices a confirmed order that has no fulfillment plan at all', async () => {
    const id = await confirmedOrder();

    // Nothing has been allocated — there is no plan record yet.
    const plan = await finance.get(`/api/orders/${id}/fulfillment`);
    expect(plan.status).toBe(200);
    expect(plan.body.fulfillment).toBeNull();

    const generated = await finance.post(`/api/orders/${id}/billing/generate`).send({});
    expect(generated.status).toBe(200);

    const result = await billing(id);
    expect(result.invoices.length).toBeGreaterThan(0);
    expect(result.invoices.some((i) => i.type === 'ONE_TIME')).toBe(true);
  });

  it('still invoices an order that is already in fulfillment', async () => {
    const id = await confirmedOrder();

    expect((await finance.post(`/api/orders/${id}/fulfillment/recalculate`).send({})).status).toBe(200);
    expect((await finance.post(`/api/orders/${id}/fulfillment/accept`).send({})).status).toBe(200);
    expect((await rep.get(`/api/quotations/${id}`)).body.quote.status).toBe('FULFILLMENT');

    expect((await finance.post(`/api/orders/${id}/billing/generate`).send({})).status).toBe(200);
    expect((await billing(id)).invoices.length).toBeGreaterThan(0);
  });

  it('refuses to bill a quotation the customer has not accepted', async () => {
    const draft = await rep.post('/api/quotations').send({ customerId: seeded.customers.acme.id });
    const id = draft.body.quote.id as string;
    await rep.post(`/api/quotations/${id}/lines`).send({
      productId: seeded.products.laptop.id, quantity: 1, discountBp: pct(5),
    });

    // Draft: not billable.
    const asDraft = await finance.post(`/api/orders/${id}/billing/generate`).send({});
    expect(asDraft.status).toBe(409);
    expect(asDraft.body.error.code).toBe('QUOTE_STATE');

    // Approved but not yet accepted: still not billable. Approval is an internal
    // decision; only the customer's acceptance creates something to invoice.
    await rep.post(`/api/quotations/${id}/confirm`).send({});
    const asApproved = await finance.post(`/api/orders/${id}/billing/generate`).send({});
    expect(asApproved.status).toBe(409);

    await rep.post(`/api/quotations/${id}/send`).send({});
    const asSent = await finance.post(`/api/orders/${id}/billing/generate`).send({});
    expect(asSent.status).toBe(409);
  });

  it('does not duplicate the one-time invoice when generated twice', async () => {
    const id = await confirmedOrder();
    await finance.post(`/api/orders/${id}/billing/generate`).send({});
    const first = await billing(id);

    await finance.post(`/api/orders/${id}/billing/generate`).send({});
    const second = await billing(id);

    const oneTime = (rows: typeof first.invoices) => rows.filter((i) => i.type === 'ONE_TIME');
    expect(oneTime(second.invoices)).toHaveLength(oneTime(first.invoices).length);
  });
});

describe('who may issue an invoice', () => {
  it('lets a Sales Rep issue it on their own confirmed deal', async () => {
    const id = await confirmedOrder();
    const res = await rep.post(`/api/orders/${id}/billing/generate`).send({});
    expect(res.status).toBe(200);
    expect((await billing(id)).invoices.length).toBeGreaterThan(0);
  });

  it('lets a Sales Manager issue it', async () => {
    const id = await confirmedOrder();
    expect((await manager.post(`/api/orders/${id}/billing/generate`).send({})).status).toBe(200);
  });

  it('lets Finance issue it', async () => {
    const id = await confirmedOrder();
    expect((await finance.post(`/api/orders/${id}/billing/generate`).send({})).status).toBe(200);
  });

  it('lets an Admin issue it', async () => {
    const id = await confirmedOrder();
    expect((await admin.post(`/api/orders/${id}/billing/generate`).send({})).status).toBe(200);
  });

  it('keeps a portal customer out entirely', async () => {
    const id = await confirmedOrder();
    const res = await buyer.post(`/api/orders/${id}/billing/generate`).send({});
    expect(res.status).toBe(403);
  });

  it('records who issued it in the audit trail', async () => {
    const id = await confirmedOrder();
    await rep.post(`/api/orders/${id}/billing/generate`).send({});

    const audit = await rep.get(`/api/quotations/${id}/audit?limit=100`);
    const entries = audit.body.data as Array<{ action: string; actorUserId: string | null }>;
    // Widening who may bill only holds up if the record says who did.
    expect(entries.some((e) => e.actorUserId === seeded.users.rep.id)).toBe(true);
  });
});

describe('money movement stays with Finance', () => {
  async function invoiceFor(id: string) {
    await finance.post(`/api/orders/${id}/billing/generate`).send({});
    const result = await billing(id);
    const invoice = result.invoices.find((i) => i.type === 'ONE_TIME');
    expect(invoice).toBeDefined();
    return invoice!;
  }

  it('refuses a payment from a Sales Rep and a Sales Manager', async () => {
    const id = await confirmedOrder();
    const invoice = await invoiceFor(id);

    expect((await rep.post('/api/payments').send({ invoiceId: invoice.id, amountPaise: 1000 })).status).toBe(403);
    expect((await manager.post('/api/payments').send({ invoiceId: invoice.id, amountPaise: 1000 })).status).toBe(403);
  });

  it('accepts a payment from Finance', async () => {
    const id = await confirmedOrder();
    const invoice = await invoiceFor(id);

    const res = await finance.post('/api/payments').send({ invoiceId: invoice.id, amountPaise: 1000 });
    expect(res.status).toBe(201);
  });

  it('refuses a credit note from a Sales Manager but allows Finance', async () => {
    const id = await confirmedOrder();
    const invoice = await invoiceFor(id);

    // A credit note returns money, so there has to be money to return: the
    // service caps the credit at the amount actually paid.
    const paid = await finance.post('/api/payments').send({ invoiceId: invoice.id, amountPaise: 5_000 });
    expect(paid.status).toBe(201);

    const denied = await manager.post('/api/credit-notes').send({
      invoiceId: invoice.id,
      customerId: seeded.customers.acme.id,
      amountPaise: 500,
      reason: 'Goodwill',
    });
    expect(denied.status).toBe(403);

    const allowed = await finance.post('/api/credit-notes').send({
      invoiceId: invoice.id,
      customerId: seeded.customers.acme.id,
      amountPaise: 500,
      reason: 'Goodwill',
    });
    expect(allowed.status).toBe(201);
  });

  it('will not credit more than has been paid', async () => {
    const id = await confirmedOrder();
    const invoice = await invoiceFor(id);

    const res = await finance.post('/api/credit-notes').send({
      invoiceId: invoice.id,
      customerId: seeded.customers.acme.id,
      amountPaise: 1_000,
      reason: 'Nothing paid yet',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CREDIT_OVERPAID');
  });
});
