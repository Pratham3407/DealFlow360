import { Role } from '../../src/generated/prisma/enums';
import { prisma } from '../../src/db/prisma';
import { hashPassword } from '../../src/modules/auth/password';

export const TEST_PASSWORD = 'TestPassw0rd!2026';

/**
 * scrypt is intentionally slow, so the fixture password is hashed once per
 * worker and reused. Without this, seeding six users per test dominates runtime.
 */
let passwordHashPromise: Promise<string> | null = null;
function testPasswordHash(): Promise<string> {
  passwordHashPromise ??= hashPassword(TEST_PASSWORD);
  return passwordHashPromise;
}

export interface Baseline {
  tierGoldId: string;
  tierSilverId: string;
  acmeId: string;
  globexId: string;
  users: {
    admin: { id: string; email: string };
    rep: { id: string; email: string };
    manager: { id: string; email: string };
    finance: { id: string; email: string };
    acmeBuyer: { id: string; email: string };
    globexBuyer: { id: string; email: string };
    inactiveRep: { id: string; email: string };
  };
}

/**
 * Minimal fixture set for authentication, RBAC and portal-isolation tests: one
 * user per role, two customers so isolation has a genuine "other party", and a
 * deactivated account.
 *
 * Deliberately not the demo seed - tests should not break when demo data is
 * tuned for a presentation.
 */
export async function seedBaseline(): Promise<Baseline> {
  const passwordHash = await testPasswordHash();

  const [gold, silver] = await Promise.all([
    prisma.customerTier.create({
      data: { code: 'GOLD', name: 'Gold', defaultDiscountCeiling: '15.000' },
    }),
    prisma.customerTier.create({
      data: { code: 'SILVER', name: 'Silver', defaultDiscountCeiling: '10.000' },
    }),
  ]);

  const [acme, globex] = await Promise.all([
    prisma.customer.create({ data: { code: 'ACME', name: 'Acme Corp', tierId: gold.id } }),
    prisma.customer.create({
      data: { code: 'GLOBEX', name: 'Globex Industries', tierId: silver.id },
    }),
  ]);

  const create = (
    email: string,
    name: string,
    role: Role,
    customerId: string | null = null,
    active = true,
  ) =>
    prisma.user.create({
      data: { email, name, role, customerId, passwordHash, active },
      select: { id: true, email: true },
    });

  const [admin, rep, manager, finance, acmeBuyer, globexBuyer, inactiveRep] = await Promise.all([
    create('admin@test.local', 'Test Admin', Role.ADMIN),
    create('rep@test.local', 'Test Rep', Role.SALES_REP),
    create('manager@test.local', 'Test Manager', Role.SALES_MANAGER),
    create('finance@test.local', 'Test Finance', Role.FINANCE_OPERATIONS),
    create('buyer@acme.test.local', 'Acme Buyer', Role.CUSTOMER, acme.id),
    create('buyer@globex.test.local', 'Globex Buyer', Role.CUSTOMER, globex.id),
    create('inactive@test.local', 'Inactive Rep', Role.SALES_REP, null, false),
  ]);

  return {
    tierGoldId: gold.id,
    tierSilverId: silver.id,
    acmeId: acme.id,
    globexId: globex.id,
    users: { admin, rep, manager, finance, acmeBuyer, globexBuyer, inactiveRep },
  };
}
