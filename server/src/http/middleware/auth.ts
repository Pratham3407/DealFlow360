import type { Request, RequestHandler } from 'express';
import { Role } from '../../generated/prisma/enums';
import { ForbiddenError, NotFoundError, UnauthenticatedError } from '../errors';
import { readSessionCookie } from '../../modules/auth/cookies';
import { resolveSession } from '../../modules/auth/sessionService';
import { can, isInternalRole, type Capability } from '../../modules/auth/permissions';
import type { AuthContext } from '../types';

/**
 * Resolve the session cookie into `req.auth`, or reject with 401.
 *
 * The identity is loaded from the database on every request, so nothing the
 * client sends - header, body field or cookie other than the opaque token - can
 * influence who the server thinks it is talking to.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = readSessionCookie(req);
  if (!token) {
    next(new UnauthenticatedError());
    return;
  }

  const auth = await resolveSession(token);
  if (!auth) {
    next(new UnauthenticatedError('Your session has expired. Please sign in again.'));
    return;
  }

  req.auth = auth;
  next();
};

/** Narrow `req.auth` after `requireAuth`; throws if the middleware was skipped. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) {
    // A programming error, not a client error: a guarded route was registered
    // without requireAuth in front of it.
    throw new UnauthenticatedError();
  }
  return req.auth;
}

export function requireRole(...roles: readonly Role[]): RequestHandler {
  return (req, _res, next) => {
    const auth = authOf(req);
    if (!roles.includes(auth.role)) {
      next(new ForbiddenError('Your role does not permit this action'));
      return;
    }
    next();
  };
}

export function requireCapability(...capabilities: readonly Capability[]): RequestHandler {
  return (req, _res, next) => {
    const auth = authOf(req);
    const missing = capabilities.filter((capability) => !can(auth.role, capability));
    if (missing.length > 0) {
      next(new ForbiddenError('Your role does not permit this action'));
      return;
    }
    next();
  };
}

/**
 * Passes when the role holds at least one of the capabilities.
 *
 * Used where two roles reach the same resource for different reasons - a customer
 * tier is customer master data to an admin and a discount ceiling to a sales
 * manager - and the handler then narrows which fields each may actually change.
 */
export function requireAnyCapability(...capabilities: readonly Capability[]): RequestHandler {
  return (req, _res, next) => {
    const auth = authOf(req);
    if (!capabilities.some((capability) => can(auth.role, capability))) {
      next(new ForbiddenError('Your role does not permit this action'));
      return;
    }
    next();
  };
}

/** Throw unless the role holds the capability. For per-field checks inside a handler. */
export function assertCapability(auth: AuthContext, capability: Capability, message?: string): void {
  if (!can(auth.role, capability)) {
    throw new ForbiddenError(message ?? 'Your role does not permit this action');
  }
}

/**
 * Boundary between the internal workspace and the customer portal.
 *
 * Mounted in front of every internal router, so a customer session is refused at
 * the namespace rather than relying on each handler to remember
 * (docs/PRD.md 15: the portal is a real restricted view, not a relabelled
 * internal screen).
 */
export const requireInternal: RequestHandler = (req, _res, next) => {
  const auth = authOf(req);
  if (!isInternalRole(auth.role)) {
    next(new ForbiddenError('This area is not available to customer accounts'));
    return;
  }
  next();
};

/**
 * Portal boundary. Guarantees a CUSTOMER session bound to a customer, so portal
 * handlers can scope every query by `auth.customerId` without null checks.
 */
export const requireCustomer: RequestHandler = (req, _res, next) => {
  const auth = authOf(req);
  if (auth.role !== Role.CUSTOMER || !auth.customerId) {
    next(new ForbiddenError('This area is only available to customer accounts'));
    return;
  }
  next();
};

/**
 * Assert that a record belongs to the authenticated customer.
 *
 * The single check behind docs/RBAC.md "Portal isolation" and
 * docs/ACCEPTANCE_TESTS.md AT-02. Reports 404 rather than 403 on purpose: a 403
 * would confirm that another customer's quotation exists, letting an id be
 * probed. Internal roles are unaffected - their access is governed by
 * capabilities instead.
 */
export function assertCustomerOwnership(auth: AuthContext, ownerCustomerId: string): void {
  if (auth.role !== Role.CUSTOMER) return;
  if (auth.customerId !== ownerCustomerId) {
    throw new NotFoundError();
  }
}
