import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { prisma, type Db } from '../../db/prisma';
import type { AuthContext } from '../../http/types';

/** 256 bits of entropy - the token is the only credential the cookie carries. */
const TOKEN_BYTES = 32;

/**
 * Write `last_seen_at` at most this often. Session activity is useful for
 * operations, but a write on every request would be pure amplification.
 */
const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * The stored value is a SHA-256 digest of the token, not the token itself. A
 * database leak therefore does not yield usable sessions. A slow KDF is
 * unnecessary here because the input is already high-entropy random, unlike a
 * password.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(
  db: Db,
  input: { userId: string; ip?: string | null; userAgent?: string | null },
): Promise<CreatedSession> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);

  await db.session.create({
    data: {
      userId: input.userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 512) ?? null,
    },
  });

  return { token, expiresAt };
}

/**
 * Resolve a raw cookie token to a server-owned identity.
 *
 * Role and customerId come from the `users` row on every call, so a change to a
 * user's role or a deactivation takes effect on the next request rather than
 * when a token happens to expire.
 *
 * Returns null for absent, unknown, expired or deactivated sessions, and
 * opportunistically deletes expired rows it encounters.
 */
export async function resolveSession(token: string): Promise<AuthContext | null> {
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: { id: true, email: true, name: true, role: true, customerId: true, active: true },
      },
    },
  });

  if (!session) return null;

  // The lookup was by unique digest, so this is belt-and-braces against a
  // partial-match style bug rather than a live attack surface.
  const expectedHash = Buffer.from(session.tokenHash, 'utf8');
  const actualHash = Buffer.from(tokenHash, 'utf8');
  if (expectedHash.length !== actualHash.length || !timingSafeEqual(expectedHash, actualHash)) {
    return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  if (!session.user.active) return null;

  if (Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_WRITE_INTERVAL_MS) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  return {
    sessionId: session.id,
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    customerId: session.user.customerId,
  };
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.session.deleteMany({ where: { id: sessionId } });
}

/** Used when a password changes or an account is deactivated. */
export async function revokeAllSessionsForUser(db: Db, userId: string): Promise<number> {
  const result = await db.session.deleteMany({ where: { userId } });
  return result.count;
}

export async function purgeExpiredSessions(db: Db = prisma): Promise<number> {
  const result = await db.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return result.count;
}
