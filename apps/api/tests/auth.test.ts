/**
 * AT-01 Login, AT-02 Customer isolation, plus the RBAC boundary the internal
 * workspace depends on.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, api, resetDatabase, sessionAs, sessionFor, type SeedResult } from './helpers/db.js';

let seeded: SeedResult;

beforeAll(async () => {
  seeded = await resetDatabase();
});

describe('AT-01 login', () => {
  it('accepts valid Sales Rep credentials and returns a usable token', async () => {
    const res = await api().post('/api/auth/login').send({
      email: 'rep@dealflow.local',
      password: DEMO_PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf('string');
    expect(res.body.user.role).toBe('SALES_REP');

    // The token must actually open the sales workspace, not just parse.
    const rep = sessionFor(res.body.token as string);
    const quotes = await rep.get('/api/quotations');
    expect(quotes.status).toBe(200);
    expect(Array.isArray(quotes.body.data)).toBe(true);
  });

  it('rejects a wrong password without revealing whether the email exists', async () => {
    const wrongPassword = await api()
      .post('/api/auth/login')
      .send({ email: 'rep@dealflow.local', password: 'not-the-password' });
    const unknownEmail = await api()
      .post('/api/auth/login')
      .send({ email: 'nobody@dealflow.local', password: DEMO_PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknownEmail.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('refuses unauthenticated access to the workspace', async () => {
    const res = await api().get('/api/quotations');
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const res = await api().get('/api/quotations').set('Authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});

describe('AT-02 customer isolation', () => {
  it('lets a portal customer read their own quotation', async () => {
    const buyer = await sessionAs('buyer@acme.local', DEMO_PASSWORD);

    const list = await buyer.get('/api/portal/quotations');
    expect(list.status).toBe(200);
    const ids = (list.body.data as { id: string }[]).map((q) => q.id);
    expect(ids).toContain(seeded.quotations.canonical.id);

    const single = await buyer.get(`/api/portal/quotations/${seeded.quotations.canonical.id}`);
    expect(single.status).toBe(200);
    expect(single.body.quote.id).toBe(seeded.quotations.canonical.id);
  });

  it("refuses another customer's quotation even when the id is known", async () => {
    const buyer = await sessionAs('buyer@acme.local', DEMO_PASSWORD);
    const otherCustomersQuote = seeded.quotations.clean.id;

    const res = await buyer.get(`/api/portal/quotations/${otherCustomersQuote}`);
    expect(res.status).toBe(404);

    // Nor may they act on it.
    const counter = await buyer.post(`/api/portal/quotations/${otherCustomersQuote}/negotiations`).send({
      requestType: 'DISCOUNT_COUNTER',
      proposedDiscountBp: 2000,
      version: 1,
    });
    expect(counter.status).toBeGreaterThanOrEqual(400);
    expect(counter.status).toBeLessThan(500);
  });

  it('keeps portal users out of the internal workspace', async () => {
    const buyer = await sessionAs('buyer@acme.local', DEMO_PASSWORD);

    const quotes = await buyer.get('/api/quotations');
    expect(quotes.status).toBe(403);
    expect(quotes.body.error.code).toBe('PORTAL_ONLY');

    const products = await buyer.get('/api/products');
    expect(products.status).toBe(403);
  });

  it('keeps internal users out of the portal routes', async () => {
    const rep = await sessionAs('rep@dealflow.local', DEMO_PASSWORD);
    const res = await rep.get('/api/portal/quotations');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CUSTOMER_ONLY');
  });
});