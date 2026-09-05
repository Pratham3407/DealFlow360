import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma';
import { QuotationStatus } from '../../src/generated/prisma/enums';
import { AuditAction } from '../../src/modules/audit/auditService';
import { loginAs, request } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { seedBaseline, seedMasterData, type Baseline, type MasterData } from '../helpers/fixtures';
import type TestAgent from 'supertest/lib/agent';

let baseline: Baseline;
let master: MasterData;

beforeEach(async () => {
  await resetDatabase();
  baseline = await seedBaseline();
  master = await seedMasterData(baseline);
});

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

/** Create a quotation as the seeded rep and return the response body. */
async function createAsRep(client: TestAgent, overrides: Record<string, unknown> = {}) {
  const response = await client
    .post('/api/quotations')
    .send({ customerId: baseline.acmeId, ...overrides });
  if (response.status !== 201) {
    throw new Error(`create failed ${response.status}: ${JSON.stringify(response.body)}`);
  }
  return response.body.data as Record<string, unknown>;
}

// ===========================================================================
// Creation
// ===========================================================================

describe('POST /api/quotations', () => {
  it('creates a DRAFT quotation at version 1, owned by the authenticated rep', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const response = await client.post('/api/quotations').send({ customerId: baseline.acmeId });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      customerId: baseline.acmeId,
      customerName: 'Acme Corp',
      customerTierName: 'Gold',
      salesRepId: baseline.users.rep.id,
      status: QuotationStatus.DRAFT,
      version: 1,
      currency: 'INR',
      lineCount: 0,
      approvedVersion: null,
      approvalValid: false,
    });
    // Totals start at zero and are all server-authored.
    expect(response.body.data).toMatchObject({
      subtotal: '0.00',
      discountTotal: '0.00',
      taxTotal: '0.00',
      grandTotal: '0.00',
      estimatedCost: '0.00',
      margin: '0.00',
      orderDiscountPercent: '0.000',
    });
    expect(response.body.data.lines).toEqual([]);
  });

  it('assigns a sequential quote number', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const first = await createAsRep(client);
    const second = await createAsRep(client);

    expect(first['quoteNumber']).toMatch(/^Q-\d{4}-\d{6}$/);
    expect(second['quoteNumber']).not.toBe(first['quoteNumber']);
  });

  it('gives concurrent creates distinct numbers', async () => {
    // The whole reason for a sequence rather than count(*) + 1.
    const client = await loginAs(baseline.users.rep.email);
    const responses = await Promise.all([
      client.post('/api/quotations').send({ customerId: baseline.acmeId }),
      client.post('/api/quotations').send({ customerId: baseline.acmeId }),
      client.post('/api/quotations').send({ customerId: baseline.acmeId }),
    ]);

    const numbers = responses.map((response) => response.body.data.quoteNumber as string);
    expect(new Set(numbers).size).toBe(3);
  });

  it('records notes and a validity date', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const data = await createAsRep(client, {
      notes: 'Renewal for FY27',
      validUntil: validUntil.toISOString(),
    });

    expect(data['notes']).toBe('Renewal for FY27');
    expect(new Date(data['validUntil'] as string).toISOString().slice(0, 10)).toBe(
      validUntil.toISOString().slice(0, 10),
    );
  });

  it('audits creation with the actor and version', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const data = await createAsRep(client);

    const audit = await prisma.auditLog.findMany({
      where: { action: AuditAction.QUOTATION_CREATED, entityId: data['id'] as string },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entityType: 'Quotation',
      actorUserId: baseline.users.rep.id,
      actorRole: 'SALES_REP',
      entityVersion: 1,
    });
  });

  it('refuses a rep trying to assign the quotation to someone else', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const response = await client
      .post('/api/quotations')
      .send({ customerId: baseline.acmeId, salesRepId: baseline.users.manager.id });

    expect(response.status).toBe(422);
    expect(response.body.error.details[0].path).toBe('salesRepId');
    expect(await prisma.quotation.count()).toBe(0);
  });

  it('accepts a rep naming itself explicitly', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const response = await client
      .post('/api/quotations')
      .send({ customerId: baseline.acmeId, salesRepId: baseline.users.rep.id });

    expect(response.status).toBe(201);
  });

  it('lets an admin create on behalf of a named rep', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .post('/api/quotations')
      .send({ customerId: baseline.acmeId, salesRepId: baseline.users.rep.id });

    expect(response.status).toBe(201);
    expect(response.body.data.salesRepId).toBe(baseline.users.rep.id);
  });

  it('requires an admin to name the owning rep', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.post('/api/quotations').send({ customerId: baseline.acmeId });

    expect(response.status).toBe(422);
    expect(response.body.error.details[0].path).toBe('salesRepId');
  });

  it('refuses an owner who is not a sales representative', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client
      .post('/api/quotations')
      .send({ customerId: baseline.acmeId, salesRepId: baseline.users.finance.id });

    expect(response.status).toBe(422);
    expect(response.body.error.message).toMatch(/owned by a sales representative/i);
  });

  it('refuses a deactivated owner and a deactivated customer', async () => {
    const admin = await loginAs(baseline.users.admin.email);

    const inactiveOwner = await admin
      .post('/api/quotations')
      .send({ customerId: baseline.acmeId, salesRepId: baseline.users.inactiveRep.id });
    expect(inactiveOwner.status).toBe(409);

    await prisma.customer.update({ where: { id: baseline.globexId }, data: { active: false } });
    const inactiveCustomer = await admin
      .post('/api/quotations')
      .send({ customerId: baseline.globexId, salesRepId: baseline.users.rep.id });
    expect(inactiveCustomer.status).toBe(409);
  });

  it('rejects an unknown customer, a past validity date and an unknown field', async () => {
    const client = await loginAs(baseline.users.rep.email);

    expect((await client.post('/api/quotations').send({ customerId: UNKNOWN_ID })).status).toBe(404);

    const past = await client
      .post('/api/quotations')
      .send({ customerId: baseline.acmeId, validUntil: '2020-01-01T00:00:00.000Z' });
    expect(past.status).toBe(422);

    // Server-authored fields must be refused, not ignored.
    for (const field of [
      { status: 'APPROVED' },
      { version: 5 },
      { quoteNumber: 'Q-2026-000999' },
      { grandTotal: '1.00' },
      { margin: '999.00' },
      { riskScore: '0.0000' },
    ]) {
      const response = await client
        .post('/api/quotations')
        .send({ customerId: baseline.acmeId, ...field });
      expect(response.status, JSON.stringify(field)).toBe(400);
    }
  });

  it('is refused to a sales manager, who reviews rather than creates', async () => {
    // docs/RBAC.md marks "Create quotations" Optional for Manager; the least
    // privileged reading is taken.
    const client = await loginAs(baseline.users.manager.email);
    const response = await client
      .post('/api/quotations')
      .send({ customerId: baseline.acmeId, salesRepId: baseline.users.rep.id });

    expect(response.status).toBe(403);
  });

  it('is refused to finance, to a customer and to an anonymous caller', async () => {
    const finance = await loginAs(baseline.users.finance.email);
    expect(
      (await finance
        .post('/api/quotations')
        .send({ customerId: baseline.acmeId, salesRepId: baseline.users.rep.id })).status,
    ).toBe(403);

    const portal = await loginAs(baseline.users.acmeBuyer.email, 'portal');
    expect((await portal.post('/api/quotations').send({ customerId: baseline.acmeId })).status).toBe(403);

    expect((await request().post('/api/quotations').send({ customerId: baseline.acmeId })).status).toBe(401);
    expect(await prisma.quotation.count()).toBe(0);
  });
});

// ===========================================================================
// Listing and retrieval
// ===========================================================================

describe('GET /api/quotations', () => {
  it('returns the list envelope', async () => {
    const client = await loginAs(baseline.users.rep.email);
    await createAsRep(client);
    await createAsRep(client);

    const response = await client.get('/api/quotations');
    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual({ total: 2, limit: 50, offset: 0 });
    expect(response.body.data).toHaveLength(2);
  });

  it('scopes a sales rep to its own quotations', async () => {
    // docs/PRD.md 21: a rep sees assigned/authorized quotations only.
    const admin = await loginAs(baseline.users.admin.email);
    const rep = await loginAs(baseline.users.rep.email);

    await createAsRep(rep);
    // A second rep with its own quotation.
    const otherRep = await prisma.user.create({
      data: {
        email: 'rep2@test.local',
        name: 'Second Rep',
        role: 'SALES_REP',
        passwordHash: (await prisma.user.findUniqueOrThrow({ where: { id: baseline.users.rep.id } }))
          .passwordHash,
      },
    });
    await admin.post('/api/quotations').send({ customerId: baseline.acmeId, salesRepId: otherRep.id });

    expect((await rep.get('/api/quotations')).body.meta.total).toBe(1);
    // Every other internal role sees both.
    expect((await admin.get('/api/quotations')).body.meta.total).toBe(2);

    const manager = await loginAs(baseline.users.manager.email);
    expect((await manager.get('/api/quotations')).body.meta.total).toBe(2);
  });

  it('does not let a rep widen its scope with a salesRepId filter', async () => {
    const admin = await loginAs(baseline.users.admin.email);
    const rep = await loginAs(baseline.users.rep.email);

    const otherRep = await prisma.user.create({
      data: {
        email: 'rep3@test.local',
        name: 'Third Rep',
        role: 'SALES_REP',
        passwordHash: (await prisma.user.findUniqueOrThrow({ where: { id: baseline.users.rep.id } }))
          .passwordHash,
      },
    });
    await admin.post('/api/quotations').send({ customerId: baseline.acmeId, salesRepId: otherRep.id });

    const response = await rep.get(`/api/quotations?salesRepId=${otherRep.id}`);
    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBe(0);
  });

  it('pages, filters by status and customer, and searches by quote number', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const first = await createAsRep(client);
    await createAsRep(client);

    expect((await client.get('/api/quotations?limit=1')).body.data).toHaveLength(1);
    expect((await client.get('/api/quotations?limit=1&offset=1')).body.meta).toEqual({
      total: 2,
      limit: 1,
      offset: 1,
    });
    expect((await client.get('/api/quotations?status=DRAFT')).body.meta.total).toBe(2);
    expect((await client.get('/api/quotations?status=CONFIRMED')).body.meta.total).toBe(0);
    expect((await client.get(`/api/quotations?customerId=${baseline.acmeId}`)).body.meta.total).toBe(2);
    expect(
      (await client.get(`/api/quotations?q=${first['quoteNumber'] as string}`)).body.meta.total,
    ).toBe(1);
  });

  it('rejects an unknown status and an unknown query parameter', async () => {
    const client = await loginAs(baseline.users.rep.email);
    expect((await client.get('/api/quotations?status=NOPE')).status).toBe(400);
    expect((await client.get('/api/quotations?sort=grandTotal')).status).toBe(400);
  });

  it('is refused to a customer session and to an anonymous caller', async () => {
    const portal = await loginAs(baseline.users.acmeBuyer.email, 'portal');
    expect((await portal.get('/api/quotations')).status).toBe(403);
    expect((await request().get('/api/quotations')).status).toBe(401);
  });
});

describe('GET /api/quotations/:id', () => {
  it('returns the quotation with its lines', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(client);
    await client
      .post(`/api/quotations/${created['id']}/lines`)
      .send({ version: 1, productId: master.productLaptopId, quantity: 2 });

    const response = await client.get(`/api/quotations/${created['id']}`);
    expect(response.status).toBe(200);
    expect(response.body.data.lines).toHaveLength(1);
    expect(response.body.data.lines[0]).toMatchObject({ sku: 'HW-LAPTOP-ENT', quantity: 2 });
  });

  it('answers 404 for another rep\'s quotation rather than 403', async () => {
    // A 403 would confirm the id exists, letting a rep enumerate other reps' work.
    const admin = await loginAs(baseline.users.admin.email);
    const otherRep = await prisma.user.create({
      data: {
        email: 'rep4@test.local',
        name: 'Fourth Rep',
        role: 'SALES_REP',
        passwordHash: (await prisma.user.findUniqueOrThrow({ where: { id: baseline.users.rep.id } }))
          .passwordHash,
      },
    });
    const foreign = await admin
      .post('/api/quotations')
      .send({ customerId: baseline.acmeId, salesRepId: otherRep.id });

    const rep = await loginAs(baseline.users.rep.email);
    expect((await rep.get(`/api/quotations/${foreign.body.data.id}`)).status).toBe(404);
  });

  it('returns 404 for an unknown id and 400 for a malformed one', async () => {
    const client = await loginAs(baseline.users.rep.email);
    expect((await client.get(`/api/quotations/${UNKNOWN_ID}`)).status).toBe(404);
    expect((await client.get('/api/quotations/not-a-uuid')).status).toBe(400);
  });
});

// ===========================================================================
// Update
// ===========================================================================

describe('PATCH /api/quotations/:id', () => {
  it('changes notes without bumping the version', async () => {
    // Notes are not a commercial term, so they must not invalidate an approval.
    const client = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(client);

    const response = await client
      .patch(`/api/quotations/${created['id']}`)
      .send({ version: 1, notes: 'Updated note' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ notes: 'Updated note', version: 1 });
  });

  it('bumps the version when the order discount changes', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(client);

    const response = await client
      .patch(`/api/quotations/${created['id']}`)
      .send({ version: 1, orderDiscountPercent: 2.5 });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ orderDiscountPercent: '2.500', version: 2 });
  });

  it('bumps the version when the customer changes', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(client);

    const response = await client
      .patch(`/api/quotations/${created['id']}`)
      .send({ version: 1, customerId: baseline.globexId });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      customerId: baseline.globexId,
      customerName: 'Globex Industries',
      version: 2,
    });
  });

  it('rejects a stale version and leaves the row untouched', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(client);

    // Move to version 2.
    await client.patch(`/api/quotations/${created['id']}`).send({ version: 1, orderDiscountPercent: 5 });

    const stale = await client
      .patch(`/api/quotations/${created['id']}`)
      .send({ version: 1, orderDiscountPercent: 20 });

    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    const row = await prisma.quotation.findUniqueOrThrow({ where: { id: created['id'] as string } });
    expect(row.orderDiscountPercent.toFixed(3)).toBe('5.000');
    expect(row.version).toBe(2);
  });

  it('accepts the current version', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(client);
    await client.patch(`/api/quotations/${created['id']}`).send({ version: 1, orderDiscountPercent: 5 });

    const response = await client
      .patch(`/api/quotations/${created['id']}`)
      .send({ version: 2, orderDiscountPercent: 7 });

    expect(response.status).toBe(200);
    expect(response.body.data.version).toBe(3);
  });

  it('requires the version on every mutation', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(client);

    const response = await client.patch(`/api/quotations/${created['id']}`).send({ notes: 'x' });
    expect(response.status).toBe(400);
  });

  it('writes no audit row and does not bump the version for a no-op patch', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(client, { notes: 'Same note' });

    const response = await client
      .patch(`/api/quotations/${created['id']}`)
      .send({ version: 1, notes: 'Same note' });

    expect(response.status).toBe(200);
    expect(response.body.data.version).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { entityId: created['id'] as string, action: AuditAction.QUOTATION_EDITED },
      }),
    ).toBe(0);
  });

  it('audits a discount change as DISCOUNT_CHANGED with old and new values', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(client);
    await client.patch(`/api/quotations/${created['id']}`).send({ version: 1, orderDiscountPercent: 4 });

    const audit = await prisma.auditLog.findMany({
      where: { entityId: created['id'] as string, action: AuditAction.DISCOUNT_CHANGED },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.oldValue).toEqual({ orderDiscountPercent: '0.000' });
    expect(audit[0]!.newValue).toEqual({ orderDiscountPercent: '4.000' });
    expect(audit[0]!.entityVersion).toBe(2);
  });

  it('rejects an unknown customer and a server-authored field', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(client);

    expect(
      (await client.patch(`/api/quotations/${created['id']}`).send({ version: 1, customerId: UNKNOWN_ID }))
        .status,
    ).toBe(404);

    for (const field of [{ status: 'APPROVED' }, { grandTotal: '5.00' }, { subtotal: '1.00' }]) {
      const response = await client
        .patch(`/api/quotations/${created['id']}`)
        .send({ version: 1, ...field });
      expect(response.status, JSON.stringify(field)).toBe(400);
    }
  });

  it('is refused to a manager, to finance and to a customer', async () => {
    const rep = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(rep);

    for (const email of [baseline.users.manager.email, baseline.users.finance.email]) {
      const client = await loginAs(email);
      const response = await client
        .patch(`/api/quotations/${created['id']}`)
        .send({ version: 1, notes: 'meddling' });
      expect(response.status, email).toBe(403);
    }

    const portal = await loginAs(baseline.users.acmeBuyer.email, 'portal');
    expect(
      (await portal.patch(`/api/quotations/${created['id']}`).send({ version: 1, notes: 'x' })).status,
    ).toBe(403);
  });
});

// ===========================================================================
// Recalculate
// ===========================================================================

describe('POST /api/quotations/:id/recalculate', () => {
  it('is idempotent and does not bump the version', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(client);
    await client
      .post(`/api/quotations/${created['id']}/lines`)
      .send({ version: 1, productId: master.productLaptopId, quantity: 2 });

    const first = await client.post(`/api/quotations/${created['id']}/recalculate`).send({});
    const second = await client.post(`/api/quotations/${created['id']}/recalculate`).send({});

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data.version).toBe(2);
    expect(second.body.data.version).toBe(2);
    expect(second.body.data.grandTotal).toBe(first.body.data.grandTotal);
  });

  it('repairs stored totals that no longer match the lines', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(client);
    await client
      .post(`/api/quotations/${created['id']}/lines`)
      .send({ version: 1, productId: master.productLaptopId, quantity: 1 });

    // Corrupt the stored figure directly, as a bug or a manual edit might.
    await prisma.quotation.update({
      where: { id: created['id'] as string },
      data: { grandTotal: '1.00' },
    });

    const response = await client.post(`/api/quotations/${created['id']}/recalculate`).send({});
    expect(response.body.data.grandTotal).toBe('94400.00');
  });
});

// ===========================================================================
// Margin visibility
// ===========================================================================

describe('margin visibility', () => {
  it('exposes cost and margin to internal roles that hold margin:view', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(client);
    await client
      .post(`/api/quotations/${created['id']}/lines`)
      .send({ version: 1, productId: master.productLaptopId, quantity: 1 });

    const response = await client.get(`/api/quotations/${created['id']}`);
    expect(response.body.data).toHaveProperty('estimatedCost');
    expect(response.body.data).toHaveProperty('margin');
    expect(response.body.data.lines[0]).toHaveProperty('unitCost');
    expect(response.body.data.lines[0]).toHaveProperty('margin');
  });
});

// ===========================================================================
// Submission and state transitions
// ===========================================================================

describe('POST /api/quotations/:id/submit', () => {
  it('moves a DRAFT quotation with lines to PENDING_APPROVAL', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(client);
    const withLine = await client
      .post(`/api/quotations/${created['id']}/lines`)
      .send({ version: 1, productId: master.productLaptopId, quantity: 2 });

    const response = await client
      .post(`/api/quotations/${created['id']}/submit`)
      .send({ version: withLine.body.data.version });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe(QuotationStatus.PENDING_APPROVAL);
  });

  it('refuses to submit an empty quotation', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(client);

    const response = await client.post(`/api/quotations/${created['id']}/submit`).send({ version: 1 });
    expect(response.status).toBe(422);
    expect(response.body.error.message).toMatch(/at least one line/i);
  });

  it('audits the approval request', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(client);
    const withLine = await client
      .post(`/api/quotations/${created['id']}/lines`)
      .send({ version: 1, productId: master.productLaptopId, quantity: 1 });
    await client
      .post(`/api/quotations/${created['id']}/submit`)
      .send({ version: withLine.body.data.version });

    const audit = await prisma.auditLog.findMany({
      where: { entityId: created['id'] as string, action: AuditAction.APPROVAL_REQUESTED },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.oldValue).toEqual({ status: 'DRAFT' });
    expect(audit[0]!.newValue).toEqual({ status: 'PENDING_APPROVAL' });
  });

  it('refuses a second submission of the same quotation', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(client);
    const withLine = await client
      .post(`/api/quotations/${created['id']}/lines`)
      .send({ version: 1, productId: master.productLaptopId, quantity: 1 });
    const version = withLine.body.data.version as number;

    expect((await client.post(`/api/quotations/${created['id']}/submit`).send({ version })).status).toBe(200);

    const again = await client.post(`/api/quotations/${created['id']}/submit`).send({ version });
    expect(again.status).toBe(409);
  });

  it('rejects a stale version', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(client);
    await client
      .post(`/api/quotations/${created['id']}/lines`)
      .send({ version: 1, productId: master.productLaptopId, quantity: 1 });

    const response = await client.post(`/api/quotations/${created['id']}/submit`).send({ version: 1 });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('VERSION_CONFLICT');
  });
});

describe('edit gate after submission', () => {
  it('refuses commercial edits once the quotation leaves DRAFT', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(client);
    const withLine = await client
      .post(`/api/quotations/${created['id']}/lines`)
      .send({ version: 1, productId: master.productLaptopId, quantity: 1 });
    const submitted = await client
      .post(`/api/quotations/${created['id']}/submit`)
      .send({ version: withLine.body.data.version });
    const version = submitted.body.data.version as number;

    // A material change behind the approver's back must be impossible.
    const discount = await client
      .patch(`/api/quotations/${created['id']}`)
      .send({ version, orderDiscountPercent: 30 });
    expect(discount.status).toBe(409);
    expect(discount.body.error.code).toBe('INVALID_STATE_TRANSITION');

    const addLine = await client
      .post(`/api/quotations/${created['id']}/lines`)
      .send({ version, productId: master.productSetupId, quantity: 1 });
    expect(addLine.status).toBe(409);
  });

  it('still allows a note to be changed after submission', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const created = await createAsRep(client);
    const withLine = await client
      .post(`/api/quotations/${created['id']}/lines`)
      .send({ version: 1, productId: master.productLaptopId, quantity: 1 });
    const submitted = await client
      .post(`/api/quotations/${created['id']}/submit`)
      .send({ version: withLine.body.data.version });

    const response = await client
      .patch(`/api/quotations/${created['id']}`)
      .send({ version: submitted.body.data.version, notes: 'Chased with the buyer' });

    expect(response.status).toBe(200);
    expect(response.body.data.notes).toBe('Chased with the buyer');
  });
});
