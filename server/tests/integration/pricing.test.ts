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
// Price lists
// ===========================================================================

describe('GET /api/price-lists', () => {
  it('lists price lists with their tier and item count', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const { status, body } = await client.get('/api/price-lists');

    expect(status).toBe(200);
    expect(body.meta.total).toBe(1);
    expect(body.data[0]).toMatchObject({
      code: 'PL-GOLD-INR',
      customerTierName: 'Gold',
      currency: 'INR',
      itemCount: 2,
    });
  });

  it('returns the items, each alongside the base price it overrides', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const { body } = await client.get(`/api/price-lists/${master.priceListGoldId}`);

    expect(body.data.items).toHaveLength(2);
    const laptop = body.data.items.find((item: { sku: string }) => item.sku === 'HW-LAPTOP-ENT');
    expect(laptop).toMatchObject({ price: '80000.00', basePrice: '80000.00' });
  });

  it('is readable by every internal role and by no customer', async () => {
    for (const email of [
      baseline.users.admin.email,
      baseline.users.rep.email,
      baseline.users.manager.email,
      baseline.users.finance.email,
    ]) {
      const client = await loginAs(email);
      expect((await client.get('/api/price-lists')).status, email).toBe(200);
    }

    const portal = await loginAs(baseline.users.acmeBuyer.email, 'portal');
    expect((await portal.get('/api/price-lists')).status).toBe(403);
  });

  it('returns 404 for an unknown list', async () => {
    const client = await loginAs(baseline.users.rep.email);
    expect((await client.get(`/api/price-lists/${UNKNOWN_ID}`)).status).toBe(404);
  });
});

describe('POST /api/price-lists', () => {
  it('creates a list defaulting to INR', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .post('/api/price-lists')
      .send({ code: 'pl-silver-inr', name: 'Silver price list', customerTierId: baseline.tierSilverId });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      code: 'PL-SILVER-INR',
      currency: 'INR',
      customerTierName: 'Silver',
      itemCount: 0,
    });
  });

  it('allows a list not bound to any tier', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .post('/api/price-lists')
      .send({ code: 'pl-special', name: 'Negotiated', customerTierId: null });

    expect(response.status).toBe(201);
    expect(response.body.data.customerTierId).toBeNull();
  });

  it('rejects a duplicate code, an unknown tier and a foreign currency', async () => {
    const client = await loginAs(baseline.users.admin.email);

    expect(
      (await client.post('/api/price-lists').send({ code: 'PL-GOLD-INR', name: 'Clash' })).status,
    ).toBe(409);
    expect(
      (await client.post('/api/price-lists').send({ code: 'PL-X', name: 'X', customerTierId: UNKNOWN_ID }))
        .status,
    ).toBe(404);
    // Multi-currency is a documented non-goal for the base version.
    expect(
      (await client.post('/api/price-lists').send({ code: 'PL-USD', name: 'USD', currency: 'USD' }))
        .status,
    ).toBe(400);
  });

  it('is refused to every non-admin role', async () => {
    for (const email of [
      baseline.users.rep.email,
      baseline.users.manager.email,
      baseline.users.finance.email,
    ]) {
      const client = await loginAs(email);
      expect((await client.post('/api/price-lists').send({ code: 'X', name: 'X' })).status, email).toBe(403);
    }
    expect(await prisma.priceList.count()).toBe(1);
  });
});

describe('price list items', () => {
  it('sets a price with PUT, then updates it idempotently', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const path = `/api/price-lists/${master.priceListGoldId}/items/${master.productWarrantyId}`;

    const created = await client.put(path).send({ price: 7000 });
    expect(created.status).toBe(200);
    expect(created.body.data).toMatchObject({
      sku: 'SV-WARRANTY-EXT',
      price: '7000.00',
      basePrice: '7500.00',
    });

    const updated = await client.put(path).send({ price: 6500 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.price).toBe('6500.00');

    // One row per write, both preserved.
    const audit = await prisma.auditLog.findMany({
      where: {
        entityType: 'PriceListItem',
        entityId: `${master.priceListGoldId}:${master.productWarrantyId}`,
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit).toHaveLength(2);
    expect(audit[1]!.oldValue).toMatchObject({ price: '7000.00' });
    expect(audit[1]!.newValue).toMatchObject({ price: '6500.00' });
  });

  it('removes an entry so pricing falls back to base price', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const path = `/api/price-lists/${master.priceListGoldId}/items/${master.productLaptopId}`;

    const response = await client.delete(path);
    expect(response.status).toBe(204);

    const list = await client.get(`/api/price-lists/${master.priceListGoldId}`);
    expect(list.body.data.itemCount).toBe(1);

    const audit = await prisma.auditLog.findMany({
      where: {
        entityType: 'PriceListItem',
        entityId: `${master.priceListGoldId}:${master.productLaptopId}`,
      },
    });
    expect(audit[0]!.reason).toMatch(/falls back to base price/i);
  });

  it('returns 404 for an unknown list, product or absent entry', async () => {
    const client = await loginAs(baseline.users.admin.email);

    expect(
      (await client.put(`/api/price-lists/${UNKNOWN_ID}/items/${master.productLaptopId}`).send({ price: 1 }))
        .status,
    ).toBe(404);
    expect(
      (await client.put(`/api/price-lists/${master.priceListGoldId}/items/${UNKNOWN_ID}`).send({ price: 1 }))
        .status,
    ).toBe(404);
    expect(
      (await client.delete(`/api/price-lists/${master.priceListGoldId}/items/${master.productWarrantyId}`))
        .status,
    ).toBe(404);
  });

  it('rejects a negative price and fractional paise', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const path = `/api/price-lists/${master.priceListGoldId}/items/${master.productWarrantyId}`;

    expect((await client.put(path).send({ price: -1 })).status).toBe(400);
    expect((await client.put(path).send({ price: 10.005 })).status).toBe(400);
  });

  it('is refused to a rep', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const path = `/api/price-lists/${master.priceListGoldId}/items/${master.productWarrantyId}`;
    expect((await client.put(path).send({ price: 1 })).status).toBe(403);
    expect((await client.delete(path)).status).toBe(403);
  });
});

// ===========================================================================
// Discount rules
// ===========================================================================

describe('GET /api/discount-rules', () => {
  it('lists rules and flags the tier-wide fallback', async () => {
    const client = await loginAs(baseline.users.manager.email);
    const { status, body } = await client.get('/api/discount-rules');

    expect(status).toBe(200);
    expect(body.meta.total).toBe(2);

    const tierWide = body.data.find((rule: { tierWide: boolean }) => rule.tierWide);
    expect(tierWide).toMatchObject({
      customerTierName: 'Gold',
      categoryId: null,
      maximumDiscount: '15.000',
    });

    const services = body.data.find((rule: { categoryName: string | null }) => rule.categoryName === 'Services');
    expect(services).toMatchObject({ maximumDiscount: '10.000', priority: 10, tierWide: false });
  });

  it('filters by tier and category', async () => {
    const client = await loginAs(baseline.users.manager.email);
    expect((await client.get(`/api/discount-rules?customerTierId=${baseline.tierGoldId}`)).body.meta.total).toBe(2);
    expect((await client.get(`/api/discount-rules?categoryId=${master.categoryServicesId}`)).body.meta.total).toBe(1);
    expect((await client.get(`/api/discount-rules?customerTierId=${baseline.tierSilverId}`)).body.meta.total).toBe(0);
  });
});

describe('GET /api/discount-rules/effective', () => {
  it('resolves the category rule ahead of the tier-wide rule (AT-04)', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const response = await client.get(
      `/api/discount-rules/effective?customerTierId=${baseline.tierGoldId}&categoryId=${master.categoryServicesId}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      maximumDiscount: '10.000',
      source: 'CATEGORY_RULE',
      ruleId: master.discountRuleGoldServicesId,
      customerTierName: 'Gold',
      categoryName: 'Services',
    });
  });

  it('falls back to the tier-wide rule for a category without its own', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const response = await client.get(
      `/api/discount-rules/effective?customerTierId=${baseline.tierGoldId}&categoryId=${master.categoryHardwareId}`,
    );

    expect(response.body.data).toMatchObject({
      maximumDiscount: '15.000',
      source: 'TIER_RULE',
      ruleId: master.discountRuleGoldTierWideId,
    });
  });

  it('falls back to the tier default when the tier has no rules at all', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const response = await client.get(
      `/api/discount-rules/effective?customerTierId=${baseline.tierSilverId}`,
    );

    expect(response.body.data).toMatchObject({
      maximumDiscount: '10.000',
      source: 'TIER_DEFAULT',
      ruleId: null,
    });
  });

  it('ignores a deactivated rule', async () => {
    await prisma.discountRule.update({
      where: { id: master.discountRuleGoldServicesId },
      data: { active: false },
    });

    const client = await loginAs(baseline.users.rep.email);
    const response = await client.get(
      `/api/discount-rules/effective?customerTierId=${baseline.tierGoldId}&categoryId=${master.categoryServicesId}`,
    );

    expect(response.body.data).toMatchObject({ maximumDiscount: '15.000', source: 'TIER_RULE' });
  });

  it('requires the tier and validates it exists', async () => {
    const client = await loginAs(baseline.users.rep.email);
    expect((await client.get('/api/discount-rules/effective')).status).toBe(400);
    expect(
      (await client.get(`/api/discount-rules/effective?customerTierId=${UNKNOWN_ID}`)).status,
    ).toBe(404);
    expect(
      (await client.get(
        `/api/discount-rules/effective?customerTierId=${baseline.tierGoldId}&categoryId=${UNKNOWN_ID}`,
      )).status,
    ).toBe(404);
  });

  it('is readable by a rep, who needs to know the ceiling before discounting', async () => {
    const client = await loginAs(baseline.users.rep.email);
    expect(
      (await client.get(`/api/discount-rules/effective?customerTierId=${baseline.tierGoldId}`)).status,
    ).toBe(200);
  });
});

describe('POST /api/discount-rules', () => {
  it('lets an admin add a category rule', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.post('/api/discount-rules').send({
      customerTierId: baseline.tierGoldId,
      categoryId: master.categoryHardwareId,
      maximumDiscount: 12.5,
      priority: 10,
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ maximumDiscount: '12.500', tierWide: false });
  });

  it('lets a sales manager add a rule, per docs/RBAC.md', async () => {
    const client = await loginAs(baseline.users.manager.email);
    const response = await client.post('/api/discount-rules').send({
      customerTierId: baseline.tierSilverId,
      maximumDiscount: 8,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.tierWide).toBe(true);
  });

  it('refuses a second tier-wide rule for the same tier with a readable conflict', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .post('/api/discount-rules')
      .send({ customerTierId: baseline.tierGoldId, maximumDiscount: 20 });

    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/tier-wide/i);
    expect(await prisma.discountRule.count()).toBe(2);
  });

  it('refuses a duplicate tier plus category rule', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.post('/api/discount-rules').send({
      customerTierId: baseline.tierGoldId,
      categoryId: master.categoryServicesId,
      maximumDiscount: 5,
    });

    expect(response.status).toBe(409);
  });

  it('rejects an unknown tier or category and an out-of-range ceiling', async () => {
    const client = await loginAs(baseline.users.admin.email);

    expect(
      (await client.post('/api/discount-rules').send({ customerTierId: UNKNOWN_ID, maximumDiscount: 5 }))
        .status,
    ).toBe(404);
    expect(
      (await client.post('/api/discount-rules').send({
        customerTierId: baseline.tierSilverId,
        categoryId: UNKNOWN_ID,
        maximumDiscount: 5,
      })).status,
    ).toBe(404);
    expect(
      (await client
        .post('/api/discount-rules')
        .send({ customerTierId: baseline.tierSilverId, maximumDiscount: 150 })).status,
    ).toBe(400);
  });

  it('is refused to a rep and to finance', async () => {
    for (const email of [baseline.users.rep.email, baseline.users.finance.email]) {
      const client = await loginAs(email);
      const response = await client
        .post('/api/discount-rules')
        .send({ customerTierId: baseline.tierSilverId, maximumDiscount: 30 });
      expect(response.status, email).toBe(403);
    }
    expect(await prisma.discountRule.count()).toBe(2);
  });
});

describe('PATCH /api/discount-rules/:id', () => {
  it('changes a ceiling, audits it, and changes what resolution returns', async () => {
    const client = await loginAs(baseline.users.manager.email);
    const response = await client
      .patch(`/api/discount-rules/${master.discountRuleGoldServicesId}`)
      .send({ maximumDiscount: 8 });

    expect(response.status).toBe(200);
    expect(response.body.data.maximumDiscount).toBe('8.000');

    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'DiscountRule', entityId: master.discountRuleGoldServicesId },
    });
    expect(audit[0]!.oldValue).toEqual({ maximumDiscount: '10.000' });
    expect(audit[0]!.newValue).toEqual({ maximumDiscount: '8.000' });

    const effective = await client.get(
      `/api/discount-rules/effective?customerTierId=${baseline.tierGoldId}&categoryId=${master.categoryServicesId}`,
    );
    expect(effective.body.data.maximumDiscount).toBe('8.000');
  });

  it('rejects an empty patch, an unknown id and a malformed id', async () => {
    const client = await loginAs(baseline.users.admin.email);
    expect(
      (await client.patch(`/api/discount-rules/${master.discountRuleGoldServicesId}`).send({})).status,
    ).toBe(400);
    expect((await client.patch(`/api/discount-rules/${UNKNOWN_ID}`).send({ priority: 1 })).status).toBe(404);
    expect((await client.patch('/api/discount-rules/xyz').send({ priority: 1 })).status).toBe(400);
  });

  it('is refused to a rep', async () => {
    const client = await loginAs(baseline.users.rep.email);
    expect(
      (await client
        .patch(`/api/discount-rules/${master.discountRuleGoldServicesId}`)
        .send({ maximumDiscount: 99 })).status,
    ).toBe(403);
  });
});

describe('pricing constraints as a backstop', () => {
  it('refuses a discount ceiling above 100 even through raw SQL', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE discount_rules SET maximum_discount = 101 WHERE id = '${master.discountRuleGoldTierWideId}'`,
      ),
    ).rejects.toThrow(/discount_rules_maximum_range_check/);
  });

  it('refuses a negative price list price even through raw SQL', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE price_list_items SET price = -1 WHERE price_list_id = '${master.priceListGoldId}'`,
      ),
    ).rejects.toThrow(/price_list_items_price_nonneg_check/);
  });
});

describe('unauthenticated access', () => {
  it('is refused on every pricing route', async () => {
    for (const path of ['/api/price-lists', '/api/discount-rules', '/api/discount-rules/effective']) {
      expect((await request().get(path)).status, path).toBe(401);
    }
  });
});
