import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma';
import { AuditAction } from '../../src/modules/audit/auditService';
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

async function configAuditFor(entityType: string, entityId?: string) {
  return prisma.auditLog.findMany({
    where: {
      action: AuditAction.CONFIGURATION_CHANGED,
      entityType,
      ...(entityId ? { entityId } : {}),
    },
    orderBy: { createdAt: 'asc' },
  });
}

// ===========================================================================
// Customer tiers
// ===========================================================================

describe('GET /api/customer-tiers', () => {
  it('returns the list envelope with a total', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const response = await client.get('/api/customer-tiers');

    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual({ total: 2, limit: 50, offset: 0 });
    expect(response.body.data).toHaveLength(2);
  });

  it('orders by ceiling and exposes usage counts', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const { body } = await client.get('/api/customer-tiers');

    expect(body.data.map((tier: { code: string }) => tier.code)).toEqual(['SILVER', 'GOLD']);
    const gold = body.data.find((tier: { code: string }) => tier.code === 'GOLD');
    expect(gold).toMatchObject({
      defaultDiscountCeiling: '15.000',
      customerCount: 1,
      discountRuleCount: 2,
    });
  });

  it('pages independently of the total', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const { body } = await client.get('/api/customer-tiers?limit=1&offset=1');

    expect(body.data).toHaveLength(1);
    expect(body.meta).toEqual({ total: 2, limit: 1, offset: 1 });
  });

  it('searches by code and name', async () => {
    const client = await loginAs(baseline.users.admin.email);
    expect((await client.get('/api/customer-tiers?q=gol')).body.meta.total).toBe(1);
    expect((await client.get('/api/customer-tiers?q=nothing')).body.meta.total).toBe(0);
  });

  it('rejects an unknown query parameter rather than ignoring it', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.get('/api/customer-tiers?sortBy=code');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('is readable by every internal role', async () => {
    for (const email of [
      baseline.users.admin.email,
      baseline.users.rep.email,
      baseline.users.manager.email,
      baseline.users.finance.email,
    ]) {
      const client = await loginAs(email);
      expect((await client.get('/api/customer-tiers')).status, email).toBe(200);
    }
  });

  it('is not reachable by a customer session', async () => {
    const client = await loginAs(baseline.users.acmeBuyer.email, 'portal');
    expect((await client.get('/api/customer-tiers')).status).toBe(403);
  });

  it('requires authentication', async () => {
    expect((await request().get('/api/customer-tiers')).status).toBe(401);
  });
});

describe('POST /api/customer-tiers', () => {
  const payload = { code: 'platinum', name: 'Platinum', defaultDiscountCeiling: 20 };

  it('creates a tier, uppercases the code and audits the change', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.post('/api/customer-tiers').send(payload);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      code: 'PLATINUM',
      name: 'Platinum',
      defaultDiscountCeiling: '20.000',
      active: true,
    });

    const audit = await configAuditFor('CustomerTier', response.body.data.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: baseline.users.admin.id, actorRole: 'ADMIN' });
    expect(audit[0]!.newValue).toMatchObject({ code: 'PLATINUM', defaultDiscountCeiling: '20.000' });
  });

  it('rejects a duplicate code and a duplicate name', async () => {
    const client = await loginAs(baseline.users.admin.email);

    const duplicateCode = await client
      .post('/api/customer-tiers')
      .send({ code: 'GOLD', name: 'Another', defaultDiscountCeiling: 5 });
    expect(duplicateCode.status).toBe(409);

    const duplicateName = await client
      .post('/api/customer-tiers')
      .send({ code: 'NEW', name: 'Gold', defaultDiscountCeiling: 5 });
    expect(duplicateName.status).toBe(409);
  });

  it('rejects a ceiling outside 0-100 and one with too many decimals', async () => {
    const client = await loginAs(baseline.users.admin.email);

    for (const ceiling of [-1, 101, 12.3456]) {
      const response = await client
        .post('/api/customer-tiers')
        .send({ code: `T${Math.abs(ceiling)}`, name: `T${ceiling}`, defaultDiscountCeiling: ceiling });
      expect(response.status, String(ceiling)).toBe(400);
    }
  });

  it('rejects a code with unsafe characters', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .post('/api/customer-tiers')
      .send({ code: 'bad code!', name: 'Bad', defaultDiscountCeiling: 5 });

    expect(response.status).toBe(400);
  });

  it('is refused to a sales manager, who may set ceilings but not create tiers', async () => {
    const client = await loginAs(baseline.users.manager.email);
    const response = await client.post('/api/customer-tiers').send(payload);

    expect(response.status).toBe(403);
    expect(await prisma.customerTier.count()).toBe(2);
  });

  it('is refused to a rep and to finance', async () => {
    for (const email of [baseline.users.rep.email, baseline.users.finance.email]) {
      const client = await loginAs(email);
      expect((await client.post('/api/customer-tiers').send(payload)).status, email).toBe(403);
    }
    expect(await prisma.customerTier.count()).toBe(2);
  });
});

describe('PATCH /api/customer-tiers/:id', () => {
  it('lets an admin rename a tier and records only what changed', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .patch(`/api/customer-tiers/${baseline.tierGoldId}`)
      .send({ name: 'Gold Plus' });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Gold Plus');

    const audit = await configAuditFor('CustomerTier', baseline.tierGoldId);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.oldValue).toEqual({ name: 'Gold' });
    expect(audit[0]!.newValue).toEqual({ name: 'Gold Plus' });
  });

  it('lets a sales manager change the ceiling, per docs/RBAC.md', async () => {
    const client = await loginAs(baseline.users.manager.email);
    const response = await client
      .patch(`/api/customer-tiers/${baseline.tierGoldId}`)
      .send({ defaultDiscountCeiling: 18 });

    expect(response.status).toBe(200);
    expect(response.body.data.defaultDiscountCeiling).toBe('18.000');
  });

  it('refuses a sales manager renaming or deactivating a tier', async () => {
    const client = await loginAs(baseline.users.manager.email);

    expect(
      (await client.patch(`/api/customer-tiers/${baseline.tierGoldId}`).send({ name: 'Renamed' }))
        .status,
    ).toBe(403);
    expect(
      (await client.patch(`/api/customer-tiers/${baseline.tierGoldId}`).send({ active: false }))
        .status,
    ).toBe(403);

    const unchanged = await prisma.customerTier.findUnique({ where: { id: baseline.tierGoldId } });
    expect(unchanged).toMatchObject({ name: 'Gold', active: true });
  });

  it('refuses a rep changing anything', async () => {
    const client = await loginAs(baseline.users.rep.email);
    expect(
      (await client
        .patch(`/api/customer-tiers/${baseline.tierGoldId}`)
        .send({ defaultDiscountCeiling: 50 })).status,
    ).toBe(403);
  });

  it('rejects an empty patch and an unknown field', async () => {
    const client = await loginAs(baseline.users.admin.email);
    expect((await client.patch(`/api/customer-tiers/${baseline.tierGoldId}`).send({})).status).toBe(
      400,
    );
    expect(
      (await client.patch(`/api/customer-tiers/${baseline.tierGoldId}`).send({ code: 'NEWCODE' }))
        .status,
    ).toBe(400);
  });

  it('returns 404 for an unknown id and 400 for a malformed one', async () => {
    const client = await loginAs(baseline.users.admin.email);
    expect(
      (await client
        .patch('/api/customer-tiers/00000000-0000-0000-0000-000000000000')
        .send({ name: 'x' })).status,
    ).toBe(404);
    expect((await client.patch('/api/customer-tiers/nope').send({ name: 'x' })).status).toBe(400);
  });

  it('writes no audit row for a no-op patch', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .patch(`/api/customer-tiers/${baseline.tierGoldId}`)
      .send({ name: 'Gold' });

    expect(response.status).toBe(200);
    expect(await configAuditFor('CustomerTier', baseline.tierGoldId)).toHaveLength(0);
  });
});

// ===========================================================================
// Customers
// ===========================================================================

describe('GET /api/customers', () => {
  it('lists customers with their tier and its ceiling', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const { status, body } = await client.get('/api/customers');

    expect(status).toBe(200);
    expect(body.meta.total).toBe(2);
    const acme = body.data.find((customer: { code: string }) => customer.code === 'ACME');
    expect(acme).toMatchObject({
      name: 'Acme Corp',
      tierName: 'Gold',
      tierDiscountCeiling: '15.000',
      portalUserCount: 1,
      quotationCount: 0,
      active: true,
    });
  });

  it('filters by tier and searches contact details', async () => {
    const client = await loginAs(baseline.users.admin.email);

    const byTier = await client.get(`/api/customers?tierId=${baseline.tierGoldId}`);
    expect(byTier.body.meta.total).toBe(1);
    expect(byTier.body.data[0].code).toBe('ACME');

    expect((await client.get('/api/customers?q=globex')).body.meta.total).toBe(1);
  });

  it('rejects a malformed tier filter', async () => {
    const client = await loginAs(baseline.users.admin.email);
    expect((await client.get('/api/customers?tierId=not-a-uuid')).status).toBe(400);
  });

  it('filters by active state, which is tri-state', async () => {
    await prisma.customer.update({ where: { id: baseline.globexId }, data: { active: false } });
    const client = await loginAs(baseline.users.admin.email);

    expect((await client.get('/api/customers')).body.meta.total).toBe(2);
    expect((await client.get('/api/customers?active=true')).body.meta.total).toBe(1);
    expect((await client.get('/api/customers?active=false')).body.meta.total).toBe(1);
  });
});

describe('GET /api/customers/:id', () => {
  it('returns one customer', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const response = await client.get(`/api/customers/${baseline.acmeId}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ code: 'ACME', tierCode: 'GOLD' });
  });

  it('returns 404 for an unknown customer', async () => {
    const client = await loginAs(baseline.users.rep.email);
    expect(
      (await client.get('/api/customers/00000000-0000-0000-0000-000000000000')).status,
    ).toBe(404);
  });

  it('is not reachable by a customer session, even for its own record', async () => {
    // A customer reads its own data through /api/portal, never the internal API.
    const client = await loginAs(baseline.users.acmeBuyer.email, 'portal');
    expect((await client.get(`/api/customers/${baseline.acmeId}`)).status).toBe(403);
  });
});

describe('POST /api/customers', () => {
  const payload = (tierId: string) => ({
    code: 'initech',
    name: 'Initech',
    tierId,
    contactName: 'Peter Gibbons',
    contactEmail: 'peter@initech.test',
  });

  it('creates a customer and audits it', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.post('/api/customers').send(payload(baseline.tierSilverId));

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      code: 'INITECH',
      tierName: 'Silver',
      contactEmail: 'peter@initech.test',
    });

    const audit = await configAuditFor('Customer', response.body.data.id);
    expect(audit).toHaveLength(1);
  });

  it('rejects a duplicate code', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .post('/api/customers')
      .send({ code: 'ACME', name: 'Acme again', tierId: baseline.tierGoldId });

    expect(response.status).toBe(409);
  });

  it('rejects an unknown tier and a deactivated one', async () => {
    const client = await loginAs(baseline.users.admin.email);

    const unknown = await client
      .post('/api/customers')
      .send({ code: 'X1', name: 'X', tierId: '00000000-0000-0000-0000-000000000000' });
    expect(unknown.status).toBe(404);

    await prisma.customerTier.update({
      where: { id: baseline.tierSilverId },
      data: { active: false },
    });
    const deactivated = await client
      .post('/api/customers')
      .send({ code: 'X2', name: 'X', tierId: baseline.tierSilverId });
    expect(deactivated.status).toBe(409);
    expect(deactivated.body.error.message).toMatch(/deactivated/i);
  });

  it('rejects a malformed contact email', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .post('/api/customers')
      .send({ code: 'X3', name: 'X', tierId: baseline.tierGoldId, contactEmail: 'not-an-email' });

    expect(response.status).toBe(400);
  });

  it('is refused to every non-admin internal role', async () => {
    for (const email of [
      baseline.users.rep.email,
      baseline.users.manager.email,
      baseline.users.finance.email,
    ]) {
      const client = await loginAs(email);
      const response = await client.post('/api/customers').send(payload(baseline.tierGoldId));
      expect(response.status, email).toBe(403);
    }
    expect(await prisma.customer.count()).toBe(2);
  });
});

describe('PATCH /api/customers/:id', () => {
  it('moves a customer to another tier and audits the tier id', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .patch(`/api/customers/${baseline.acmeId}`)
      .send({ tierId: baseline.tierSilverId });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ tierName: 'Silver', tierDiscountCeiling: '10.000' });

    const audit = await configAuditFor('Customer', baseline.acmeId);
    expect(audit).toHaveLength(1);
    // Display fields follow from tierId, so only tierId is recorded.
    expect(Object.keys(audit[0]!.newValue as object)).toEqual(['tierId']);
  });

  it('clears an optional contact field with an explicit null', async () => {
    const client = await loginAs(baseline.users.admin.email);
    await client.patch(`/api/customers/${baseline.acmeId}`).send({ contactPhone: '+91 80 1234' });

    const response = await client
      .patch(`/api/customers/${baseline.acmeId}`)
      .send({ contactPhone: null });

    expect(response.status).toBe(200);
    expect(response.body.data.contactPhone).toBeNull();
  });

  it('deactivates a customer without deleting it', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.patch(`/api/customers/${baseline.globexId}`).send({ active: false });

    expect(response.status).toBe(200);
    expect(response.body.data.active).toBe(false);
    expect(await prisma.customer.count()).toBe(2);
  });

  it('rejects an unknown tier', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .patch(`/api/customers/${baseline.acmeId}`)
      .send({ tierId: '00000000-0000-0000-0000-000000000000' });

    expect(response.status).toBe(404);
  });

  it('is refused to a rep', async () => {
    const client = await loginAs(baseline.users.rep.email);
    expect(
      (await client.patch(`/api/customers/${baseline.acmeId}`).send({ name: 'Renamed' })).status,
    ).toBe(403);
  });
});

// ===========================================================================
// Cross-cutting guarantees
// ===========================================================================

describe('master-data audit trail', () => {
  it('records every configuration write under one action, distinguished by entity type', async () => {
    const client = await loginAs(baseline.users.admin.email);

    await client
      .post('/api/customer-tiers')
      .send({ code: 'BRONZE', name: 'Bronze', defaultDiscountCeiling: 5 });
    await client.post('/api/customers').send({
      code: 'NEWCO',
      name: 'Newco',
      tierId: baseline.tierGoldId,
    });

    const rows = await prisma.auditLog.findMany({
      where: { action: AuditAction.CONFIGURATION_CHANGED },
      select: { entityType: true },
    });

    expect(rows.map((row) => row.entityType).sort()).toEqual(['Customer', 'CustomerTier']);
  });

  it('cannot be reached without a session, so nothing is written', async () => {
    const response = await request()
      .post('/api/customers')
      .send({ code: 'GHOST', name: 'Ghost', tierId: baseline.tierGoldId });

    expect(response.status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: AuditAction.CONFIGURATION_CHANGED } })).toBe(
      0,
    );
  });
});

describe('database constraints as a backstop', () => {
  it('refuses a customer tier ceiling above 100 even through raw SQL', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE customer_tiers SET default_discount_ceiling = 101 WHERE id = '${baseline.tierGoldId}'`,
      ),
    ).rejects.toThrow(/customer_tiers_ceiling_range_check/);
  });

  it('refuses a second tier-wide discount rule for the same tier', async () => {
    // The partial unique index the API relies on for its conflict message.
    await expect(
      prisma.discountRule.create({
        data: { customerTierId: baseline.tierGoldId, categoryId: null, maximumDiscount: '20.000' },
      }),
    ).rejects.toThrow(/discount_rules_tier_wide_key/);
    expect(master.discountRuleGoldTierWideId).toBeTruthy();
  });
});
