/** Route-level helpers shared by the routers. */

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { badRequest } from '../lib/errors.js';
import { authenticate, requireInternal, requirePortalCustomer } from '../middleware/auth.js';
import type { Role } from '@dealflow/shared';

/**
 * Guard chain for an internal-workspace route.
 *
 * Deliberately per-route rather than `router.use(...)`: Express runs router-level
 * middleware for *every* request that reaches the router, including paths the
 * router has no route for. A router mounted at a shared prefix such as `/api` with
 * a blanket `requireInternal()` therefore rejects requests belonging to a
 * different router mounted at the same prefix, and turns unknown paths into 403s
 * instead of 404s.
 */
export function internalOnly(...roles: Role[]): RequestHandler[] {
  return [authenticate(), requireInternal(...roles)];
}

/** Guard chain for a customer-portal route. */
export function portalOnly(): RequestHandler[] {
  return [authenticate(), requirePortalCustomer()];
}

/** Validate `req.body` against a Zod schema, erroring with a 400 before the handler runs. */
export function validateBody<T extends z.ZodType>(schema: T): RequestHandler {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const details: Record<string, unknown> = {};
      for (const issue of parsed.error.issues) {
        details[issue.path.join('.') || '_root'] = issue.message;
      }
      return next(badRequest('VALIDATION_ERROR', 'Request body failed validation', details));
    }
    req.body = parsed.data;
    next();
  };
}

export function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Map Express date query strings into Date objects. */
export function optionalDate(value: unknown): Date | undefined {
  if (!value || typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}