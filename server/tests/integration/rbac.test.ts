import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma';
import { Role } from '../../src/generated/prisma/enums';
import { loginAs, request } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { seedBaseline, type Baseline } from '../helpers/fixtures';

let baseline: Baseline;

beforeEach(async () => {
  await resetDatabase();
  baseline = await seedBaseline();
});

/**
 * `/api/users` is the slice-1 stand-in for "an internal, ADMIN-only endpoint".
 * The point of these tests is the boundary, not the payload.
 */
const INTERNAL_ADMIN_ROUTE = '/api/users';

describe('authentication boundary', () => {
  it('rejects an unauthenticated request to an internal route', async () => {
    const response = await request().get(INTERNAL_ADMIN_ROUTE);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('does not leak whether the route exists to an unauthenticated caller', async () => {
    // Auth is evaluated before routing within the internal namespace, so both
    // shapes answer 401 rather than distinguishing 404 from 401.
    const real = await request().get(INTERNAL_ADMIN_ROUTE);
    const fake = await request().get('/api/users/00000000-0000-0000-0000-000000000000/deactivate');
    expect(real.status).toBe(401);
    expect(fake.status).toBe(401);
  });
});

describe('role authorization (AT-06)', () => {
  it('permits ADMIN', async () => {
    const client = await loginAs(baseline.users.admin.email);
    const response = await client.get(INTERNAL_ADMIN_ROUTE);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('denies SALES_REP, SALES_MANAGER and FINANCE_OPERATIONS', async () => {
    for (const email of [
      baseline.users.rep.email,
      baseline.users.manager.email,
      baseline.users.finance.email,
    ]) {
      const client = await loginAs(email);
      const response = await client.get(INTERNAL_ADMIN_ROUTE);
      expect(response.status, `expected 403 for ${email}`).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('denies a write to an ADMIN-only route from a non-admin role', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const response = await client.post(INTERNAL_ADMIN_ROUTE).send({
      email: 'escalation@test.local',
      name: 'Escalation',
      password: 'Passw0rd-long-enough',
      role: Role.ADMIN,
    });

    expect(response.status).toBe(403);
    // Authorization runs before the handler, so nothing was written.
    expect(await prisma.user.findUnique({ where: { email: 'escalation@test.local' } })).toBeNull();
  });

  it('ignores a client-supplied role header or body field when authorizing', async () => {
    const client = await loginAs(baseline.users.rep.email);
    const response = await client
      .get(INTERNAL_ADMIN_ROUTE)
      .set('X-Role', Role.ADMIN)
      .set('X-User-Role', Role.ADMIN);

    expect(response.status).toBe(403);
  });
});

describe('customer portal isolation (AT-02, docs/RBAC.md)', () => {
  it('denies a customer session access to the internal namespace', async () => {
    const client = await loginAs(baseline.users.acmeBuyer.email, 'portal');
    const response = await client.get(INTERNAL_ADMIN_ROUTE);

    expect(response.status).toBe(403);
    expect(response.body.error.message).toMatch(/not available to customer accounts/i);
  });

  it('denies an internal session access to the portal namespace', async () => {
    const client = await loginAs(baseline.users.rep.email);
    // Any authenticated route under /api/portal must refuse an internal session.
    const response = await client.get('/api/portal/anything');

    expect(response.status).toBe(403);
    expect(response.body.error.message).toMatch(/only available to customer accounts/i);
  });

  it('still lets a customer read its own profile', async () => {
    const client = await loginAs(baseline.users.acmeBuyer.email, 'portal');
    const response = await client.get('/api/auth/me');

    expect(response.status).toBe(200);
    expect(response.body.data.customerId).toBe(baseline.acmeId);
  });

  it('binds each customer session to exactly one customer', async () => {
    const acme = await loginAs(baseline.users.acmeBuyer.email, 'portal');
    const globex = await loginAs(baseline.users.globexBuyer.email, 'portal');

    const acmeProfile = await acme.get('/api/auth/me');
    const globexProfile = await globex.get('/api/auth/me');

    expect(acmeProfile.body.data.customerId).toBe(baseline.acmeId);
    expect(globexProfile.body.data.customerId).toBe(baseline.globexId);
    expect(acmeProfile.body.data.customerId).not.toBe(globexProfile.body.data.customerId);
  });
});

describe('database-enforced portal scope', () => {
  it('refuses a CUSTOMER user with no customer link', async () => {
    await expect(
      prisma.user.create({
        data: {
          email: 'orphan@test.local',
          name: 'Orphan',
          role: Role.CUSTOMER,
          passwordHash: 'x',
        },
      }),
    ).rejects.toThrow(/users_customer_scope_check/);
  });

  it('refuses an internal user linked to a customer', async () => {
    await expect(
      prisma.user.create({
        data: {
          email: 'confused@test.local',
          name: 'Confused',
          role: Role.SALES_REP,
          customerId: baseline.acmeId,
          passwordHash: 'x',
        },
      }),
    ).rejects.toThrow(/users_customer_scope_check/);
  });
});
