/**
 * Auth service: signup, email/password login, magic-link redeem, "me".
 *
 * Passwords are hashed with bcrypt (cost from `BCRYPT_ROUNDS`). The user identity
 * that matters for authorisation lives in the `users` row; the JWT stores only a
 * `sub` (user id), `role` and (for portal) the `customerId`. Portal isolation is
 * re-derived from the users row on every authenticated request.
 */

import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { DbExecutor } from '@/db/client.js';
import { customers, magicLinkTokens, users } from '@/db/schema/index.js';
import { env } from '@/config/env.js';
import { badRequest, unauthorized, conflict, notFound } from '@/lib/errors.js';
import { writeAudit, type AuditActor } from '../domain/audit/audit.service.js';
import { signAccessToken, verifyAccessToken } from './jwt.js';
import type { Role } from '@dealflow/shared';

export type AuthActor = AuditActor;

export const AUTH_ACTOR: AuthActor = {
  userId: undefined,
  role: undefined,
  label: 'system',
};

function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Strip the credential before a user row leaves the service.
 *
 * The bcrypt hash has no business in an HTTP response — not even the owner's own.
 * It would otherwise reach browser devtools, any logging proxy, and in the case of
 * `registerCustomer` an entirely unauthenticated caller.
 */
export type PublicUser = Omit<typeof users.$inferSelect, 'passwordHash'>;

function toPublicUser<T extends { passwordHash: string | null }>(user: T): Omit<T, 'passwordHash'> {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

async function assertUniqueEmail(exec: DbExecutor, email: string) {
  const existing = await exec.query.users.findFirst({ where: (t, { eq }) => eq(t.email, email) });
  if (existing) throw conflict('EMAIL_EXISTS', 'A user with this email already exists');
}

/** Create an internal (or portal) user. */
export async function createUser(
  exec: DbExecutor,
  input: {
    email: string;
    name: string;
    role: Role;
    password?: string;
    customerId?: string;
  },
  actor: AuthActor = AUTH_ACTOR,
) {
  await assertUniqueEmail(exec, input.email);

  if (input.role === 'CUSTOMER') {
    if (!input.customerId) throw badRequest('CUSTOMER_REQUIRED', 'A customer must be linked to a customer');
  } else {
    if (input.customerId) throw badRequest('INTERNAL_NOT_CUSTOMER', 'Internal users cannot carry a customer scope');
    if (!input.password) throw badRequest('PASSWORD_REQUIRED', 'Internal users require a password');
  }

  const passwordHash = input.password ? await bcrypt.hash(input.password, env.BCRYPT_ROUNDS) : null;

  const [user] = await exec
    .insert(users)
    .values({
      email: input.email,
      name: input.name,
      role: input.role,
      passwordHash,
      customerId: input.customerId ?? null,
      active: true,
    })
    .returning();
  if (!user) throw conflict('USER_CREATE_FAILED', 'Could not create user');

  await writeAudit(exec, {
    ...actor,
    entityType: 'USER',
    entityId: user.id,
    action: 'CONFIG_CHANGED',
    newValue: { email: user.email, role: user.role },
    reason: 'User created',
  });

  return toPublicUser(user);
}

/**
 * Self-service registration for a new buying organisation.
 *
 * This is the only unauthenticated write in the system, so the trust boundary is
 * deliberately narrow: the caller chooses their company name and their own
 * credentials, and nothing else. Role is forced to `CUSTOMER`, the tier is the
 * lowest-ranked one rather than anything the caller names, and the customer code
 * is derived server-side — a self-registered account can never grant itself a
 * better discount ceiling or attach itself to an existing organisation's
 * quotations.
 *
 * Joining an *existing* customer is intentionally not possible here; that needs a
 * rep to issue a magic link, because otherwise anyone could self-attach to
 * another company's account and read its pricing.
 */
export async function registerCustomer(
  exec: DbExecutor,
  input: { companyName: string; contactName: string; email: string; password: string },
) {
  const email = input.email.trim().toLowerCase();
  await assertUniqueEmail(exec, email);

  const tier = await exec.query.customerTiers.findFirst({
    orderBy: (t, { asc }) => [asc(t.rank)],
  });
  if (!tier) throw conflict('NO_TIER', 'No customer tier is configured; an admin must create one first');

  const code = await nextCustomerCode(exec, input.companyName);

  const [customer] = await exec
    .insert(customers)
    .values({
      code,
      name: input.companyName.trim(),
      tierId: tier.id,
      contactName: input.contactName.trim(),
      contactEmail: email,
      active: true,
    })
    .returning();
  if (!customer) throw conflict('CUSTOMER_CREATE_FAILED', 'Could not create the organisation');

  const user = await createUser(
    exec,
    {
      email,
      name: input.contactName.trim(),
      role: 'CUSTOMER',
      password: input.password,
      customerId: customer.id,
    },
    { userId: undefined, role: undefined, label: `self-registration:${email}` },
  );

  await writeAudit(exec, {
    userId: undefined,
    role: undefined,
    label: `self-registration:${email}`,
    entityType: 'CUSTOMER',
    entityId: customer.id,
    action: 'CONFIG_CHANGED',
    newValue: { code: customer.code, name: customer.name, tier: tier.name },
    reason: 'Organisation self-registered through the customer portal',
  });

  return {
    customer,
    user,
    token: signAccessToken({ sub: user.id, role: user.role, customerId: customer.id }),
  };
}

/**
 * Derive a unique customer code from the company name.
 *
 * Codes are user-visible on quotations, so a readable prefix beats a random
 * string; a numeric suffix is appended only when the prefix is already taken.
 */
async function nextCustomerCode(exec: DbExecutor, companyName: string): Promise<string> {
  const base =
    companyName
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8) || 'CUST';

  const existing = await exec.query.customers.findMany({ columns: { code: true } });
  const taken = new Set(existing.map((c) => c.code));
  if (!taken.has(base)) return base;

  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw conflict('CODE_EXHAUSTED', 'Could not derive a unique customer code');
}

/** Internal directory for the admin console. Portal users are listed per customer. */
export async function listUsers(exec: DbExecutor, filters: { role?: Role; includeInactive?: boolean } = {}) {
  const rows = await exec.query.users.findMany({
    where: (t, { and, eq }) =>
      and(
        filters.role ? eq(t.role, filters.role) : undefined,
        filters.includeInactive ? undefined : eq(t.active, true),
      ),
    orderBy: (t, { asc }) => [asc(t.role), asc(t.name)],
    with: { customer: true },
  });
  return rows.map(toPublicUser);
}

/** Enable or disable an account without deleting its audit history. */
export async function setUserActive(
  exec: DbExecutor,
  userId: string,
  active: boolean,
  actor: AuthActor,
) {
  const existing = await exec.query.users.findFirst({ where: (t, { eq }) => eq(t.id, userId) });
  if (!existing) throw notFound('USER_NOT_FOUND', 'User not found');
  if (existing.id === actor.userId && !active) {
    throw badRequest('CANNOT_DISABLE_SELF', 'You cannot disable your own account');
  }

  const [user] = await exec.update(users).set({ active }).where(eq(users.id, userId)).returning();

  await writeAudit(exec, {
    ...actor,
    entityType: 'USER',
    entityId: userId,
    action: 'CONFIG_CHANGED',
    oldValue: { active: existing.active },
    newValue: { active },
    reason: active ? 'Account re-enabled' : 'Account disabled',
  });

  return toPublicUser(user!);
}

/** Replace a user's password. Admin-driven reset; does not require the old one. */
export async function setUserPassword(
  exec: DbExecutor,
  userId: string,
  password: string,
  actor: AuthActor,
) {
  const existing = await exec.query.users.findFirst({ where: (t, { eq }) => eq(t.id, userId) });
  if (!existing) throw notFound('USER_NOT_FOUND', 'User not found');

  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  await exec.update(users).set({ passwordHash }).where(eq(users.id, userId));

  await writeAudit(exec, {
    ...actor,
    entityType: 'USER',
    entityId: userId,
    action: 'CONFIG_CHANGED',
    // The hash is never recorded, only the fact that it changed.
    newValue: { passwordReset: true },
    reason: 'Password reset by an administrator',
  });

  return { ok: true };
}

export async function loginWithPassword(exec: DbExecutor, email: string, password: string) {
  const user = await exec.query.users.findFirst({ where: (t, { eq }) => eq(t.email, email) });
  if (!user || !user.passwordHash || !user.active) throw unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');

  await exec.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  await writeAudit(exec, {
    ...AUTH_ACTOR,
    entityType: 'USER',
    entityId: user.id,
    action: 'LOGIN_SUCCEEDED',
    reason: `Authenticated with password as ${user.role}`,
  });

  return {
    user: toPublicUser(user),
    token: signAccessToken({
      sub: user.id,
      role: user.role,
      customerId: user.customerId ?? undefined,
    }),
  };
}

/** Redeem a magic link and return a fresh access token for the portal user. */
export async function loginWithMagicLink(exec: DbExecutor, token: string) {
  const row = await exec.query.magicLinkTokens.findFirst({
    where: (t, { eq }) => eq(t.tokenHash, hashToken(token)),
    with: { user: true },
  });
  if (!row) throw unauthorized('MAGIC_LINK_INVALID', 'Magic link is invalid');
  if (row.usedAt) throw unauthorized('MAGIC_LINK_USED', 'Magic link has already been used');
  if (row.expiresAt < new Date()) throw unauthorized('MAGIC_LINK_EXPIRED', 'Magic link has expired');
  if (!row.user.active) throw unauthorized('ACCOUNT_DISABLED', 'This account is disabled');
  if (!row.user.customerId) throw unauthorized('MAGIC_LINK_SCOPE', 'Portal link is not bound to a customer');

  await exec.update(magicLinkTokens).set({ usedAt: new Date() }).where(eq(magicLinkTokens.id, row.id));
  await exec.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.userId));

  await writeAudit(exec, {
    ...AUTH_ACTOR,
    entityType: 'USER',
    entityId: row.userId,
    action: 'LOGIN_SUCCEEDED',
    quotationId: row.quotationId ?? undefined,
    reason: 'Authenticated via magic link',
  });

  return {
    user: toPublicUser(row.user),
    token: signAccessToken({
      sub: row.user.id,
      role: row.user.role,
      customerId: row.user.customerId,
    }),
    deepLinkQuotationId: row.quotationId,
  };
}

export async function me(exec: DbExecutor, token: string) {
  const payload = verifyAccessToken(token);
  const user = await exec.query.users.findFirst({ where: (t, { eq }) => eq(t.id, payload.sub) });
  if (!user) throw unauthorized('USER_NOT_FOUND', 'User no longer exists');
  if (!user.active) throw unauthorized('ACCOUNT_DISABLED', 'This account is disabled');
  return { user: toPublicUser(user) };
}