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
// Warehouses
// ===========================================================================

describe('GET /api/warehouses', () => {
  it('lists warehouses cheapest-to-ship first', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const { status, body } = await client.get('/api/warehouses');

    expect(status).toBe(200);
    expect(body.meta).toEqual({ total: 2, limit: 50, offset: 0 });
    // Ordered by shippingWeight, so the allocation engine's preferred origin leads.
    expect(body.data.map((row: { code: string }) => row.code)).toEqual(['MAIN', 'EAST']);
    expect(body.data[0]).toMatchObject({
      name: 'Main Warehouse',
      shippingWeight: '1.0000',
      stockedProductCount: 1,
      active: true,
    });
  });

  it('is readable by every internal role and by no customer', async () => {
    for (const email of [
      baseline.users.admin.email,
      baseline.users.rep.email,
      baseline.users.manager.email,
      baseline.users.finance.email,
    ]) {
      const client = await loginAs(email);
      expect((await client.get('/api/warehouses')).status, email).toBe(200);
    }

    const portal = await loginAs(baseline.users.acmeBuyer.email, 'portal');
    expect((await portal.get('/api/warehouses')).status).toBe(403);
  });

  it('requires authentication', async () => {
    expect((await request().get('/api/warehouses')).status).toBe(401);
  });
});

describe('POST /api/warehouses', () => {
  const payload = { code: 'west', name: 'West Hub', shippingWeight: 2.25 };

  it('lets finance create a warehouse and audits it', async () => {
    // docs/RBAC.md gives warehouse configuration to Admin and Finance/Operations.
    const client = await loginAs(baseline.users.finance.email);
    const response = await client.post('/api/warehouses').send(payload);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      code: 'WEST',
      name: 'West Hub',
      shippingWeight: '2.2500',
      stockedProductCount: 0,
    });

    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'Warehouse', entityId: response.body.data.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'CONFIGURATION_CHANGED',
      actorUserId: baseline.users.finance.id,
      actorRole: 'FINANCE_OPERATIONS',
    });
  });

  it('lets an admin create one too, and defaults the shipping weight to 1', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.post('/api/warehouses').send({ code: 'north', name: 'North' });

    expect(response.status).toBe(201);
    expect(response.body.data.shippingWeight).toBe('1.0000');
  });

  it('rejects a duplicate code', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const response = await client.post('/api/warehouses').send({ code: 'MAIN', name: 'Clash' });

    expect(response.status).toBe(409);
    expect(await prisma.warehouse.count()).toBe(2);
  });

  it('rejects a zero or negative shipping weight, which would break the allocation objective', async () => {
    const client = await loginAs(baseline.users.finance.email);

    for (const shippingWeight of [0, -1]) {
      const response = await client
        .post('/api/warehouses')
        .send({ code: `W${Math.abs(shippingWeight)}`, name: 'W', shippingWeight });
      expect(response.status, String(shippingWeight)).toBe(400);
    }
  });

  it('is refused to a rep and to a sales manager', async () => {
    for (const email of [baseline.users.rep.email, baseline.users.manager.email]) {
      const client = await loginAs(email);
      expect((await client.post('/api/warehouses').send(payload)).status, email).toBe(403);
    }
    expect(await prisma.warehouse.count()).toBe(2);
  });
});

describe('PATCH /api/warehouses/:id', () => {
  it('changes the shipping weight and audits before and after', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const response = await client
      .patch(`/api/warehouses/${master.warehouseEastId}`)
      .send({ shippingWeight: 1.4 });

    expect(response.status).toBe(200);
    expect(response.body.data.shippingWeight).toBe('1.4000');

    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'Warehouse', entityId: master.warehouseEastId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.oldValue).toEqual({ shippingWeight: '1.6000' });
    expect(audit[0]!.newValue).toEqual({ shippingWeight: '1.4000' });
  });

  it('deactivates rather than deletes, so allocation history survives', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const response = await client
      .patch(`/api/warehouses/${master.warehouseEastId}`)
      .send({ active: false });

    expect(response.status).toBe(200);
    expect(response.body.data.active).toBe(false);
    expect(await prisma.warehouse.count()).toBe(2);
  });

  it('rejects an empty patch, an unknown field, an unknown id and a malformed id', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const base = `/api/warehouses/${master.warehouseMainId}`;

    expect((await client.patch(base).send({})).status).toBe(400);
    expect((await client.patch(base).send({ code: 'RENAMED' })).status).toBe(400);
    expect((await client.patch(`/api/warehouses/${UNKNOWN_ID}`).send({ name: 'x' })).status).toBe(404);
    expect((await client.patch('/api/warehouses/nope').send({ name: 'x' })).status).toBe(400);
  });

  it('writes no audit row for a no-op patch', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const response = await client
      .patch(`/api/warehouses/${master.warehouseMainId}`)
      .send({ name: 'Main Warehouse' });

    expect(response.status).toBe(200);
    expect(
      await prisma.auditLog.count({
        where: { entityType: 'Warehouse', entityId: master.warehouseMainId },
      }),
    ).toBe(0);
  });
});

// ===========================================================================
// Inventory - Option A semantics
//   availableQuantity = free to allocate
//   reservedQuantity  = already committed to a fulfillment
//   physicalQuantity  = available + reserved
// ===========================================================================

describe('GET /api/warehouses/:id/inventory', () => {
  it('reports available, reserved and physical stock separately', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const { status, body } = await client.get(`/api/warehouses/${master.warehouseMainId}/inventory`);

    expect(status).toBe(200);
    expect(body.meta.total).toBe(1);
    expect(body.data[0]).toMatchObject({
      sku: 'HW-LAPTOP-ENT',
      productName: 'Enterprise Laptop',
      unit: 'unit',
      availableQuantity: 12,
      reservedQuantity: 0,
      physicalQuantity: 12,
      reorderPoint: 5,
      belowReorderPoint: false,
    });
  });

  it('adds reserved to available when reporting physical stock', async () => {
    // Reservation is the fulfillment engine's job; simulated directly here so the
    // reporting contract is pinned before that slice exists.
    await prisma.inventory.update({
      where: {
        warehouseId_productId: {
          warehouseId: master.warehouseMainId,
          productId: master.productLaptopId,
        },
      },
      data: { availableQuantity: 8, reservedQuantity: 4 },
    });

    const client = await loginAs(baseline.users.rep.email);
    const { body } = await client.get(`/api/warehouses/${master.warehouseMainId}/inventory`);

    expect(body.data[0]).toMatchObject({
      availableQuantity: 8,
      reservedQuantity: 4,
      physicalQuantity: 12,
    });
  });

  it('flags stock below its reorder point', async () => {
    await prisma.inventory.update({
      where: {
        warehouseId_productId: {
          warehouseId: master.warehouseMainId,
          productId: master.productLaptopId,
        },
      },
      data: { availableQuantity: 4 },
    });

    const client = await loginAs(baseline.users.finance.email);
    const { body } = await client.get(`/api/warehouses/${master.warehouseMainId}/inventory`);

    expect(body.data[0]).toMatchObject({ availableQuantity: 4, belowReorderPoint: true });
  });

  it('searches by product sku and name', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const base = `/api/warehouses/${master.warehouseMainId}/inventory`;

    expect((await client.get(`${base}?q=laptop`)).body.meta.total).toBe(1);
    expect((await client.get(`${base}?q=HW-LAPTOP`)).body.meta.total).toBe(1);
    expect((await client.get(`${base}?q=nothing`)).body.meta.total).toBe(0);
  });

  it('returns 404 for an unknown warehouse', async () => {
    const client = await loginAs(baseline.users.rep.email);
    expect((await client.get(`/api/warehouses/${UNKNOWN_ID}/inventory`)).status).toBe(404);
  });

  it('is not reachable by a customer session', async () => {
    const client = await loginAs(baseline.users.acmeBuyer.email, 'portal');
    expect(
      (await client.get(`/api/warehouses/${master.warehouseMainId}/inventory`)).status,
    ).toBe(403);
  });
});

describe('PATCH /api/warehouses/:id/inventory/:productId', () => {
  const path = (warehouseId: string, productId: string) =>
    `/api/warehouses/${warehouseId}/inventory/${productId}`;

  it('sets available stock absolutely and audits the correction', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const response = await client
      .patch(path(master.warehouseMainId, master.productLaptopId))
      .send({ availableQuantity: 15, reason: 'Stock count correction' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ availableQuantity: 15, physicalQuantity: 15 });

    const audit = await prisma.auditLog.findMany({
      where: {
        entityType: 'Inventory',
        entityId: `${master.warehouseMainId}:${master.productLaptopId}`,
      },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.oldValue).toMatchObject({ availableQuantity: 12 });
    expect(audit[0]!.newValue).toMatchObject({ availableQuantity: 15 });
    expect(audit[0]!.reason).toBe('Stock count correction');
  });

  it('creates the inventory row when a product has never been stocked here', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const response = await client
      .patch(path(master.warehouseMainId, master.productWarrantyId))
      .send({ availableQuantity: 30, reorderPoint: 10 });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      sku: 'SV-WARRANTY-EXT',
      availableQuantity: 30,
      reservedQuantity: 0,
      reorderPoint: 10,
    });

    expect(await prisma.inventory.count({ where: { warehouseId: master.warehouseMainId } })).toBe(2);
  });

  it('updates only the reorder point when that is all that was sent', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const response = await client
      .patch(path(master.warehouseMainId, master.productLaptopId))
      .send({ reorderPoint: 9 });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ availableQuantity: 12, reorderPoint: 9 });
  });

  it('leaves reserved stock untouched, since it is already committed', async () => {
    await prisma.inventory.update({
      where: {
        warehouseId_productId: {
          warehouseId: master.warehouseMainId,
          productId: master.productLaptopId,
        },
      },
      data: { reservedQuantity: 5 },
    });

    const client = await loginAs(baseline.users.finance.email);
    const response = await client
      .patch(path(master.warehouseMainId, master.productLaptopId))
      .send({ availableQuantity: 20 });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      availableQuantity: 20,
      reservedQuantity: 5,
      physicalQuantity: 25,
    });
  });

  it('refuses to let configuration set reserved stock at all', async () => {
    // Editing reserved would let the same unit be promised to two fulfillments.
    const client = await loginAs(baseline.users.finance.email);
    const response = await client
      .patch(path(master.warehouseMainId, master.productLaptopId))
      .send({ reservedQuantity: 99 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');

    const row = await prisma.inventory.findUnique({
      where: {
        warehouseId_productId: {
          warehouseId: master.warehouseMainId,
          productId: master.productLaptopId,
        },
      },
    });
    expect(row!.reservedQuantity).toBe(0);
  });

  it('rejects an empty body, a negative quantity and a fractional one', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const target = path(master.warehouseMainId, master.productLaptopId);

    expect((await client.patch(target).send({})).status).toBe(400);
    expect((await client.patch(target).send({ availableQuantity: -1 })).status).toBe(400);
    expect((await client.patch(target).send({ availableQuantity: 1.5 })).status).toBe(400);
  });

  it('accepts zero, which is how stock is emptied', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const response = await client
      .patch(path(master.warehouseMainId, master.productLaptopId))
      .send({ availableQuantity: 0 });

    expect(response.status).toBe(200);
    expect(response.body.data.availableQuantity).toBe(0);
  });

  it('returns 404 for an unknown warehouse or product', async () => {
    const client = await loginAs(baseline.users.finance.email);

    expect(
      (await client.patch(path(UNKNOWN_ID, master.productLaptopId)).send({ availableQuantity: 1 }))
        .status,
    ).toBe(404);
    expect(
      (await client.patch(path(master.warehouseMainId, UNKNOWN_ID)).send({ availableQuantity: 1 }))
        .status,
    ).toBe(404);
  });

  it('is refused to a rep and to a sales manager', async () => {
    for (const email of [baseline.users.rep.email, baseline.users.manager.email]) {
      const client = await loginAs(email);
      const response = await client
        .patch(path(master.warehouseMainId, master.productLaptopId))
        .send({ availableQuantity: 999 });
      expect(response.status, email).toBe(403);
    }

    const row = await prisma.inventory.findUnique({
      where: {
        warehouseId_productId: {
          warehouseId: master.warehouseMainId,
          productId: master.productLaptopId,
        },
      },
    });
    expect(row!.availableQuantity).toBe(12);
  });
});

describe('POST /api/warehouses/:id/inventory/:productId/receive', () => {
  const path = (warehouseId: string, productId: string) =>
    `/api/warehouses/${warehouseId}/inventory/${productId}/receive`;

  it('increments available stock and records the arrival', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const response = await client
      .post(path(master.warehouseMainId, master.productLaptopId))
      .send({ quantity: 8, reference: 'GRN-4471' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ availableQuantity: 20, physicalQuantity: 20 });

    const audit = await prisma.auditLog.findMany({
      where: {
        entityType: 'Inventory',
        entityId: `${master.warehouseMainId}:${master.productLaptopId}`,
      },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.oldValue).toMatchObject({ availableQuantity: 12 });
    expect(audit[0]!.newValue).toMatchObject({ availableQuantity: 20, received: 8 });
    expect(audit[0]!.reason).toBe('Stock arrival GRN-4471');
  });

  it('is a relative increment, so concurrent arrivals both land', async () => {
    // The whole point of receive-versus-set: two read-modify-write updates would
    // lose one increment, an atomic increment cannot.
    const client = await loginAs(baseline.users.finance.email);
    const target = path(master.warehouseMainId, master.productLaptopId);

    await Promise.all([
      client.post(target).send({ quantity: 5 }),
      client.post(target).send({ quantity: 7 }),
    ]);

    const row = await prisma.inventory.findUnique({
      where: {
        warehouseId_productId: {
          warehouseId: master.warehouseMainId,
          productId: master.productLaptopId,
        },
      },
    });
    expect(row!.availableQuantity).toBe(24);
  });

  it('creates the row when receiving a product not yet stocked here', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const response = await client
      .post(path(master.warehouseEastId, master.productSetupId))
      .send({ quantity: 3 });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ sku: 'SV-SETUP', availableQuantity: 3 });
  });

  it('does not disturb reserved stock', async () => {
    await prisma.inventory.update({
      where: {
        warehouseId_productId: {
          warehouseId: master.warehouseMainId,
          productId: master.productLaptopId,
        },
      },
      data: { availableQuantity: 2, reservedQuantity: 10 },
    });

    const client = await loginAs(baseline.users.finance.email);
    const response = await client
      .post(path(master.warehouseMainId, master.productLaptopId))
      .send({ quantity: 6 });

    expect(response.body.data).toMatchObject({
      availableQuantity: 8,
      reservedQuantity: 10,
      physicalQuantity: 18,
    });
  });

  it('rejects a zero, negative or fractional quantity', async () => {
    const client = await loginAs(baseline.users.finance.email);
    const target = path(master.warehouseMainId, master.productLaptopId);

    for (const quantity of [0, -5, 1.5]) {
      expect((await client.post(target).send({ quantity })).status, String(quantity)).toBe(400);
    }
  });

  it('returns 404 for an unknown warehouse or product', async () => {
    const client = await loginAs(baseline.users.finance.email);

    expect((await client.post(path(UNKNOWN_ID, master.productLaptopId)).send({ quantity: 1 })).status).toBe(404);
    expect((await client.post(path(master.warehouseMainId, UNKNOWN_ID)).send({ quantity: 1 })).status).toBe(404);
  });

  it('is refused to a rep', async () => {
    const client = await loginAs(baseline.users.rep.email);
    expect(
      (await client.post(path(master.warehouseMainId, master.productLaptopId)).send({ quantity: 1 }))
        .status,
    ).toBe(403);
  });
});

// ===========================================================================
// Database backstops
// ===========================================================================

describe('inventory constraints as a backstop', () => {
  it('refuses negative available or reserved stock even through raw SQL', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE inventory SET available_quantity = -1 WHERE warehouse_id = '${master.warehouseMainId}'`,
      ),
    ).rejects.toThrow(/inventory_quantities_nonneg_check/);

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE inventory SET reserved_quantity = -1 WHERE warehouse_id = '${master.warehouseMainId}'`,
      ),
    ).rejects.toThrow(/inventory_quantities_nonneg_check/);
  });

  it('refuses a non-positive shipping weight even through raw SQL', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE warehouses SET shipping_weight = 0 WHERE id = '${master.warehouseMainId}'`,
      ),
    ).rejects.toThrow(/warehouses_shipping_weight_positive_check/);
  });

  it('keeps one inventory row per warehouse and product', async () => {
    await expect(
      prisma.inventory.create({
        data: {
          warehouseId: master.warehouseMainId,
          productId: master.productLaptopId,
          availableQuantity: 1,
        },
      }),
    ).rejects.toThrow();
  });
});
