import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma';
import { AuditAction } from '../../src/modules/audit/auditService';
import { loginAs, request } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { seedBaseline, seedMasterData, type Baseline, type MasterData } from '../helpers/fixtures';
import type TestAgent from 'supertest/lib/agent';

let baseline: Baseline;
let master: MasterData;
let rep: TestAgent;
let quotationId: string;

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

beforeEach(async () => {
  await resetDatabase();
  baseline = await seedBaseline();
  master = await seedMasterData(baseline);

  rep = await loginAs(baseline.users.rep.email);
  const created = await rep.post('/api/quotations').send({ customerId: baseline.acmeId });
  quotationId = created.body.data.id as string;
});

/** Current version, so a test never hardcodes one and drifts. */
async function currentVersion(): Promise<number> {
  const response = await rep.get(`/api/quotations/${quotationId}`);
  return response.body.data.version as number;
}

async function addLine(body: Record<string, unknown>) {
  return rep.post(`/api/quotations/${quotationId}/lines`).send({ version: await currentVersion(), ...body });
}

// ===========================================================================
// Adding lines
// ===========================================================================

describe('POST /api/quotations/:id/lines', () => {
  it('adds a line, snapshotting price, cost and tax from the catalogue', async () => {
    const response = await addLine({ productId: master.productLaptopId, quantity: 2 });

    expect(response.status).toBe(201);
    const line = response.body.data.lines[0];
    expect(line).toMatchObject({
      sku: 'HW-LAPTOP-ENT',
      quantity: 2,
      // Gold price list holds the laptop at base price.
      unitPrice: '80000.00',
      unitCost: '60000.00',
      taxPercent: '18.000',
      discountPercent: '0.000',
      lineType: 'ONE_TIME',
      position: 1,
    });
  });

  it('computes the line and quotation figures', async () => {
    const response = await addLine({ productId: master.productLaptopId, quantity: 2 });
    const { data } = response.body;

    expect(data.lines[0]).toMatchObject({
      lineSubtotal: '160000.00',
      lineDiscount: '0.00',
      lineTax: '28800.00',
      lineTotal: '188800.00',
      margin: '40000.00',
    });
    expect(data).toMatchObject({
      subtotal: '160000.00',
      taxTotal: '28800.00',
      grandTotal: '188800.00',
      estimatedCost: '120000.00',
      margin: '40000.00',
    });
  });

  it('bumps the version, because adding a line is a material change', async () => {
    const response = await addLine({ productId: master.productLaptopId, quantity: 1 });
    expect(response.body.data.version).toBe(2);
  });

  it('falls back to base price when no price-list entry exists', async () => {
    // The seeded Gold list holds the laptop and setup service, not the warranty.
    const response = await addLine({ productId: master.productWarrantyId, quantity: 1 });
    expect(response.body.data.lines[0]).toMatchObject({
      sku: 'SV-WARRANTY-EXT',
      unitPrice: '7500.00',
    });
  });

  it('adds the variant uplift to the resolved price', async () => {
    const admin = await loginAs(baseline.users.admin.email);
    const variant = await admin
      .post(`/api/products/${master.productLaptopId}/variants`)
      .send({ attribute: 'Memory', value: '32 GB', extraPrice: 9000 });

    const response = await addLine({
      productId: master.productLaptopId,
      variantId: variant.body.data.id,
      quantity: 1,
    });

    expect(response.body.data.lines[0]).toMatchObject({
      unitPrice: '89000.00',
      variantLabel: 'Memory: 32 GB',
    });
  });

  it('carries the subscription plan onto a recurring line', async () => {
    const response = await addLine({ productId: master.productSupportId, quantity: 20 });

    expect(response.body.data.lines[0]).toMatchObject({
      sku: 'SB-SUPPORT-PREM',
      lineType: 'RECURRING',
      subscriptionPlanName: 'Premium Monthly',
    });
    expect(response.body.data.lines[0].subscriptionPlanId).toBe(master.planMonthlyId);
  });

  it('appends successive lines at increasing positions', async () => {
    await addLine({ productId: master.productLaptopId, quantity: 1 });
    await addLine({ productId: master.productSetupId, quantity: 1 });
    const response = await addLine({ productId: master.productWarrantyId, quantity: 1 });

    expect(response.body.data.lines.map((line: { position: number }) => line.position)).toEqual([1, 2, 3]);
  });

  it('merges into the existing line when product, variant and discount all match', async () => {
    await addLine({ productId: master.productLaptopId, quantity: 2 });
    const response = await addLine({ productId: master.productLaptopId, quantity: 3 });

    // Two lines for the same product on identical terms are one commercial fact;
    // duplicating would double-count in fulfillment and billing.
    expect(response.body.data.lines).toHaveLength(1);
    expect(response.body.data.lines[0]).toMatchObject({ quantity: 5, lineSubtotal: '400000.00' });
  });

  it('keeps a separate line when the discount differs', async () => {
    await addLine({ productId: master.productLaptopId, quantity: 2 });
    const response = await addLine({
      productId: master.productLaptopId,
      quantity: 2,
      discountPercent: 5,
    });

    expect(response.body.data.lines).toHaveLength(2);
  });

  it('keeps a separate line when the variant differs', async () => {
    const admin = await loginAs(baseline.users.admin.email);
    const variant = await admin
      .post(`/api/products/${master.productLaptopId}/variants`)
      .send({ attribute: 'Memory', value: '64 GB', extraPrice: 18000 });

    await addLine({ productId: master.productLaptopId, quantity: 1 });
    const response = await addLine({
      productId: master.productLaptopId,
      variantId: variant.body.data.id,
      quantity: 1,
    });

    expect(response.body.data.lines).toHaveLength(2);
  });

  it('audits the addition and the merge distinctly', async () => {
    await addLine({ productId: master.productLaptopId, quantity: 1 });
    await addLine({ productId: master.productLaptopId, quantity: 1 });

    const audit = await prisma.auditLog.findMany({
      where: { action: AuditAction.QUOTATION_LINE_ADDED },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit).toHaveLength(2);
    expect(audit[0]!.reason).toBeNull();
    expect(audit[1]!.reason).toMatch(/merged/i);
  });

  it('rejects an unknown product, an inactive product and a deactivated variant', async () => {
    expect((await addLine({ productId: UNKNOWN_ID, quantity: 1 })).status).toBe(404);

    const admin = await loginAs(baseline.users.admin.email);
    await admin.patch(`/api/products/${master.productWarrantyId}`).send({ active: false });
    const inactive = await addLine({ productId: master.productWarrantyId, quantity: 1 });
    expect(inactive.status).toBe(409);
    expect(inactive.body.error.message).toMatch(/deactivated/i);

    const variant = await admin
      .post(`/api/products/${master.productLaptopId}/variants`)
      .send({ attribute: 'Colour', value: 'Graphite' });
    await admin
      .patch(`/api/products/${master.productLaptopId}/variants/${variant.body.data.id}`)
      .send({ active: false });
    const deactivatedVariant = await addLine({
      productId: master.productLaptopId,
      variantId: variant.body.data.id,
      quantity: 1,
    });
    expect(deactivatedVariant.status).toBe(409);
  });

  it('refuses a variant belonging to another product', async () => {
    const admin = await loginAs(baseline.users.admin.email);
    const variant = await admin
      .post(`/api/products/${master.productLaptopId}/variants`)
      .send({ attribute: 'Memory', value: '32 GB' });

    const response = await addLine({
      productId: master.productSetupId,
      variantId: variant.body.data.id,
      quantity: 1,
    });

    expect(response.status).toBe(404);
    expect(response.body.error.message).toMatch(/variant not found/i);
  });

  it('rejects an invalid quantity, an invalid discount and a client-supplied price', async () => {
    for (const body of [
      { productId: master.productLaptopId, quantity: 0 },
      { productId: master.productLaptopId, quantity: -1 },
      { productId: master.productLaptopId, quantity: 1.5 },
      { productId: master.productLaptopId, quantity: 1, discountPercent: -1 },
      { productId: master.productLaptopId, quantity: 1, discountPercent: 101 },
      { productId: master.productLaptopId, quantity: 1, discountPercent: 1.2345 },
      // Authoritative figures must be refused, not ignored.
      { productId: master.productLaptopId, quantity: 1, unitPrice: 1 },
      { productId: master.productLaptopId, quantity: 1, unitCost: 1 },
      { productId: master.productLaptopId, quantity: 1, lineTotal: 1 },
      { productId: master.productLaptopId, quantity: 1, taxPercent: 0 },
      { productId: master.productLaptopId, quantity: 1, margin: 999 },
    ]) {
      const response = await addLine(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }

    expect(await prisma.quotationLine.count()).toBe(0);
  });

  it('rejects a stale version and writes nothing', async () => {
    await addLine({ productId: master.productLaptopId, quantity: 1 });

    const stale = await rep
      .post(`/api/quotations/${quotationId}/lines`)
      .send({ version: 1, productId: master.productSetupId, quantity: 1 });

    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(await prisma.quotationLine.count()).toBe(1);
  });

  it('is refused to a manager, to a customer and to an anonymous caller', async () => {
    const manager = await loginAs(baseline.users.manager.email);
    expect(
      (await manager
        .post(`/api/quotations/${quotationId}/lines`)
        .send({ version: 1, productId: master.productLaptopId, quantity: 1 })).status,
    ).toBe(403);

    const portal = await loginAs(baseline.users.acmeBuyer.email, 'portal');
    expect(
      (await portal
        .post(`/api/quotations/${quotationId}/lines`)
        .send({ version: 1, productId: master.productLaptopId, quantity: 1 })).status,
    ).toBe(403);

    expect(
      (await request()
        .post(`/api/quotations/${quotationId}/lines`)
        .send({ version: 1, productId: master.productLaptopId, quantity: 1 })).status,
    ).toBe(401);

    expect(await prisma.quotationLine.count()).toBe(0);
  });
});

// ===========================================================================
// Updating lines
// ===========================================================================

describe('PATCH /api/quotations/:id/lines/:lineId', () => {
  async function seedLine(): Promise<string> {
    const response = await addLine({ productId: master.productLaptopId, quantity: 2 });
    return response.body.data.lines[0].id as string;
  }

  it('changes the quantity and recalculates', async () => {
    const lineId = await seedLine();
    const response = await rep
      .patch(`/api/quotations/${quotationId}/lines/${lineId}`)
      .send({ version: await currentVersion(), quantity: 5 });

    expect(response.status).toBe(200);
    expect(response.body.data.lines[0]).toMatchObject({
      quantity: 5,
      lineSubtotal: '400000.00',
      lineTotal: '472000.00',
    });
    expect(response.body.data.grandTotal).toBe('472000.00');
  });

  it('applies a line discount and recalculates tax on the discounted net', async () => {
    const lineId = await seedLine();
    const response = await rep
      .patch(`/api/quotations/${quotationId}/lines/${lineId}`)
      .send({ version: await currentVersion(), discountPercent: 12 });

    expect(response.status).toBe(200);
    expect(response.body.data.lines[0]).toMatchObject({
      discountPercent: '12.000',
      lineSubtotal: '160000.00',
      lineDiscount: '19200.00',
      // 140,800 net taxed at 18%
      lineTax: '25344.00',
      lineTotal: '166144.00',
    });
  });

  it('bumps the version on every material change', async () => {
    const lineId = await seedLine();
    const before = await currentVersion();

    const response = await rep
      .patch(`/api/quotations/${quotationId}/lines/${lineId}`)
      .send({ version: before, quantity: 3 });

    expect(response.body.data.version).toBe(before + 1);
  });

  it('re-resolves the price when the variant changes', async () => {
    const lineId = await seedLine();
    const admin = await loginAs(baseline.users.admin.email);
    const variant = await admin
      .post(`/api/products/${master.productLaptopId}/variants`)
      .send({ attribute: 'Memory', value: '32 GB', extraPrice: 9000 });

    const response = await rep
      .patch(`/api/quotations/${quotationId}/lines/${lineId}`)
      .send({ version: await currentVersion(), variantId: variant.body.data.id });

    expect(response.status).toBe(200);
    expect(response.body.data.lines[0]).toMatchObject({ unitPrice: '89000.00' });
  });

  it('clears a variant with an explicit null and restores the base price', async () => {
    const admin = await loginAs(baseline.users.admin.email);
    const variant = await admin
      .post(`/api/products/${master.productLaptopId}/variants`)
      .send({ attribute: 'Memory', value: '32 GB', extraPrice: 9000 });

    const added = await addLine({
      productId: master.productLaptopId,
      variantId: variant.body.data.id,
      quantity: 1,
    });
    const lineId = added.body.data.lines[0].id as string;

    const response = await rep
      .patch(`/api/quotations/${quotationId}/lines/${lineId}`)
      .send({ version: await currentVersion(), variantId: null });

    expect(response.status).toBe(200);
    expect(response.body.data.lines[0]).toMatchObject({ unitPrice: '80000.00', variantId: null });
  });

  it('audits a discount change as DISCOUNT_CHANGED with old and new values', async () => {
    const lineId = await seedLine();
    await rep
      .patch(`/api/quotations/${quotationId}/lines/${lineId}`)
      .send({ version: await currentVersion(), discountPercent: 8 });

    const audit = await prisma.auditLog.findMany({
      where: { entityId: lineId, action: AuditAction.DISCOUNT_CHANGED },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.oldValue).toEqual({ discountPercent: '0.000' });
    expect(audit[0]!.newValue).toEqual({ discountPercent: '8.000' });
  });

  it('writes no audit row and does not bump the version for a no-op patch', async () => {
    const lineId = await seedLine();
    const before = await currentVersion();

    const response = await rep
      .patch(`/api/quotations/${quotationId}/lines/${lineId}`)
      .send({ version: before, quantity: 2 });

    expect(response.status).toBe(200);
    expect(response.body.data.version).toBe(before);
    expect(
      await prisma.auditLog.count({
        where: { entityId: lineId, action: AuditAction.QUOTATION_EDITED },
      }),
    ).toBe(0);
  });

  it('returns 404 for a line belonging to another quotation', async () => {
    const lineId = await seedLine();
    const other = await rep.post('/api/quotations').send({ customerId: baseline.globexId });

    const response = await rep
      .patch(`/api/quotations/${other.body.data.id}/lines/${lineId}`)
      .send({ version: 1, quantity: 3 });

    expect(response.status).toBe(404);
  });

  it('rejects an unknown line, a stale version and an empty patch', async () => {
    const lineId = await seedLine();
    const version = await currentVersion();

    expect(
      (await rep
        .patch(`/api/quotations/${quotationId}/lines/${UNKNOWN_ID}`)
        .send({ version, quantity: 1 })).status,
    ).toBe(404);

    expect(
      (await rep.patch(`/api/quotations/${quotationId}/lines/${lineId}`).send({ version: 1, quantity: 9 }))
        .status,
    ).toBe(409);

    expect(
      (await rep.patch(`/api/quotations/${quotationId}/lines/${lineId}`).send({ version })).status,
    ).toBe(400);
  });
});

// ===========================================================================
// Removing lines
// ===========================================================================

describe('DELETE /api/quotations/:id/lines/:lineId', () => {
  it('removes the line, recalculates and bumps the version', async () => {
    await addLine({ productId: master.productLaptopId, quantity: 2 });
    const second = await addLine({ productId: master.productSetupId, quantity: 5 });
    const lineId = second.body.data.lines.find((line: { sku: string }) => line.sku === 'SV-SETUP').id;

    const response = await rep
      .delete(`/api/quotations/${quotationId}/lines/${lineId}`)
      .send({ version: await currentVersion() });

    expect(response.status).toBe(200);
    expect(response.body.data.lines).toHaveLength(1);
    expect(response.body.data.subtotal).toBe('160000.00');
    expect(response.body.data.version).toBe(4);
  });

  it('zeroes the totals when the last line goes', async () => {
    const added = await addLine({ productId: master.productLaptopId, quantity: 1 });
    const lineId = added.body.data.lines[0].id as string;

    const response = await rep
      .delete(`/api/quotations/${quotationId}/lines/${lineId}`)
      .send({ version: await currentVersion() });

    expect(response.body.data).toMatchObject({
      lineCount: 0,
      subtotal: '0.00',
      taxTotal: '0.00',
      grandTotal: '0.00',
      estimatedCost: '0.00',
      margin: '0.00',
    });
  });

  it('records what was removed, so the deletion is explicable', async () => {
    const added = await addLine({ productId: master.productLaptopId, quantity: 3 });
    const lineId = added.body.data.lines[0].id as string;

    await rep
      .delete(`/api/quotations/${quotationId}/lines/${lineId}`)
      .send({ version: await currentVersion() });

    const audit = await prisma.auditLog.findMany({
      where: { entityId: lineId, action: AuditAction.QUOTATION_LINE_REMOVED },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.oldValue).toMatchObject({
      sku: 'HW-LAPTOP-ENT',
      quantity: 3,
      unitPrice: '80000.00',
    });
    expect(audit[0]!.newValue).toBeNull();
  });

  it('leaves remaining positions alone and appends above the highest', async () => {
    // Positions are a sparse ordering key; renumbering would risk colliding with
    // the (quotationId, position) unique index.
    await addLine({ productId: master.productLaptopId, quantity: 1 });
    const second = await addLine({ productId: master.productSetupId, quantity: 1 });
    const firstLineId = second.body.data.lines.find(
      (line: { sku: string }) => line.sku === 'HW-LAPTOP-ENT',
    ).id;

    await rep
      .delete(`/api/quotations/${quotationId}/lines/${firstLineId}`)
      .send({ version: await currentVersion() });

    const response = await addLine({ productId: master.productWarrantyId, quantity: 1 });
    const positions = response.body.data.lines.map((line: { position: number }) => line.position);
    expect(positions).toEqual([2, 3]);
  });

  it('rejects a stale version, an unknown line and a missing version', async () => {
    const added = await addLine({ productId: master.productLaptopId, quantity: 1 });
    const lineId = added.body.data.lines[0].id as string;

    expect(
      (await rep.delete(`/api/quotations/${quotationId}/lines/${lineId}`).send({ version: 1 })).status,
    ).toBe(409);
    expect(
      (await rep
        .delete(`/api/quotations/${quotationId}/lines/${UNKNOWN_ID}`)
        .send({ version: await currentVersion() })).status,
    ).toBe(404);
    expect((await rep.delete(`/api/quotations/${quotationId}/lines/${lineId}`).send({})).status).toBe(400);
    expect(await prisma.quotationLine.count()).toBe(1);
  });
});

// ===========================================================================
// Whole-quotation arithmetic through the API
// ===========================================================================

describe('order-level discount across lines', () => {
  it('allocates the order discount and keeps grandTotal equal to the sum of lines', async () => {
    await addLine({ productId: master.productLaptopId, quantity: 20, discountPercent: 12 });
    await addLine({ productId: master.productSetupId, quantity: 5, discountPercent: 18 });
    await addLine({ productId: master.productSupportId, quantity: 20 });

    const response = await rep
      .patch(`/api/quotations/${quotationId}`)
      .send({ version: await currentVersion(), orderDiscountPercent: 2.5 });

    expect(response.status).toBe(200);
    const { data } = response.body;

    const summedTotals = data.lines.reduce(
      (sum: number, line: { lineTotal: string }) => sum + Number(line.lineTotal),
      0,
    );
    expect(Number(data.grandTotal)).toBeCloseTo(summedTotals, 2);

    const summedDiscount = data.lines.reduce(
      (sum: number, line: { lineDiscount: string }) => sum + Number(line.lineDiscount),
      0,
    );
    expect(Number(data.discountTotal)).toBeCloseTo(summedDiscount, 2);
  });

  it('produces the documented canonical figures with no order discount', async () => {
    // docs/SEED_DATA.md canonical quote.
    await addLine({ productId: master.productLaptopId, quantity: 20, discountPercent: 12 });
    await addLine({ productId: master.productSetupId, quantity: 5, discountPercent: 18 });
    const response = await addLine({ productId: master.productSupportId, quantity: 20 });

    expect(response.body.data).toMatchObject({
      subtotal: '1750000.00',
      discountTotal: '201000.00',
      taxTotal: '278820.00',
      grandTotal: '1827820.00',
      estimatedCost: '1250000.00',
      margin: '299000.00',
    });
  });
});

describe('discount capability', () => {
  it('is held by the roles that can edit a quotation, so a discount is accepted', async () => {
    const response = await addLine({
      productId: master.productLaptopId,
      quantity: 1,
      discountPercent: 5,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.lines[0].discountPercent).toBe('5.000');
  });

  it('is enforced separately from quotations:edit, even though no seeded role separates them', async () => {
    // In the current matrix every role holding quotations:edit also holds
    // quotations:apply-discount, so the guard is unreachable through HTTP today.
    // Asserting it at the capability level keeps it honest: if a future role is
    // given edit without discount rights, the guard already exists.
    const { Capability, can } = await import('../../src/modules/auth/permissions');
    const { Role } = await import('../../src/generated/prisma/enums');

    for (const role of [Role.ADMIN, Role.SALES_REP]) {
      expect(can(role, Capability.QUOTATIONS_EDIT), role).toBe(true);
      expect(can(role, Capability.QUOTATIONS_APPLY_DISCOUNT), role).toBe(true);
    }
    for (const role of [Role.SALES_MANAGER, Role.FINANCE_OPERATIONS, Role.CUSTOMER]) {
      expect(can(role, Capability.QUOTATIONS_APPLY_DISCOUNT), role).toBe(false);
    }
  });
});
