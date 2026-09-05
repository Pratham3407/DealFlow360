import { Role } from '../../generated/prisma/enums';
import { prisma } from '../../db/prisma';
import { ForbiddenError, UnauthenticatedError } from '../../http/errors';
import type { AuthContext } from '../../http/types';
import { AuditAction, AuditEntity, recordAudit } from '../audit/auditService';
import { hashPassword, needsRehash, verifyPassword } from './password';
import { capabilitiesFor, isInternalRole, type Capability } from './permissions';
import { createSession, revokeSession, type CreatedSession } from './sessionService';

export interface LoginRequest {
  email: string;
  password: string;
  ip: string | null;
  userAgent: string | null;
}

export interface LoginResult {
  session: CreatedSession;
  profile: AuthProfile;
}

export interface AuthProfile {
  id: string;
  email: string;
  name: string;
  role: Role;
  customerId: string | null;
  customerName: string | null;
  capabilities: Capability[];
}

/** Which surface the credentials were presented at. */
export type LoginSurface = 'INTERNAL' | 'PORTAL';

/**
 * Uniform failure for every rejected login.
 *
 * Wrong password, unknown address and deactivated account are indistinguishable
 * to the caller, so the endpoint cannot be used to enumerate accounts.
 */
function invalidCredentials(): UnauthenticatedError {
  return new UnauthenticatedError('Invalid email or password');
}

/**
 * A dummy verification run when no user matches.
 *
 * Without it, a missing account would return in microseconds while a real one
 * takes as long as scrypt does, which leaks account existence through timing.
 * The hash is a real scrypt hash of a random string, so the work performed
 * matches the genuine path.
 */
const DUMMY_HASH_PROMISE = hashPassword('login-timing-equaliser');

async function equaliseTiming(password: string): Promise<void> {
  await verifyPassword(password, await DUMMY_HASH_PROMISE);
}

export async function login(request: LoginRequest, surface: LoginSurface): Promise<LoginResult> {
  const email = request.email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email },
    include: { customer: { select: { id: true, name: true, active: true } } },
  });

  if (!user) {
    await equaliseTiming(request.password);
    await recordAudit(prisma, {
      action: AuditAction.USER_LOGIN_FAILED,
      entityType: AuditEntity.USER,
      entityId: email,
      newValue: { email, surface, reason: 'UNKNOWN_EMAIL' },
      ip: request.ip,
    });
    throw invalidCredentials();
  }

  const passwordMatches = await verifyPassword(request.password, user.passwordHash);

  if (!passwordMatches || !user.active) {
    await recordAudit(prisma, {
      action: AuditAction.USER_LOGIN_FAILED,
      entityType: AuditEntity.USER,
      entityId: user.id,
      actorUserId: user.id,
      actorRole: user.role,
      newValue: {
        email,
        surface,
        reason: !passwordMatches ? 'BAD_PASSWORD' : 'ACCOUNT_INACTIVE',
      },
      ip: request.ip,
    });
    throw invalidCredentials();
  }

  // Surface isolation: the portal login endpoint issues customer sessions only,
  // and the internal endpoint refuses customer credentials. Sharing one session
  // table is fine because authorization is by role, but keeping the entry points
  // distinct stops a customer credential from ever producing a session that the
  // internal UI would render (docs/PRD.md 15).
  const surfaceMismatch =
    surface === 'PORTAL' ? isInternalRole(user.role) : user.role === Role.CUSTOMER;

  if (surfaceMismatch) {
    await recordAudit(prisma, {
      action: AuditAction.USER_LOGIN_FAILED,
      entityType: AuditEntity.USER,
      entityId: user.id,
      actorUserId: user.id,
      actorRole: user.role,
      newValue: { email, surface, reason: 'WRONG_LOGIN_SURFACE' },
      ip: request.ip,
    });
    throw new ForbiddenError(
      surface === 'PORTAL'
        ? 'Internal accounts must sign in through the workspace, not the customer portal'
        : 'Customer accounts must sign in through the customer portal',
    );
  }

  if (user.role === Role.CUSTOMER && user.customer && !user.customer.active) {
    await recordAudit(prisma, {
      action: AuditAction.USER_LOGIN_FAILED,
      entityType: AuditEntity.USER,
      entityId: user.id,
      actorUserId: user.id,
      actorRole: user.role,
      newValue: { email, surface, reason: 'CUSTOMER_INACTIVE' },
      ip: request.ip,
    });
    throw invalidCredentials();
  }

  // Opportunistic upgrade if the stored hash predates the current cost policy.
  if (needsRehash(user.passwordHash)) {
    const upgraded = await hashPassword(request.password);
    await prisma.user
      .update({ where: { id: user.id }, data: { passwordHash: upgraded } })
      .catch(() => undefined);
  }

  const session = await prisma.$transaction(async (tx) => {
    const created = await createSession(tx, {
      userId: user.id,
      ip: request.ip,
      userAgent: request.userAgent,
    });

    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    await recordAudit(tx, {
      action: AuditAction.USER_LOGGED_IN,
      entityType: AuditEntity.USER,
      entityId: user.id,
      actorUserId: user.id,
      actorRole: user.role,
      newValue: { email: user.email, surface },
      ip: request.ip,
    });

    return created;
  });

  return {
    session,
    profile: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      customerId: user.customerId,
      customerName: user.customer?.name ?? null,
      capabilities: capabilitiesFor(user.role),
    },
  };
}

export async function logout(auth: AuthContext, ip: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await revokeSession(tx, auth.sessionId);
    await recordAudit(tx, {
      action: AuditAction.USER_LOGGED_OUT,
      entityType: AuditEntity.USER,
      entityId: auth.userId,
      actorUserId: auth.userId,
      actorRole: auth.role,
      ip,
    });
  });
}

/**
 * The authenticated profile.
 *
 * Read fresh from the database rather than echoed from the session, so a role
 * change is reflected immediately.
 */
export async function currentProfile(auth: AuthContext): Promise<AuthProfile> {
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    include: { customer: { select: { name: true } } },
  });

  if (!user || !user.active) throw new UnauthenticatedError();

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    customerId: user.customerId,
    customerName: user.customer?.name ?? null,
    capabilities: capabilitiesFor(user.role),
  };
}
