/**
 * Authentication + authorisation middleware.
 *
 * `authenticate` resolves the JWT into `req.user`. The role checks that follow
 * are the RBAC guard layer: the internal workspace is closed to portal users, and
 * portal routes re-derive the customer scope from the users row, never from the
 * request body (RBAC.md).
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { verifyAccessToken } from '../auth/jwt.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { INTERNAL_ROLES, type Role } from '@dealflow/shared';
import { db } from '../db/client.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: Role;
        customerId?: string | null;
      };
    }
  }
}

export function authenticate(): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return next(unauthorized());
    }
    let payload;
    try {
      payload = verifyAccessToken(header.slice('Bearer '.length));
    } catch (err) {
      return next(err);
    }

    try {
      const user = await db.query.users.findFirst({
        where: (t, { eq }) => eq(t.id, payload.sub),
        columns: { id: true, role: true, customerId: true, active: true },
      });
      if (!user) {
        return next(unauthorized('USER_NOT_FOUND', 'Session user no longer exists; please sign in again'));
      }
      if (!user.active) {
        return next(unauthorized('ACCOUNT_DISABLED', 'This account has been deactivated'));
      }

      req.user = {
        id: user.id,
        role: user.role,
        customerId: user.customerId ?? null,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Block portal users; optionally require exactly the given internal roles. */
export function requireInternal(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    const user = req.user;
    if (!user) return next(unauthorized());
    if (!INTERNAL_ROLES.includes(user.role)) {
      return next(forbidden('PORTAL_ONLY', 'This endpoint is for the internal workspace'));
    }
    if (roles.length > 0 && !roles.includes(user.role)) {
      return next(forbidden('ROLE_FORBIDDEN', `Requires one of the roles: ${roles.join(', ')}`));
    }
    next();
  };
}

/** For portal routes: ensure the authenticated session is a portal customer. */
export function requirePortalCustomer(): RequestHandler {
  return (req, _res, next) => {
    const user = req.user;
    if (!user) return next(unauthorized());
    if (user.role !== 'CUSTOMER' || !user.customerId) {
      return next(forbidden('CUSTOMER_ONLY', 'This endpoint is for portal customers'));
    }
    next();
  };
}

export function actorFromRequest(req: Request) {
  const user = req.user!;
  return {
    userId: user.id,
    role: user.role,
    ipAddress: req.ip,
  };
}

export function toAsync(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}