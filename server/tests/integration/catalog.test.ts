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

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

// ===========================================================================
// Categories
// ===========================================================================

describe('GET /api/categories', () => {
  it('lists categories with product counts', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const { status, body } = await client.get('/api/categories');

    expect(status).toBe(200);
    expect(body.meta.total).toBe(3);
    const services = body.data.find((row: { code: string }) => row.code === 'SERVICES');
    // Setup Service and Extended Warranty both sit in Services.
    expect(services).toMatchObject({ productCount: 2, discountRuleCount: 1 });
  });

  it('is readable by every internal role and by no customer', async () => {
    for (const email of [
      baseline.users.admin.email,
      baseline.users.rep.email,
      baseline.users.manager.email,
      baseline.users.finance.email,
    ]) {
      const client = await loginAs(email);
      expect((await client.get('/api/categories')).status, email).toBe(200);
    }

    const portal = await loginAs(baseline.users.acmeBuyer.email, 'portal');
    expect((await portal.get('/api/categories')).status).toBe(403);
  });
});

describe('POST /api/categories', () => {
  it('creates a category and audits it', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .post('/api/categories')
      .send({ code: 'training', name: 'Training', defaultMarginPercent: 55.5 });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      code: 'TRAINING',
      name: 'Training',
      defaultMarginPercent: '55.500',
      productCount: 0,
    });

    const audit = await prisma.auditLog.findMany({ where: { entityType: 'Category' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe(AuditAction.CONFIGURATION_CHANGED);
  });

  it('accepts a null margin, since it is only indicative', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .post('/api/categories')
      .send({ code: 'misc', name: 'Miscellaneous', defaultMarginPercent: null });

    expect(response.status).toBe(201);
    expect(response.body.data.defaultMarginPercent).toBeNull();
  });

  it('rejects duplicate code and duplicate name', async () => {
    const client = await loginAs(baseline.users.admin.email);
    expect(
      (await client.post('/api/categories').send({ code: 'HARDWARE', name: 'Other' })).status,
    ).toBe(409);
    expect(
      (await client.post('/api/categories').send({ code: 'OTHER', name: 'Hardware' })).status,
    ).toBe(409);
  });

  it('is refused to every non-admin role, including the sales manager', async () => {
    for (const email of [
      baseline.users.rep.email,
      baseline.users.manager.email,
      baseline.users.finance.email,
    ]) {
      const client = await loginAs(email);
      const response = await client.post('/api/categories').send({ code: 'X', name: 'X' });
      expect(response.status, email).toBe(403);
    }
    expect(await prisma.category.count()).toBe(3);
  });
});

describe('PATCH /api/categories/:id', () => {
  it('renames a category and records the change', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .patch(`/api/categories/${master.categoryServicesId}`)
      .send({ name: 'Professional Services' });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Professional Services');

    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'Category', entityId: master.categoryServicesId },
    });
    expect(audit[0]!.oldValue).toEqual({ name: 'Services' });
  });

  it('rejects an empty patch, an unknown field and a bad id', async () => {
    const client = await loginAs(baseline.users.admin.email);
    expect((await client.patch(`/api/categories/${master.categoryServicesId}`).send({})).status).toBe(
      400,
    );
    expect(
      (await client.patch(`/api/categories/${master.categoryServicesId}`).send({ code: 'NEW' }))
        .status,
    ).toBe(400);
    expect((await client.patch(`/api/categories/${UNKNOWN_ID}`).send({ name: 'x' })).status).toBe(404);
  });
});

// ===========================================================================
// Products
// ===========================================================================

describe('GET /api/products', () => {
  it('lists products with a server-computed unit margin', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const { status, body } = await client.get('/api/products');

    expect(status).toBe(200);
    expect(body.meta.total).toBe(4);

    const laptop = body.data.find((row: { sku: string }) => row.sku === 'HW-LAPTOP-ENT');
    expect(laptop).toMatchObject({
      basePrice: '80000.00',
      costPrice: '60000.00',
      unitMargin: '20000.00',
      marginPercent: '25.000',
      categoryName: 'Hardware',
      productType: 'ONE_TIME',
    });
  });

  it('reports the plan on a recurring product', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const { body } = await client.get('/api/products?productType=RECURRING');

    expect(body.meta.total).toBe(1);
    expect(body.data[0]).toMatchObject({
      sku: 'SB-SUPPORT-PREM',
      subscriptionPlanName: 'Premium Monthly',
    });
  });

  it('filters by category and searches sku and name', async () => {
    const client = await loginAs(baseline.users.rep.email);

    expect((await client.get(`/api/products?categoryId=${master.categoryServicesId}`)).body.meta.total).toBe(2);
    expect((await client.get('/api/products?q=laptop')).body.meta.total).toBe(1);
    expect((await client.get('/api/products?q=HW-')).body.meta.total).toBe(1);
  });

  it('rejects an invalid product type filter', async () => {
    const client = await loginAs(baseline.users.rep.email);
    expect((await client.get('/api/products?productType=WEEKLY')).status).toBe(400);
  });

  it('returns one product by id and 404 otherwise', async () => {
    const client = await loginAs(baseline.users.rep.email);
    expect((await client.get(`/api/products/${master.productLaptopId}`)).body.data.sku).toBe(
      'HW-LAPTOP-ENT',
    );
    expect((await client.get(`/api/products/${UNKNOWN_ID}`)).status).toBe(404);
  });

  it('is not reachable by a customer session', async () => {
    const client = await loginAs(baseline.users.acmeBuyer.email, 'portal');
    expect((await client.get('/api/products')).status).toBe(403);
  });
});

describe('POST /api/products', () => {
  const oneTime = (categoryId: string) => ({
    sku: 'hw-dock',
    name: 'Docking Station',
    categoryId,
    productType: 'ONE_TIME' as const,
    basePrice: 12000,
    costPrice: 9000,
    taxPercent: 18,
  });

  it('creates a one-time product and computes its margin', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.post('/api/products').send(oneTime(master.categoryHardwareId));

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      sku: 'HW-DOCK',
      basePrice: '12000.00',
      costPrice: '9000.00',
      unitMargin: '3000.00',
      marginPercent: '25.000',
      subscriptionPlanId: null,
    });
  });

  it('requires a subscription plan on a recurring product', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.post('/api/products').send({
      sku: 'SB-BACKUP',
      name: 'Managed Backup',
      categoryId: master.categorySubscriptionsId,
      productType: 'RECURRING',
      basePrice: 2000,
      costPrice: 600,
    });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(response.body.error.details[0].path).toBe('subscriptionPlanId');
    expect(await prisma.product.count()).toBe(4);
  });

  it('accepts a recurring product with a plan', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.post('/api/products').send({
      sku: 'SB-BACKUP',
      name: 'Managed Backup',
      categoryId: master.categorySubscriptionsId,
      productType: 'RECURRING',
      basePrice: 2000,
      costPrice: 600,
      subscriptionPlanId: master.planMonthlyId,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.subscriptionPlanName).toBe('Premium Monthly');
  });

  it('refuses a plan on a one-time product', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.post('/api/products').send({
      ...oneTime(master.categoryHardwareId),
      subscriptionPlanId: master.planMonthlyId,
    });

    expect(response.status).toBe(422);
    expect(response.body.error.message).toMatch(/only a recurring product/i);
  });

  it('rejects a duplicate sku, an unknown category and a deactivated one', async () => {
    const client = await loginAs(baseline.users.admin.email);

    expect(
      (await client
        .post('/api/products')
        .send({ ...oneTime(master.categoryHardwareId), sku: 'HW-LAPTOP-ENT' })).status,
    ).toBe(409);

    expect((await client.post('/api/products').send(oneTime(UNKNOWN_ID))).status).toBe(404);

    await prisma.category.update({
      where: { id: master.categoryHardwareId },
      data: { active: false },
    });
    const response = await client.post('/api/products').send(oneTime(master.categoryHardwareId));
    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/deactivated/i);
  });

  it('rejects negative money, fractional paise and an out-of-range tax', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const base = oneTime(master.categoryHardwareId);

    for (const patch of [
      { basePrice: -1 },
      { costPrice: -1 },
      { basePrice: 1.005 },
      { taxPercent: 101 },
    ]) {
      const response = await client.post('/api/products').send({ ...base, ...patch });
      expect(response.status, JSON.stringify(patch)).toBe(400);
    }
  });

  it('permits cost above price, because a loss-making line must be representable', async () => {
    // The risk and margin engines need to see a negative margin, not be prevented
    // from recording one.
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .post('/api/products')
      .send({ ...oneTime(master.categoryHardwareId), basePrice: 100, costPrice: 150 });

    expect(response.status).toBe(201);
    expect(response.body.data.unitMargin).toBe('-50.00');
    expect(response.body.data.marginPercent).toBe('-50.000');
  });

  it('reports a null margin percentage for a zero-price product', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .post('/api/products')
      .send({ ...oneTime(master.categoryHardwareId), basePrice: 0, costPrice: 0 });

    expect(response.status).toBe(201);
    expect(response.body.data.marginPercent).toBeNull();
  });

  it('is refused to every non-admin role', async () => {
    for (const email of [
      baseline.users.rep.email,
      baseline.users.manager.email,
      baseline.users.finance.email,
    ]) {
      const client = await loginAs(email);
      const response = await client.post('/api/products').send(oneTime(master.categoryHardwareId));
      expect(response.status, email).toBe(403);
    }
    expect(await prisma.product.count()).toBe(4);
  });
});

describe('PATCH /api/products/:id', () => {
  it('changes a price and audits before and after', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .patch(`/api/products/${master.productLaptopId}`)
      .send({ basePrice: 85000 });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ basePrice: '85000.00', unitMargin: '25000.00' });

    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'Product', entityId: master.productLaptopId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.oldValue).toEqual({ basePrice: '80000.00' });
    expect(audit[0]!.newValue).toEqual({ basePrice: '85000.00' });
  });

  it('refuses to drop the plan from a recurring product', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .patch(`/api/products/${master.productSupportId}`)
      .send({ subscriptionPlanId: null });

    expect(response.status).toBe(422);
    const unchanged = await prisma.product.findUnique({ where: { id: master.productSupportId } });
    expect(unchanged!.subscriptionPlanId).toBe(master.planMonthlyId);
  });

  it('requires a plan when switching a product to recurring', async () => {
    const client = await loginAs(baseline.users.admin.email);

    const withoutPlan = await client
      .patch(`/api/products/${master.productSetupId}`)
      .send({ productType: 'RECURRING' });
    expect(withoutPlan.status).toBe(422);

    const withPlan = await client
      .patch(`/api/products/${master.productSetupId}`)
      .send({ productType: 'RECURRING', subscriptionPlanId: master.planMonthlyId });
    expect(withPlan.status).toBe(200);
    expect(withPlan.body.data.productType).toBe('RECURRING');
  });

  it('clears the plan when switching a recurring product to one-time', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .patch(`/api/products/${master.productSupportId}`)
      .send({ productType: 'ONE_TIME', subscriptionPlanId: null });

    expect(response.status).toBe(200);
    expect(response.body.data.subscriptionPlanId).toBeNull();
  });

  it('deactivates rather than deletes', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .patch(`/api/products/${master.productWarrantyId}`)
      .send({ active: false });

    expect(response.status).toBe(200);
    expect(response.body.data.active).toBe(false);
    expect(await prisma.product.count()).toBe(4);
  });
});

// ===========================================================================
// Product variants
// ===========================================================================

describe('product variants', () => {
  it('starts empty and reports the count on the product', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const { body } = await client.get(`/api/products/${master.productLaptopId}/variants`);
    expect(body.meta.total).toBe(0);
  });

  it('creates a variant and audits it', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .post(`/api/products/${master.productLaptopId}/variants`)
      .send({ attribute: 'Memory', value: '32 GB', extraPrice: 9000 });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      attribute: 'Memory',
      value: '32 GB',
      extraPrice: '9000.00',
      active: true,
    });

    const product = await client.get(`/api/products/${master.productLaptopId}`);
    expect(product.body.data.variantCount).toBe(1);
  });

  it('defaults extraPrice to zero and rejects a negative uplift', async () => {
    const client = await loginAs(baseline.users.admin.email);

    const free = await client
      .post(`/api/products/${master.productLaptopId}/variants`)
      .send({ attribute: 'Colour', value: 'Graphite' });
    expect(free.status).toBe(201);
    expect(free.body.data.extraPrice).toBe('0.00');

    const negative = await client
      .post(`/api/products/${master.productLaptopId}/variants`)
      .send({ attribute: 'Colour', value: 'Silver', extraPrice: -100 });
    expect(negative.status).toBe(400);
  });

  it('rejects a duplicate attribute/value pair', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const payload = { attribute: 'Memory', value: '32 GB' };

    expect((await client.post(`/api/products/${master.productLaptopId}/variants`).send(payload)).status).toBe(201);
    const duplicate = await client
      .post(`/api/products/${master.productLaptopId}/variants`)
      .send(payload);
    expect(duplicate.status).toBe(409);
  });

  it('returns 404 when the product does not exist', async () => {
    const client = await loginAs(baseline.users.admin.email);
    expect(
      (await client.post(`/api/products/${UNKNOWN_ID}/variants`).send({ attribute: 'A', value: 'B' }))
        .status,
    ).toBe(404);
    expect((await client.get(`/api/products/${UNKNOWN_ID}/variants`)).status).toBe(404);
  });

  it('will not reach a variant through the wrong product', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const created = await client
      .post(`/api/products/${master.productLaptopId}/variants`)
      .send({ attribute: 'Memory', value: '32 GB' });

    const wrongParent = await client
      .patch(`/api/products/${master.productSetupId}/variants/${created.body.data.id}`)
      .send({ extraPrice: 1 });

    expect(wrongParent.status).toBe(404);
  });

  it('updates the uplift and deactivates a variant', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const created = await client
      .post(`/api/products/${master.productLaptopId}/variants`)
      .send({ attribute: 'Memory', value: '64 GB', extraPrice: 18000 });

    const updated = await client
      .patch(`/api/products/${master.productLaptopId}/variants/${created.body.data.id}`)
      .send({ extraPrice: 17000, active: false });

    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ extraPrice: '17000.00', active: false });

    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'ProductVariant', entityId: created.body.data.id },
      orderBy: { createdAt: 'asc' },
    });
    // One row for the create, one for the update - history is append-only.
    expect(audit).toHaveLength(2);
    expect(audit[1]!.oldValue).toMatchObject({ extraPrice: '18000.00', active: true });
    expect(audit[1]!.newValue).toMatchObject({ extraPrice: '17000.00', active: false });
  });

  it('is refused to a rep', async () => {
    const client = await loginAs(baseline.users.rep.email);
    expect(
      (await client
        .post(`/api/products/${master.productLaptopId}/variants`)
        .send({ attribute: 'A', value: 'B' })).status,
    ).toBe(403);
  });
});

// ===========================================================================
// Database backstops
// ===========================================================================

describe('catalogue constraints as a backstop', () => {
  it('refuses a recurring product without a plan even through raw SQL', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE products SET subscription_plan_id = NULL WHERE id = '${master.productSupportId}'`,
      ),
    ).rejects.toThrow(/products_recurring_requires_plan_check/);
  });

  it('refuses a negative variant uplift even through raw SQL', async () => {
    const variant = await prisma.productVariant.create({
      data: { productId: master.productLaptopId, attribute: 'Memory', value: '32 GB' },
    });

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE product_variants SET extra_price = -1 WHERE id = '${variant.id}'`,
      ),
    ).rejects.toThrow(/product_variants_extra_price_nonneg_check/);
  });

  it('refuses a negative base price even through raw SQL', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE products SET base_price = -1 WHERE id = '${master.productLaptopId}'`,
      ),
    ).rejects.toThrow(/products_price_nonneg_check/);
  });
});

describe('unauthenticated access', () => {
  it('is refused on every catalogue route', async () => {
    for (const path of ['/api/categories', '/api/products', `/api/products/${master.productLaptopId}`]) {
      expect((await request().get(path)).status, path).toBe(401);
    }
  });
});
