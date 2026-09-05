/**
 * Identity: customer self-registration and admin user management.
 *
 * Registration is the one unauthenticated write in the system, so most of these
 * tests are about what a caller *cannot* reach through it — a role, a tier, or
 * another organisation's data.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, api, resetDatabase, sessionAs, sessionFor, type SeedResult, type Session } from './helpers/db.js';

let seeded: SeedResult;
let admin: Session;
let rep: Session;

beforeAll(async () => {
  seeded = await resetDatabase();
  admin = await sessionAs('admin@dealflow.local', DEMO_PASSWORD);
  rep = await sessionAs('rep@dealflow.local', DEMO_PASSWORD);
});

const strongPassword = 'Sunflower2026';

function registration(overrides: Record<string, unknown> = {}) {
  const stamp = Math.random().toString(36).slice(2, 8);
  return {
    companyName: `Test Co ${stamp}`,
    contactName: 'Test Buyer',
    email: `buyer-${stamp}@example.com`,
    password: strongPassword,
    ...overrides,
  };
}

describe('customer self-registration', () => {
  it('creates an organisation, a portal login and a usable session', async () => {
    const body = registration();
    const res = await api().post('/api/auth/register').send(body);

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('CUSTOMER');
    expect(res.body.user.email).toBe(body.email);
    expect(res.body.customer.name).toBe(body.companyName);
    expect(res.body.user.customerId).toBe(res.body.customer.id);
    expect(res.body.token).toBeTypeOf('string');

    // The token must actually open the portal, not merely parse.
    const buyer = sessionFor(res.body.token as string);
    const list = await buyer.get('/api/portal/quotations');
    expect(list.status).toBe(200);
    // A brand-new organisation owns nothing.
    expect(list.body.data).toHaveLength(0);
  });

  it('never returns a password hash', async () => {
    const res = await api().post('/api/auth/register').send(registration());
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('keeps the hash out of every other identity response too', async () => {
    // The hash has no business in an HTTP body — not even the owner's own, which
    // would otherwise land in devtools and any logging proxy.
    const login = await api().post('/api/auth/login').send({
      email: 'rep@dealflow.local',
      password: DEMO_PASSWORD,
    });
    expect(login.status).toBe(200);
    expect(login.body.user.passwordHash).toBeUndefined();

    const session = sessionFor(login.body.token as string);
    const meRes = await session.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.passwordHash).toBeUndefined();

    const created = await admin.post('/api/auth/signup').send({
      email: `nohash-${Math.random().toString(36).slice(2, 8)}@dealflow.local`,
      name: 'No Hash',
      role: 'SALES_REP',
      password: strongPassword,
    });
    expect(created.body.user.passwordHash).toBeUndefined();
  });

  it('lands the new account on the lowest tier regardless of the request body', async () => {
    // Gold is the most generous tier; naming it must not grant it.
    const res = await api()
      .post('/api/auth/register')
      .send({ ...registration(), tierId: seeded.tiers.gold.id, role: 'ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('CUSTOMER');

    const customer = await admin.get(`/api/customers/${res.body.customer.id}`);
    expect(customer.status).toBe(200);
    expect(customer.body.customer.tierId).toBe(seeded.tiers.bronze.id);
  });

  it('cannot attach itself to an existing organisation', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ ...registration(), customerId: seeded.customers.acme.id });
    expect(res.status).toBe(201);

    // A fresh customer was created instead of joining Acme.
    expect(res.body.customer.id).not.toBe(seeded.customers.acme.id);

    // And the new account cannot see Acme's quotations.
    const buyer = sessionFor(res.body.token as string);
    const acmeQuote = await buyer.get(`/api/portal/quotations/${seeded.quotations.canonical.id}`);
    expect(acmeQuote.status).toBe(404);
  });

  it('derives a readable, unique customer code', async () => {
    const first = await api().post('/api/auth/register').send(registration({ companyName: 'Globex' }));
    const second = await api().post('/api/auth/register').send(registration({ companyName: 'Globex' }));

    expect(first.body.customer.code).toBe('GLOBEX');
    expect(second.body.customer.code).toBe('GLOBEX2');
  });

  it('refuses an email that already exists', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send(registration({ email: 'buyer@acme.local' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_EXISTS');
  });

  it('rejects a weak password', async () => {
    const short = await api().post('/api/auth/register').send(registration({ password: 'short1' }));
    expect(short.status).toBe(400);

    const noDigit = await api().post('/api/auth/register').send(registration({ password: 'allletters' }));
    expect(noDigit.status).toBe(400);
  });

  it('lets the new account sign in with the password it chose', async () => {
    const body = registration();
    await api().post('/api/auth/register').send(body);

    const login = await api().post('/api/auth/login').send({ email: body.email, password: body.password });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('CUSTOMER');

    // Registration is a portal identity; it does not open the workspace.
    const buyer = sessionFor(login.body.token as string);
    expect((await buyer.get('/api/quotations')).status).toBe(403);
  });
});

describe('admin user management', () => {
  it('lists employees and portal users without exposing hashes', async () => {
    const res = await admin.get('/api/auth/users');
    expect(res.status).toBe(200);

    const rows = res.body.data as Array<{ email: string; role: string; passwordHash?: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((u) => u.passwordHash === undefined)).toBe(true);
    expect(rows.map((u) => u.email)).toContain('manager@dealflow.local');
  });

  it('refuses the directory to non-admins', async () => {
    expect((await rep.get('/api/auth/users')).status).toBe(403);
  });

  it('creates an employee who can then sign in and use their role', async () => {
    const email = `newmgr-${Math.random().toString(36).slice(2, 8)}@dealflow.local`;
    const created = await admin.post('/api/auth/signup').send({
      email,
      name: 'Second Manager',
      role: 'SALES_MANAGER',
      password: strongPassword,
    });
    expect(created.status).toBe(201);
    expect(created.body.user.passwordHash).toBeUndefined();
    expect(created.body.user.customerId).toBeNull();

    const login = await api().post('/api/auth/login').send({ email, password: strongPassword });
    expect(login.status).toBe(200);

    // The assigned role is real: a Sales Manager may read the approvals queue.
    const session = sessionFor(login.body.token as string);
    expect((await session.get('/api/approvals')).status).toBe(200);
    // But not the admin-only user directory.
    expect((await session.get('/api/auth/users')).status).toBe(403);
  });

  it('refuses to give an internal user a customer scope', async () => {
    const res = await admin.post('/api/auth/signup').send({
      email: `bad-${Math.random().toString(36).slice(2, 8)}@dealflow.local`,
      name: 'Confused User',
      role: 'SALES_REP',
      password: strongPassword,
      customerId: seeded.customers.acme.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INTERNAL_NOT_CUSTOMER');
  });

  it('requires a customer for a portal user', async () => {
    const res = await admin.post('/api/auth/signup').send({
      email: `orphan-${Math.random().toString(36).slice(2, 8)}@example.com`,
      name: 'Orphan Buyer',
      role: 'CUSTOMER',
      password: strongPassword,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CUSTOMER_REQUIRED');
  });

  it('creates a portal user scoped to one organisation', async () => {
    const email = `second-buyer-${Math.random().toString(36).slice(2, 8)}@acme.local`;
    const created = await admin.post('/api/auth/signup').send({
      email,
      name: 'Second Acme Buyer',
      role: 'CUSTOMER',
      password: strongPassword,
      customerId: seeded.customers.acme.id,
    });
    expect(created.status).toBe(201);

    const login = await api().post('/api/auth/login').send({ email, password: strongPassword });
    const buyer = sessionFor(login.body.token as string);

    // Sees Acme's quotations, not Northwind's.
    const list = await buyer.get('/api/portal/quotations');
    expect(list.status).toBe(200);
    expect((list.body.data as unknown[]).length).toBeGreaterThan(0);
    expect((await buyer.get(`/api/portal/quotations/${seeded.quotations.clean.id}`)).status).toBe(404);
  });

  it('disables an account, which blocks sign-in, then re-enables it', async () => {
    const email = `toggle-${Math.random().toString(36).slice(2, 8)}@dealflow.local`;
    const created = await admin.post('/api/auth/signup').send({
      email, name: 'Toggle Me', role: 'SALES_REP', password: strongPassword,
    });
    const userId = created.body.user.id as string;

    const off = await admin.patch(`/api/auth/users/${userId}/active`).send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.user.active).toBe(false);

    const blocked = await api().post('/api/auth/login').send({ email, password: strongPassword });
    expect(blocked.status).toBe(401);

    const on = await admin.patch(`/api/auth/users/${userId}/active`).send({ active: true });
    expect(on.status).toBe(200);
    expect((await api().post('/api/auth/login').send({ email, password: strongPassword })).status).toBe(200);
  });

  it('will not let an admin disable their own account', async () => {
    const res = await admin.patch(`/api/auth/users/${seeded.users.admin.id}/active`).send({ active: false });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_DISABLE_SELF');
  });

  it('resets a password so the old one stops working', async () => {
    const email = `reset-${Math.random().toString(36).slice(2, 8)}@dealflow.local`;
    const created = await admin.post('/api/auth/signup').send({
      email, name: 'Reset Me', role: 'SALES_REP', password: strongPassword,
    });
    const userId = created.body.user.id as string;

    const next = 'Moonlight2026';
    expect((await admin.patch(`/api/auth/users/${userId}/password`).send({ password: next })).status).toBe(200);

    expect((await api().post('/api/auth/login').send({ email, password: strongPassword })).status).toBe(401);
    expect((await api().post('/api/auth/login').send({ email, password: next })).status).toBe(200);
  });

  it('rejects a weak password on reset', async () => {
    const res = await admin
      .patch(`/api/auth/users/${seeded.users.rep.id}/password`)
      .send({ password: 'weak' });
    expect(res.status).toBe(400);
  });

  it('records user creation in the audit trail', async () => {
    const email = `audited-${Math.random().toString(36).slice(2, 8)}@dealflow.local`;
    await admin.post('/api/auth/signup').send({
      email, name: 'Audited User', role: 'SALES_REP', password: strongPassword,
    });

    const { db } = await import('../src/db/client.js');
    const entries = await db.query.auditLogs.findMany({
      where: (t, { eq }) => eq(t.entityType, 'USER'),
    });
    expect(entries.some((e) => e.actorUserId === seeded.users.admin.id)).toBe(true);
  });
});
