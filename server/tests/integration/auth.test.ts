import { beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { prisma } from '../../src/db/prisma';
import { Role } from '../../src/generated/prisma/enums';
import { AuditAction } from '../../src/modules/audit/auditService';
import { agent, loginAs, request } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { seedBaseline, TEST_PASSWORD, type Baseline } from '../helpers/fixtures';

let baseline: Baseline;

beforeEach(async () => {
  await resetDatabase();
  baseline = await seedBaseline();
});

function sessionCookies(response: { headers: Record<string, unknown> }): string[] {
  const raw = response.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? (raw as string[]) : [String(raw)];
}

describe('POST /api/auth/login', () => {
  it('authenticates a valid internal user and returns the server-resolved profile (AT-01)', async () => {
    const response = await request()
      .post('/api/auth/login')
      .send({ email: baseline.users.rep.email, password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: baseline.users.rep.id,
      email: baseline.users.rep.email,
      role: Role.SALES_REP,
      customerId: null,
    });
    expect(response.body.data.capabilities).toContain('quotations:create');
    expect(response.body.data).not.toHaveProperty('passwordHash');
  });

  it('issues an httpOnly, SameSite=Lax session cookie', async () => {
    const response = await request()
      .post('/api/auth/login')
      .send({ email: baseline.users.rep.email, password: TEST_PASSWORD });

    const cookie = sessionCookies(response).find((value) =>
      value.startsWith(`${env.SESSION_COOKIE_NAME}=`),
    );
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
  });

  it('stores only a hash of the session token, never the token itself', async () => {
    const response = await request()
      .post('/api/auth/login')
      .send({ email: baseline.users.rep.email, password: TEST_PASSWORD });

    const cookie = sessionCookies(response).find((value) =>
      value.startsWith(`${env.SESSION_COOKIE_NAME}=`),
    );
    const token = cookie!.split(';')[0]!.split('=')[1]!;

    const sessions = await prisma.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).not.toBe(token);
    expect(sessions[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a wrong password, an unknown address and an inactive account identically (AT-01)', async () => {
    const attempts = [
      { email: baseline.users.rep.email, password: 'wrong-password' },
      { email: 'nobody@test.local', password: TEST_PASSWORD },
      { email: baseline.users.inactiveRep.email, password: TEST_PASSWORD },
    ];

    const responses = await Promise.all(
      attempts.map((body) => request().post('/api/auth/login').send(body)),
    );

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
      // Identical message: the endpoint must not reveal which factor failed.
      expect(response.body.error.message).toBe('Invalid email or password');
      expect(sessionCookies(response)).toHaveLength(0);
    }

    expect(await prisma.session.count()).toBe(0);
  });

  it('refuses to let a client smuggle a role into the login body', async () => {
    const response = await request()
      .post('/api/auth/login')
      .send({ email: baseline.users.rep.email, password: TEST_PASSWORD, role: Role.ADMIN });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('validates missing credentials with a structured error', async () => {
    const response = await request().post('/api/auth/login').send({});
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details.length).toBeGreaterThan(0);
  });

  it('treats email as case-insensitive', async () => {
    const response = await request()
      .post('/api/auth/login')
      .send({ email: baseline.users.rep.email.toUpperCase(), password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.data.email).toBe(baseline.users.rep.email);
  });
});

describe('login surface isolation', () => {
  it('refuses a customer credential at the internal login endpoint', async () => {
    const response = await request()
      .post('/api/auth/login')
      .send({ email: baseline.users.acmeBuyer.email, password: TEST_PASSWORD });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(await prisma.session.count()).toBe(0);
  });

  it('refuses an internal credential at the portal login endpoint', async () => {
    const response = await request()
      .post('/api/portal/auth/login')
      .send({ email: baseline.users.admin.email, password: TEST_PASSWORD });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(await prisma.session.count()).toBe(0);
  });

  it('authenticates a customer at the portal and binds the session to its customer', async () => {
    const response = await request()
      .post('/api/portal/auth/login')
      .send({ email: baseline.users.acmeBuyer.email, password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      role: Role.CUSTOMER,
      customerId: baseline.acmeId,
      customerName: 'Acme Corp',
    });
    // A customer must never receive margin authority (docs/PRD.md 15).
    expect(response.body.data.capabilities).not.toContain('margin:view');
  });
});

describe('GET /api/auth/me', () => {
  it('requires a session', async () => {
    const response = await request().get('/api/auth/me');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a forged session cookie', async () => {
    const response = await request()
      .get('/api/auth/me')
      .set('Cookie', `${env.SESSION_COOKIE_NAME}=not-a-real-token`);

    expect(response.status).toBe(401);
  });

  it('returns the identity for a live session', async () => {
    const client = await loginAs(baseline.users.manager.email);
    const response = await client.get('/api/auth/me');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: baseline.users.manager.id,
      role: Role.SALES_MANAGER,
    });
  });

  it('reads the role from the database, so a role change applies on the next request', async () => {
    const client = await loginAs(baseline.users.rep.email);
    await expect(client.get('/api/auth/me').then((r) => r.body.data.role)).resolves.toBe(
      Role.SALES_REP,
    );

    await prisma.user.update({
      where: { id: baseline.users.rep.id },
      data: { role: Role.SALES_MANAGER },
    });

    const response = await client.get('/api/auth/me');
    expect(response.body.data.role).toBe(Role.SALES_MANAGER);
    expect(response.body.data.capabilities).toContain('approvals:act-manager');
  });

  it('rejects a session whose user has been deactivated', async () => {
    const client = await loginAs(baseline.users.rep.email);
    await prisma.user.update({ where: { id: baseline.users.rep.id }, data: { active: false } });

    const response = await client.get('/api/auth/me');
    expect(response.status).toBe(401);
  });

  it('rejects an expired session and removes the dead row', async () => {
    const client = await loginAs(baseline.users.rep.email);
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const response = await client.get('/api/auth/me');
    expect(response.status).toBe(401);
    expect(await prisma.session.count()).toBe(0);
  });
});

describe('POST /api/auth/logout', () => {
  it('destroys the session server-side and clears the cookie', async () => {
    const client = await loginAs(baseline.users.rep.email);
    expect(await prisma.session.count()).toBe(1);

    const response = await client.post('/api/auth/logout');
    expect(response.status).toBe(204);
    expect(await prisma.session.count()).toBe(0);

    const after = await client.get('/api/auth/me');
    expect(after.status).toBe(401);
  });

  it('requires a session', async () => {
    const response = await request().post('/api/auth/logout');
    expect(response.status).toBe(401);
  });
});

describe('audit trail for authentication (AT-17)', () => {
  it('records a successful login with actor, role and timestamp', async () => {
    await loginAs(baseline.users.rep.email);

    const entries = await prisma.auditLog.findMany({
      where: { action: AuditAction.USER_LOGGED_IN },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entityType: 'User',
      entityId: baseline.users.rep.id,
      actorUserId: baseline.users.rep.id,
      actorRole: Role.SALES_REP,
    });
    expect(entries[0]!.createdAt).toBeInstanceOf(Date);
  });

  it('records a failed login with the reason but never the password', async () => {
    await request()
      .post('/api/auth/login')
      .send({ email: baseline.users.rep.email, password: 'wrong-password' });

    const entries = await prisma.auditLog.findMany({
      where: { action: AuditAction.USER_LOGIN_FAILED },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.newValue).toMatchObject({ reason: 'BAD_PASSWORD' });
    expect(JSON.stringify(entries[0]!.newValue)).not.toContain('wrong-password');
  });

  it('records a rejected login surface separately from a bad password', async () => {
    await request()
      .post('/api/auth/login')
      .send({ email: baseline.users.acmeBuyer.email, password: TEST_PASSWORD });

    const entries = await prisma.auditLog.findMany({
      where: { action: AuditAction.USER_LOGIN_FAILED },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.newValue).toMatchObject({ reason: 'WRONG_LOGIN_SURFACE' });
  });

  it('records a logout', async () => {
    const client = await loginAs(baseline.users.finance.email);
    await client.post('/api/auth/logout');

    const entries = await prisma.auditLog.findMany({
      where: { action: AuditAction.USER_LOGGED_OUT },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorUserId).toBe(baseline.users.finance.id);
  });
});

describe('concurrent sessions', () => {
  it('keeps sessions independent, so logging out of one does not end the other', async () => {
    const first = await loginAs(baseline.users.rep.email);
    const second = await loginAs(baseline.users.rep.email);
    expect(await prisma.session.count()).toBe(2);

    await first.post('/api/auth/logout');

    expect((await first.get('/api/auth/me')).status).toBe(401);
    expect((await second.get('/api/auth/me')).status).toBe(200);
  });
});

describe('GET /api/health', () => {
  it('reports database reachability without requiring authentication', async () => {
    const response = await agent().get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ status: 'ok', database: 'up' });
  });
});

describe('unknown routes', () => {
  it('answers 401 rather than 404 for unauthenticated callers, so the internal API surface cannot be enumerated', async () => {
    const response = await request().get('/api/does-not-exist');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns a structured 404 once the caller is authorized for the namespace', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.message).toContain('/api/does-not-exist');
  });
});
