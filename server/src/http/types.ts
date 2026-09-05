import type { Role } from '../generated/prisma/enums';

/**
 * Server-resolved identity for the current request.
 *
 * Every field here is read from the database on each request via the session
 * cookie. Nothing in it originates from the client, which is what makes
 * "never trust client-provided role or customer id" (AGENTS.md 6.12) true in
 * practice rather than aspirationally.
 */
export interface AuthContext {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  role: Role;
  /** Non-null exactly when role is CUSTOMER; enforced by a database constraint. */
  customerId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Present only after `requireAuth` has run. */
      auth?: AuthContext;
    }
  }
}

export {};
