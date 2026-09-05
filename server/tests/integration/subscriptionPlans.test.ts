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

describe('GET /api/subscription-plans', () => {
  it('lists plans with their cadence and usage counts', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const { status, body } = await client.get('/api/subscription-plans');

    expect(status).toBe(200);
    expect(body.meta).toEqual({ total: 1, limit: 50, offset: 0 });
    expect(body.data[0]).toMatchObject({
      code: 'PREMIUM_MONTHLY',
      name: 'Premium Monthly',
      interval: 'MONTHLY',
      prorationRule: 'DAILY_PRORATION',
      cancellationRule: 'END_OF_PERIOD',
      refundRule: 'PARTIAL_PRORATED',
      // Premium Support references it.
      productCount: 1,
      subscriptionCount: 0,
      active: true,
    });
  });

  it('is readable by every internal role, since a rep must see the cadence to quote it', async () => {
    for (const email of [
      baseline.users.admin.email,
      baseline.users.rep.email,
      baseline.users.manager.email,
      baseline.users.finance.email,
    ]) {
      const client = await loginAs(email);
      expect((await client.get('/api/subscription-plans')).status, email).toBe(200);
    }
  });

  it('is not reachable by a customer session or without one', async () => {
    const portal = await loginAs(baseline.users.acmeBuyer.email, 'portal');
    expect((await portal.get('/api/subscription-plans')).status).toBe(403);
    expect((await request().get('/api/subscription-plans')).status).toBe(401);
  });

  it('searches and filters by active state', async () => {
    const client = await loginAs(baseline.users.admin.email);

    expect((await client.get('/api/subscription-plans?q=premium')).body.meta.total).toBe(1);
    expect((await client.get('/api/subscription-plans?q=absent')).body.meta.total).toBe(0);
    expect((await client.get('/api/subscription-plans?active=true')).body.meta.total).toBe(1);
    expect((await client.get('/api/subscription-plans?active=false')).body.meta.total).toBe(0);
  });

  it('rejects an unknown query parameter', async () => {
    const client = await loginAs(baseline.users.admin.email);
    expect((await client.get('/api/subscription-plans?interval=MONTHLY')).status).toBe(400);
  });
});

describe('POST /api/subscription-plans', () => {
  const payload = {
    code: 'standard_yearly',
    name: 'Standard Yearly',
    interval: 'YEARLY' as const,
  };

  it('lets finance create a plan and audits it', async () => {
    // docs/RBAC.md gives subscription configuration to Admin and Finance/Operations.
    const client = await loginAs(baseline.users.finance.email);
    const response = await client.post('/api/subscription-plans').send(payload);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      code: 'STANDARD_YEARLY',
      interval: 'YEARLY',
      // Documented defaults, applied server-side.
      prorationRule: 'DAILY_PRORATION',
      cancellationRule: 'END_OF_PERIOD',
      refundRule: 'PARTIAL_PRORATED',
      productCount: 0,
    });

    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'SubscriptionPlan', entityId: response.body.data.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'CONFIGURATION_CHANGED',
      actorUserId: baseline.users.finance.id,
      actorRole: 'FINANCE_OPERATIONS',
    });
  });

  it('lets an admin create one, and accepts every documented interval', async () => {
    const client = await loginAs(baseline.users.admin.email);

    for (const interval of ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const) {
      const response = await client
        .post('/api/subscription-plans')
        .send({ code: `plan_${interval}`, name: `Plan ${interval}`, interval });
      expect(response.status, interval).toBe(201);
      expect(response.body.data.interval).toBe(interval);
    }
  });

  it('accepts a no-proration plan when the refund rule does not need one', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const response = await client.post('/api/subscription-plans').send({
      ...payload,
      prorationRule: 'NONE',
      refundRule: 'NONE',
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ prorationRule: 'NONE', refundRule: 'NONE' });
  });

  it('refuses a prorated refund without proration, which would have nothing to compute from', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const response = await client.post('/api/subscription-plans').send({
      ...payload,
      prorationRule: 'NONE',
      refundRule: 'PARTIAL_PRORATED',
    });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(response.body.error.details[0].path).toBe('refundRule');
    expect(await prisma.subscriptionPlan.count()).toBe(1);
  });

  it('rejects a duplicate code and an unknown interval', async () => {
    const client = await loginAs(baseline.users.finance.email);

    expect(
      (await client
        .post('/api/subscription-plans')
        .send({ code: 'PREMIUM_MONTHLY', name: 'Clash', interval: 'MONTHLY' })).status,
    ).toBe(409);
    expect(
      (await client
        .post('/api/subscription-plans')
        .send({ code: 'WEEKLY_PLAN', name: 'Weekly', interval: 'WEEKLY' })).status,
    ).toBe(400);
  });

  it('rejects an unknown field rather than ignoring it', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const response = await client
      .post('/api/subscription-plans')
      .send({ ...payload, active: false });

    expect(response.status).toBe(400);
  });

  it('is refused to a rep and to a sales manager', async () => {
    for (const email of [baseline.users.rep.email, baseline.users.manager.email]) {
      const client = await loginAs(email);
      expect((await client.post('/api/subscription-plans').send(payload)).status, email).toBe(403);
    }
    expect(await prisma.subscriptionPlan.count()).toBe(1);
  });
});

describe('PATCH /api/subscription-plans/:id', () => {
  it('renames a plan and records only what changed', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const response = await client
      .patch(`/api/subscription-plans/${master.planMonthlyId}`)
      .send({ name: 'Premium Monthly (v2)' });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Premium Monthly (v2)');

    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'SubscriptionPlan', entityId: master.planMonthlyId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.oldValue).toEqual({ name: 'Premium Monthly' });
    expect(audit[0]!.newValue).toEqual({ name: 'Premium Monthly (v2)' });
  });

  it('changes the proration rule', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const response = await client
      .patch(`/api/subscription-plans/${master.planMonthlyId}`)
      .send({ prorationRule: 'FULL_PERIOD' });

    expect(response.status).toBe(200);
    expect(response.body.data.prorationRule).toBe('FULL_PERIOD');
  });

  it('validates proration against the resulting refund rule, not the field alone', async () => {
    const client = await loginAs(baseline.users.finance.email);

    // The stored refund rule is PARTIAL_PRORATED, so removing proration alone is
    // incoherent even though the request never mentions refunds.
    const incoherent = await client
      .patch(`/api/subscription-plans/${master.planMonthlyId}`)
      .send({ prorationRule: 'NONE' });
    expect(incoherent.status).toBe(422);

    // Changing both together is fine.
    const together = await client
      .patch(`/api/subscription-plans/${master.planMonthlyId}`)
      .send({ prorationRule: 'NONE', refundRule: 'NONE' });
    expect(together.status).toBe(200);
    expect(together.body.data).toMatchObject({ prorationRule: 'NONE', refundRule: 'NONE' });
  });

  it('refuses to deactivate a plan that products still reference', async () => {
    // A RECURRING product must always point at a live plan; the database enforces
    // the link, so this produces a readable conflict instead.
    const client = await loginAs(baseline.users.finance.email);
    const response = await client
      .patch(`/api/subscription-plans/${master.planMonthlyId}`)
      .send({ active: false });

    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/product\(s\) still use this plan/i);

    const unchanged = await prisma.subscriptionPlan.findUnique({
      where: { id: master.planMonthlyId },
    });
    expect(unchanged!.active).toBe(true);
  });

  it('allows deactivation once no product references it', async () => {
    const client = await loginAs(baseline.users.admin.email);

    // Detach the only referencing product first.
    await client
      .patch(`/api/products/${master.productSupportId}`)
      .send({ productType: 'ONE_TIME', subscriptionPlanId: null });

    const finance = await loginAs(baseline.users.finance.email);
    const response = await finance
      .patch(`/api/subscription-plans/${master.planMonthlyId}`)
      .send({ active: false });

    expect(response.status).toBe(200);
    expect(response.body.data.active).toBe(false);
    expect(await prisma.subscriptionPlan.count()).toBe(1);
  });

  it('allows an interval change while no subscription exists', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const response = await client
      .patch(`/api/subscription-plans/${master.planMonthlyId}`)
      .send({ interval: 'QUARTERLY' });

    expect(response.status).toBe(200);
    expect(response.body.data.interval).toBe('QUARTERLY');
  });

  it('refuses an interval change once subscriptions exist, which would reprice them silently', async () => {
    await prisma.subscription.create({
      data: {
        customerId: baseline.acmeId,
        productId: master.productSupportId,
        planId: master.planMonthlyId,
        quantity: 20,
        unitPrice: '5000.00',
        startDate: new Date('2026-01-01'),
        nextBillingDate: new Date('2026-02-01'),
        status: 'ACTIVE',
      },
    });

    const client = await loginAs(baseline.users.finance.email);
    const response = await client
      .patch(`/api/subscription-plans/${master.planMonthlyId}`)
      .send({ interval: 'YEARLY' });

    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/create a new plan instead/i);

    const unchanged = await prisma.subscriptionPlan.findUnique({
      where: { id: master.planMonthlyId },
    });
    expect(unchanged!.interval).toBe('MONTHLY');
  });

  it('still allows unrelated edits once subscriptions exist', async () => {
    await prisma.subscription.create({
      data: {
        customerId: baseline.acmeId,
        productId: master.productSupportId,
        planId: master.planMonthlyId,
        quantity: 5,
        unitPrice: '5000.00',
        startDate: new Date('2026-01-01'),
        nextBillingDate: new Date('2026-02-01'),
        status: 'ACTIVE',
      },
    });

    const client = await loginAs(baseline.users.finance.email);
    const response = await client
      .patch(`/api/subscription-plans/${master.planMonthlyId}`)
      .send({ cancellationRule: 'IMMEDIATE' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      cancellationRule: 'IMMEDIATE',
      subscriptionCount: 1,
    });
  });

  it('rejects an empty patch, an unknown id and a malformed id', async () => {
    const client = await loginAs(baseline.users.finance.email);

    expect((await client.patch(`/api/subscription-plans/${master.planMonthlyId}`).send({})).status).toBe(400);
    expect((await client.patch(`/api/subscription-plans/${UNKNOWN_ID}`).send({ name: 'x' })).status).toBe(404);
    expect((await client.patch('/api/subscription-plans/nope').send({ name: 'x' })).status).toBe(400);
  });

  it('writes no audit row for a no-op patch', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const response = await client
      .patch(`/api/subscription-plans/${master.planMonthlyId}`)
      .send({ name: 'Premium Monthly' });

    expect(response.status).toBe(200);
    expect(
      await prisma.auditLog.count({
        where: { entityType: 'SubscriptionPlan', entityId: master.planMonthlyId },
      }),
    ).toBe(0);
  });

  it('is refused to a rep', async () => {
    const client = await loginAs(baseline.users.rep.email);
    expect(
      (await client.patch(`/api/subscription-plans/${master.planMonthlyId}`).send({ name: 'x' }))
        .status,
    ).toBe(403);
  });
});
