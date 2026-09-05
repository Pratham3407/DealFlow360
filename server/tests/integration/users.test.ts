import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma';
import { Role } from '../../src/generated/prisma/enums';
import { AuditAction } from '../../src/modules/audit/auditService';
import { loginAs } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { seedBaseline, TEST_PASSWORD, type Baseline } from '../helpers/fixtures';

let baseline: Baseline;

beforeEach(async () => {
  await resetDatabase();
  baseline = await seedBaseline();
});

const VALID_PASSWORD = 'Provisioned-Passw0rd';

describe('POST /api/users - admin provisioning', () => {
  it('creates an internal user and records an audit event', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.post('/api/users').send({
      email: 'New.Rep@Test.Local',
      name: '  Nina Rao  ',
      password: VALID_PASSWORD,
      role: Role.SALES_REP,
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      email: 'new.rep@test.local',
      name: 'Nina Rao',
      role: Role.SALES_REP,
      active: true,
      customerId: null,
    });
    expect(response.body.data).not.toHaveProperty('passwordHash');

    const audit = await prisma.auditLog.findMany({ where: { action: AuditAction.USER_CREATED } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorUserId: baseline.users.admin.id,
      actorRole: Role.ADMIN,
      entityId: response.body.data.id,
    });
  });

  it('produces a credential the new user can immediately sign in with', async () => {
    const admin = await loginAs(baseline.users.admin.email);
    await admin.post('/api/users').send({
      email: 'fresh@test.local',
      name: 'Fresh Rep',
      password: VALID_PASSWORD,
      role: Role.SALES_REP,
    });

    const client = await loginAs('fresh@test.local', 'internal', VALID_PASSWORD);
    const profile = await client.get('/api/auth/me');
    expect(profile.body.data.role).toBe(Role.SALES_REP);
  });

  it('creates a customer login bound to a customer, usable only at the portal', async () => {
    const admin = await loginAs(baseline.users.admin.email);
    const response = await admin.post('/api/users').send({
      email: 'second.buyer@acme.test.local',
      name: 'Second Buyer',
      password: VALID_PASSWORD,
      role: Role.CUSTOMER,
      customerId: baseline.acmeId,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.customerId).toBe(baseline.acmeId);

    const portal = await loginAs('second.buyer@acme.test.local', 'portal', VALID_PASSWORD);
    expect((await portal.get('/api/auth/me')).body.data.customerId).toBe(baseline.acmeId);
  });

  it('rejects a customer role without a customer link', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.post('/api/users').send({
      email: 'orphan@test.local',
      name: 'Orphan',
      password: VALID_PASSWORD,
      role: Role.CUSTOMER,
    });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(await prisma.user.findUnique({ where: { email: 'orphan@test.local' } })).toBeNull();
  });

  it('rejects an internal role carrying a customer link', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.post('/api/users').send({
      email: 'confused@test.local',
      name: 'Confused',
      password: VALID_PASSWORD,
      role: Role.SALES_MANAGER,
      customerId: baseline.acmeId,
    });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('rejects a duplicate email with a conflict', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.post('/api/users').send({
      email: baseline.users.rep.email,
      name: 'Duplicate',
      password: VALID_PASSWORD,
      role: Role.SALES_REP,
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('rejects a short password and an unknown customer', async () => {
    const client = await loginAs(baseline.users.admin.email);

    const short = await client.post('/api/users').send({
      email: 'weak@test.local',
      name: 'Weak',
      password: 'short',
      role: Role.SALES_REP,
    });
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe('VALIDATION_FAILED');

    const missingCustomer = await client.post('/api/users').send({
      email: 'ghost@test.local',
      name: 'Ghost',
      password: VALID_PASSWORD,
      role: Role.CUSTOMER,
      customerId: '00000000-0000-0000-0000-000000000000',
    });
    expect(missingCustomer.status).toBe(404);
  });

  it('rejects unknown fields rather than silently ignoring them', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.post('/api/users').send({
      email: 'extra@test.local',
      name: 'Extra',
      password: VALID_PASSWORD,
      role: Role.SALES_REP,
      active: false,
      passwordHash: 'injected',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /api/users/:id/deactivate', () => {
  it('deactivates the account, revokes its sessions and audits the change', async () => {
    const victim = await loginAs(baseline.users.rep.email);
    expect((await victim.get('/api/auth/me')).status).toBe(200);
    expect(await prisma.session.count({ where: { userId: baseline.users.rep.id } })).toBe(1);

    const admin = await loginAs(baseline.users.admin.email);
    const response = await admin
      .post(`/api/users/${baseline.users.rep.id}/deactivate`)
      .send({ reason: 'Left the company' });

    expect(response.status).toBe(200);
    expect(response.body.data.active).toBe(false);
    expect(await prisma.session.count({ where: { userId: baseline.users.rep.id } })).toBe(0);

    // The already-issued cookie must stop working immediately.
    expect((await victim.get('/api/auth/me')).status).toBe(401);

    const audit = await prisma.auditLog.findMany({
      where: { action: AuditAction.USER_DEACTIVATED },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entityId: baseline.users.rep.id,
      actorUserId: baseline.users.admin.id,
      reason: 'Left the company',
    });
    expect(audit[0]!.oldValue).toMatchObject({ active: true });
    expect(audit[0]!.newValue).toMatchObject({ active: false });
  });

  it('refuses self-deactivation', async () => {
    const admin = await loginAs(baseline.users.admin.email);
    const response = await admin.post(`/api/users/${baseline.users.admin.id}/deactivate`).send({});

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
    expect((await prisma.user.findUnique({ where: { id: baseline.users.admin.id } }))!.active).toBe(
      true,
    );
  });

  it('rejects a malformed id and a missing user', async () => {
    const admin = await loginAs(baseline.users.admin.email);

    expect((await admin.post('/api/users/not-a-uuid/deactivate').send({})).status).toBe(400);
    expect(
      (await admin.post('/api/users/00000000-0000-0000-0000-000000000000/deactivate').send({}))
        .status,
    ).toBe(404);
  });

  it('cannot be called by a non-admin role', async () => {
    const manager = await loginAs(baseline.users.manager.email);
    const response = await manager
      .post(`/api/users/${baseline.users.rep.id}/deactivate`)
      .send({ reason: 'trying it on' });

    expect(response.status).toBe(403);
    expect((await prisma.user.findUnique({ where: { id: baseline.users.rep.id } }))!.active).toBe(
      true,
    );
  });
});

describe('audit history is preserved (AGENTS.md 20)', () => {
  it('prevents deleting a user that has audit history', async () => {
    await loginAs(baseline.users.rep.email, 'internal', TEST_PASSWORD);
    expect(await prisma.auditLog.count({ where: { actorUserId: baseline.users.rep.id } })).toBe(1);

    await expect(prisma.user.delete({ where: { id: baseline.users.rep.id } })).rejects.toThrow();
    expect(await prisma.auditLog.count({ where: { actorUserId: baseline.users.rep.id } })).toBe(1);
  });
});
