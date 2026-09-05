import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma';
import { loginAs, request } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { seedBaseline, seedMasterData, type Baseline, type MasterData } from '../helpers/fixtures';

let baseline: Baseline;
let master: MasterData;

beforeEach(async () => {
  await resetDatabase();
  baseline = await seedBaseline();
  master = await seedMasterData(baseline);
});

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

// ===========================================================================
// Product pairings - the data behind upsell/cross-sell (docs/PRD.md 12)
// ===========================================================================

describe('GET /api/product-pairings', () => {
  it('starts empty and returns the list envelope', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const { status, body } = await client.get('/api/product-pairings');

    expect(status).toBe(200);
    expect(body).toEqual({ data: [], meta: { total: 0, limit: 50, offset: 0 } });
  });

  it('resolves both product names so a suggestion can be rendered without extra calls', async () => {
    const admin = await loginAs(baseline.users.admin.email);
    await admin.post('/api/product-pairings').send({
      productId: master.productLaptopId,
      recommendedProductId: master.productWarrantyId,
      weight: 0.9,
    });

    const client = await loginAs(baseline.users.rep.email);
    const { body } = await client.get('/api/product-pairings');

    expect(body.meta.total).toBe(1);
    expect(body.data[0]).toMatchObject({
      productSku: 'HW-LAPTOP-ENT',
      productName: 'Enterprise Laptop',
      recommendedSku: 'SV-WARRANTY-EXT',
      recommendedName: 'Extended Warranty',
      weight: '0.9000',
      active: true,
    });
  });

  it('orders by descending weight, so the strongest suggestion leads', async () => {
    const admin = await loginAs(baseline.users.admin.email);
    await admin.post('/api/product-pairings').send({
      productId: master.productLaptopId,
      recommendedProductId: master.productSetupId,
      weight: 0.7,
    });
    await admin.post('/api/product-pairings').send({
      productId: master.productLaptopId,
      recommendedProductId: master.productWarrantyId,
      weight: 0.9,
    });

    const { body } = await admin.get('/api/product-pairings');
    expect(body.data.map((row: { recommendedSku: string }) => row.recommendedSku)).toEqual([
      'SV-WARRANTY-EXT',
      'SV-SETUP',
    ]);
  });

  it('filters by source product and by active state', async () => {
    const admin = await loginAs(baseline.users.admin.email);
    const fromLaptop = await admin.post('/api/product-pairings').send({
      productId: master.productLaptopId,
      recommendedProductId: master.productWarrantyId,
    });
    await admin.post('/api/product-pairings').send({
      productId: master.productSetupId,
      recommendedProductId: master.productSupportId,
    });

    expect(
      (await admin.get(`/api/product-pairings?productId=${master.productLaptopId}`)).body.meta.total,
    ).toBe(1);

    await admin.patch(`/api/product-pairings/${fromLaptop.body.data.id}`).send({ active: false });
    expect((await admin.get('/api/product-pairings?active=true')).body.meta.total).toBe(1);
    expect((await admin.get('/api/product-pairings?active=false')).body.meta.total).toBe(1);
    expect((await admin.get('/api/product-pairings')).body.meta.total).toBe(2);
  });

  it('rejects a malformed product filter and an unknown query parameter', async () => {
    const client = await loginAs(baseline.users.admin.email);
    expect((await client.get('/api/product-pairings?productId=nope')).status).toBe(400);
    expect((await client.get('/api/product-pairings?sort=weight')).status).toBe(400);
  });

  it('is readable by every internal role, since a rep sees the suggestions', async () => {
    for (const email of [
      baseline.users.admin.email,
      baseline.users.rep.email,
      baseline.users.manager.email,
      baseline.users.finance.email,
    ]) {
      const client = await loginAs(email);
      expect((await client.get('/api/product-pairings')).status, email).toBe(200);
    }
  });

  it('is not reachable by a customer session or without one', async () => {
    const portal = await loginAs(baseline.users.acmeBuyer.email, 'portal');
    expect((await portal.get('/api/product-pairings')).status).toBe(403);
    expect((await request().get('/api/product-pairings')).status).toBe(401);
  });
});

describe('POST /api/product-pairings', () => {
  const pairing = (productId: string, recommendedProductId: string) => ({
    productId,
    recommendedProductId,
  });

  it('creates a pairing, defaults the weight to 1 and audits it', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .post('/api/product-pairings')
      .send(pairing(master.productLaptopId, master.productWarrantyId));

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ weight: '1.0000', active: true });

    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'ProductPairing', entityId: response.body.data.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'CONFIGURATION_CHANGED',
      actorUserId: baseline.users.admin.id,
      actorRole: 'ADMIN',
    });
    expect(audit[0]!.newValue).toMatchObject({
      productId: master.productLaptopId,
      recommendedProductId: master.productWarrantyId,
      weight: '1.0000',
    });
  });

  it('refuses a product recommending itself', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .post('/api/product-pairings')
      .send(pairing(master.productLaptopId, master.productLaptopId));

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(response.body.error.details[0].path).toBe('recommendedProductId');
    expect(await prisma.productPairing.count()).toBe(0);
  });

  it('rejects a duplicate pairing but allows the reverse direction', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const forward = pairing(master.productLaptopId, master.productWarrantyId);

    expect((await client.post('/api/product-pairings').send(forward)).status).toBe(201);
    expect((await client.post('/api/product-pairings').send(forward)).status).toBe(409);

    // Pairings are directional: "laptop suggests warranty" and "warranty suggests
    // laptop" are different recommendations.
    const reverse = pairing(master.productWarrantyId, master.productLaptopId);
    expect((await client.post('/api/product-pairings').send(reverse)).status).toBe(201);
  });

  it('reports an unknown source and an unknown recommended product distinctly', async () => {
    const client = await loginAs(baseline.users.admin.email);

    const badSource = await client
      .post('/api/product-pairings')
      .send(pairing(UNKNOWN_ID, master.productWarrantyId));
    expect(badSource.status).toBe(404);
    expect(badSource.body.error.message).toBe('Product not found');

    const badTarget = await client
      .post('/api/product-pairings')
      .send(pairing(master.productLaptopId, UNKNOWN_ID));
    expect(badTarget.status).toBe(404);
    expect(badTarget.body.error.message).toBe('Recommended product not found');
  });

  it('rejects a zero or negative weight and an unknown field', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const base = pairing(master.productLaptopId, master.productWarrantyId);

    for (const weight of [0, -1]) {
      expect((await client.post('/api/product-pairings').send({ ...base, weight })).status, String(weight)).toBe(400);
    }
    expect((await client.post('/api/product-pairings').send({ ...base, active: false })).status).toBe(400);
  });

  it('is refused to every non-admin role', async () => {
    for (const email of [
      baseline.users.rep.email,
      baseline.users.manager.email,
      baseline.users.finance.email,
    ]) {
      const client = await loginAs(email);
      const response = await client
        .post('/api/product-pairings')
        .send(pairing(master.productLaptopId, master.productWarrantyId));
      expect(response.status, email).toBe(403);
    }
    expect(await prisma.productPairing.count()).toBe(0);
  });
});

describe('PATCH /api/product-pairings/:id', () => {
  async function createPairing(): Promise<string> {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.post('/api/product-pairings').send({
      productId: master.productLaptopId,
      recommendedProductId: master.productWarrantyId,
      weight: 0.5,
    });
    return response.body.data.id as string;
  }

  it('reweights a pairing and audits before and after', async () => {
    const id = await createPairing();
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.patch(`/api/product-pairings/${id}`).send({ weight: 0.85 });

    expect(response.status).toBe(200);
    expect(response.body.data.weight).toBe('0.8500');

    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'ProductPairing', entityId: id },
      orderBy: { createdAt: 'asc' },
    });
    // One row for the create, one for the update - history is append-only.
    expect(audit).toHaveLength(2);
    expect(audit[1]!.oldValue).toEqual({ weight: '0.5000' });
    expect(audit[1]!.newValue).toEqual({ weight: '0.8500' });
  });

  it('deactivates rather than deletes', async () => {
    const id = await createPairing();
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.patch(`/api/product-pairings/${id}`).send({ active: false });

    expect(response.status).toBe(200);
    expect(response.body.data.active).toBe(false);
    expect(await prisma.productPairing.count()).toBe(1);
  });

  it('writes no audit row for a no-op patch', async () => {
    const id = await createPairing();
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.patch(`/api/product-pairings/${id}`).send({ weight: 0.5 });

    expect(response.status).toBe(200);
    expect(
      await prisma.auditLog.count({ where: { entityType: 'ProductPairing', entityId: id } }),
    ).toBe(1);
  });

  it('rejects an empty patch, an unknown id and a malformed id', async () => {
    const id = await createPairing();
    const client = await loginAs(baseline.users.admin.email);

    expect((await client.patch(`/api/product-pairings/${id}`).send({})).status).toBe(400);
    expect((await client.patch(`/api/product-pairings/${UNKNOWN_ID}`).send({ weight: 1 })).status).toBe(404);
    expect((await client.patch('/api/product-pairings/nope').send({ weight: 1 })).status).toBe(400);
  });

  it('is refused to a rep', async () => {
    const id = await createPairing();
    const client = await loginAs(baseline.users.rep.email);
    expect((await client.patch(`/api/product-pairings/${id}`).send({ weight: 9 })).status).toBe(403);
  });
});

// ===========================================================================
// Promotions
// ===========================================================================

describe('GET /api/promotions', () => {
  it('reports live state from the window and the active flag', async () => {
    const admin = await loginAs(baseline.users.admin.email);
    await admin
      .post('/api/promotions')
      .send({ code: 'always-on', name: 'Always on', productId: master.productWarrantyId });

    const { body } = await admin.get('/api/promotions');
    expect(body.meta.total).toBe(1);
    expect(body.data[0]).toMatchObject({
      code: 'ALWAYS-ON',
      productSku: 'SV-WARRANTY-EXT',
      productName: 'Extended Warranty',
      startsAt: null,
      endsAt: null,
      // No window at all means in force whenever active.
      live: true,
      active: true,
      priority: 0,
    });
  });

  it('treats a future window as not live and a past window as not live', async () => {
    const admin = await loginAs(baseline.users.admin.email);
    const hour = 60 * 60 * 1000;

    await admin.post('/api/promotions').send({
      code: 'future',
      name: 'Future',
      productId: master.productWarrantyId,
      startsAt: new Date(Date.now() + hour).toISOString(),
    });
    await admin.post('/api/promotions').send({
      code: 'past',
      name: 'Past',
      productId: master.productSetupId,
      endsAt: new Date(Date.now() - hour).toISOString(),
    });
    await admin.post('/api/promotions').send({
      code: 'current',
      name: 'Current',
      productId: master.productLaptopId,
      startsAt: new Date(Date.now() - hour).toISOString(),
      endsAt: new Date(Date.now() + hour).toISOString(),
    });

    const { body } = await admin.get('/api/promotions');
    const byCode = Object.fromEntries(
      body.data.map((row: { code: string; live: boolean }) => [row.code, row.live]),
    );
    expect(byCode).toEqual({ FUTURE: false, PAST: false, CURRENT: true });

    // The live filter narrows to what the recommendation engine would boost now.
    const live = await admin.get('/api/promotions?live=true');
    expect(live.body.meta.total).toBe(1);
    expect(live.body.data[0].code).toBe('CURRENT');
  });

  it('excludes a deactivated promotion from the live filter', async () => {
    const admin = await loginAs(baseline.users.admin.email);
    const created = await admin
      .post('/api/promotions')
      .send({ code: 'switchable', name: 'Switchable', productId: master.productWarrantyId });

    await admin.patch(`/api/promotions/${created.body.data.id}`).send({ active: false });

    const all = await admin.get('/api/promotions');
    expect(all.body.data[0]).toMatchObject({ active: false, live: false });
    expect((await admin.get('/api/promotions?live=true')).body.meta.total).toBe(0);
  });

  it('orders by descending priority', async () => {
    const admin = await loginAs(baseline.users.admin.email);
    await admin
      .post('/api/promotions')
      .send({ code: 'low', name: 'Low', productId: master.productSetupId, priority: 1 });
    await admin
      .post('/api/promotions')
      .send({ code: 'high', name: 'High', productId: master.productWarrantyId, priority: 50 });

    const { body } = await admin.get('/api/promotions');
    expect(body.data.map((row: { code: string }) => row.code)).toEqual(['HIGH', 'LOW']);
  });

  it('filters by product and searches code and name', async () => {
    const admin = await loginAs(baseline.users.admin.email);
    await admin
      .post('/api/promotions')
      .send({ code: 'warranty-bundle', name: 'Warranty bundle', productId: master.productWarrantyId });
    await admin
      .post('/api/promotions')
      .send({ code: 'setup-deal', name: 'Setup deal', productId: master.productSetupId });

    expect((await admin.get(`/api/promotions?productId=${master.productSetupId}`)).body.meta.total).toBe(1);
    expect((await admin.get('/api/promotions?q=bundle')).body.meta.total).toBe(1);
    expect((await admin.get('/api/promotions?q=WARRANTY')).body.meta.total).toBe(1);
    expect((await admin.get('/api/promotions?q=absent')).body.meta.total).toBe(0);
  });

  it('is readable by every internal role and by no customer', async () => {
    for (const email of [
      baseline.users.admin.email,
      baseline.users.rep.email,
      baseline.users.manager.email,
      baseline.users.finance.email,
    ]) {
      const client = await loginAs(email);
      expect((await client.get('/api/promotions')).status, email).toBe(200);
    }

    const portal = await loginAs(baseline.users.acmeBuyer.email, 'portal');
    expect((await portal.get('/api/promotions')).status).toBe(403);
    expect((await request().get('/api/promotions')).status).toBe(401);
  });
});

describe('POST /api/promotions', () => {
  const promotion = (productId: string) => ({
    code: 'q1-push',
    name: 'Q1 push',
    productId,
    priority: 10,
  });

  it('creates a promotion, uppercases the code and audits it', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.post('/api/promotions').send(promotion(master.productWarrantyId));

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ code: 'Q1-PUSH', priority: 10 });

    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'Promotion', entityId: response.body.data.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.newValue).toMatchObject({ code: 'Q1-PUSH', productId: master.productWarrantyId });
  });

  it('accepts an ISO timestamp window', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const startsAt = '2026-10-01T00:00:00.000Z';
    const endsAt = '2026-12-31T23:59:59.000Z';

    const response = await client
      .post('/api/promotions')
      .send({ ...promotion(master.productWarrantyId), startsAt, endsAt });

    expect(response.status).toBe(201);
    expect(new Date(response.body.data.startsAt).toISOString()).toBe(startsAt);
    expect(new Date(response.body.data.endsAt).toISOString()).toBe(endsAt);
  });

  it('refuses a window that ends before it starts', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.post('/api/promotions').send({
      ...promotion(master.productWarrantyId),
      startsAt: '2026-12-01T00:00:00.000Z',
      endsAt: '2026-11-01T00:00:00.000Z',
    });

    expect(response.status).toBe(422);
    expect(response.body.error.details[0].path).toBe('endsAt');
    expect(await prisma.promotion.count()).toBe(0);
  });

  it('refuses a zero-length window', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const sameInstant = '2026-11-01T00:00:00.000Z';
    const response = await client
      .post('/api/promotions')
      .send({ ...promotion(master.productWarrantyId), startsAt: sameInstant, endsAt: sameInstant });

    expect(response.status).toBe(422);
  });

  it('rejects a duplicate code, an unknown product and a malformed timestamp', async () => {
    const client = await loginAs(baseline.users.admin.email);
    await client.post('/api/promotions').send(promotion(master.productWarrantyId));

    expect((await client.post('/api/promotions').send(promotion(master.productSetupId))).status).toBe(409);
    expect(
      (await client.post('/api/promotions').send({ ...promotion(UNKNOWN_ID), code: 'other' })).status,
    ).toBe(404);
    expect(
      (await client
        .post('/api/promotions')
        .send({ ...promotion(master.productSetupId), code: 'bad-date', startsAt: 'not-a-date' })).status,
    ).toBe(400);
  });

  it('is refused to every non-admin role', async () => {
    for (const email of [
      baseline.users.rep.email,
      baseline.users.manager.email,
      baseline.users.finance.email,
    ]) {
      const client = await loginAs(email);
      const response = await client.post('/api/promotions').send(promotion(master.productWarrantyId));
      expect(response.status, email).toBe(403);
    }
    expect(await prisma.promotion.count()).toBe(0);
  });
});

describe('PATCH /api/promotions/:id', () => {
  async function createPromotion(body: Record<string, unknown> = {}): Promise<string> {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.post('/api/promotions').send({
      code: 'editable',
      name: 'Editable',
      productId: master.productWarrantyId,
      ...body,
    });
    return response.body.data.id as string;
  }

  it('renames and reprioritises, recording only what changed', async () => {
    const id = await createPromotion();
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.patch(`/api/promotions/${id}`).send({ name: 'Edited', priority: 5 });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ name: 'Edited', priority: 5 });

    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'Promotion', entityId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit).toHaveLength(2);
    expect(audit[1]!.oldValue).toEqual({ name: 'Editable', priority: 0 });
    expect(audit[1]!.newValue).toEqual({ name: 'Edited', priority: 5 });
  });

  it('validates the resulting window, not the supplied field alone', async () => {
    const id = await createPromotion({
      startsAt: '2026-11-01T00:00:00.000Z',
      endsAt: '2026-12-01T00:00:00.000Z',
    });
    const client = await loginAs(baseline.users.admin.email);

    // Moving the start past the stored end is only visible when both are read.
    const invalid = await client
      .patch(`/api/promotions/${id}`)
      .send({ startsAt: '2026-12-15T00:00:00.000Z' });
    expect(invalid.status).toBe(422);

    const valid = await client
      .patch(`/api/promotions/${id}`)
      .send({ startsAt: '2026-11-15T00:00:00.000Z' });
    expect(valid.status).toBe(200);
  });

  it('clears a window bound with an explicit null', async () => {
    const id = await createPromotion({ endsAt: '2026-12-01T00:00:00.000Z' });
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.patch(`/api/promotions/${id}`).send({ endsAt: null });

    expect(response.status).toBe(200);
    expect(response.body.data.endsAt).toBeNull();
    expect(response.body.data.live).toBe(true);
  });

  it('rejects an empty patch, a code change, an unknown id and a malformed id', async () => {
    const id = await createPromotion();
    const client = await loginAs(baseline.users.admin.email);

    expect((await client.patch(`/api/promotions/${id}`).send({})).status).toBe(400);
    // Codes are immutable: other configuration and history refer to them.
    expect((await client.patch(`/api/promotions/${id}`).send({ code: 'RENAMED' })).status).toBe(400);
    expect((await client.patch(`/api/promotions/${UNKNOWN_ID}`).send({ name: 'x' })).status).toBe(404);
    expect((await client.patch('/api/promotions/nope').send({ name: 'x' })).status).toBe(400);
  });

  it('writes no audit row for a no-op patch', async () => {
    const id = await createPromotion();
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.patch(`/api/promotions/${id}`).send({ name: 'Editable' });

    expect(response.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { entityType: 'Promotion', entityId: id } })).toBe(1);
  });

  it('is refused to a rep', async () => {
    const id = await createPromotion();
    const client = await loginAs(baseline.users.rep.email);
    expect((await client.patch(`/api/promotions/${id}`).send({ priority: 99 })).status).toBe(403);
  });
});

// ===========================================================================
// Database backstops
// ===========================================================================

describe('recommendation constraints as a backstop', () => {
  it('refuses an inverted promotion window even through raw SQL', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const created = await client.post('/api/promotions').send({
      code: 'raw-check',
      name: 'Raw check',
      productId: master.productWarrantyId,
      startsAt: '2026-11-01T00:00:00.000Z',
      endsAt: '2026-12-01T00:00:00.000Z',
    });

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE promotions SET ends_at = '2026-10-01T00:00:00Z' WHERE id = '${created.body.data.id}'`,
      ),
    ).rejects.toThrow(/promotions_window_order_check/);
  });

  it('keeps one pairing per direction', async () => {
    await prisma.productPairing.create({
      data: {
        productId: master.productLaptopId,
        recommendedProductId: master.productWarrantyId,
      },
    });

    await expect(
      prisma.productPairing.create({
        data: {
          productId: master.productLaptopId,
          recommendedProductId: master.productWarrantyId,
        },
      }),
    ).rejects.toThrow();
  });

  it('removes pairings when a product is deleted, since they carry no history', async () => {
    // Products are deactivated rather than deleted in normal operation; this pins
    // the cascade so a future hard delete cannot orphan a recommendation.
    const pairing = await prisma.productPairing.create({
      data: {
        productId: master.productLaptopId,
        recommendedProductId: master.productWarrantyId,
      },
    });

    await prisma.product.delete({ where: { id: master.productWarrantyId } });
    expect(await prisma.productPairing.findUnique({ where: { id: pairing.id } })).toBeNull();
  });
});
