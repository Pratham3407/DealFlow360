/** Auth + identity routes. */

import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import {
  createUser,
  listUsers,
  loginWithMagicLink,
  loginWithPassword,
  me,
  registerCustomer,
  setUserActive,
  setUserPassword,
} from '../auth/auth.service.js';
import { createPortalMagicLink } from '../domain/portal/portal.service.js';
import { authenticate, requireInternal, toAsync, actorFromRequest } from '../middleware/auth.js';
import { internalOnly, validateBody } from './helpers.js';
import { ROLES } from '@dealflow/shared';

export const authRouter = Router();

/**
 * A password anyone can set has to be worth something: length is the only
 * requirement that reliably helps, so it is the one enforced, with a character
 * mix asked for rather than a menu of ambiguous rules.
 */
const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), 'Password must contain a letter and a number');

/**
 * Per the spec, internal user creation is part of signup rather than a separate
 * admin endpoint. `role` is included in the body, which is what makes this a
 * privileged route: only an admin can sign up other internal users or portal
 * users, and the service enforces the customer scope rule for `CUSTOMER`.
 */
authRouter.post(
  '/signup',
  internalOnly('ADMIN'),
  validateBody(
    z.object({
      email: z.string().email(),
      name: z.string().min(1),
      role: z.enum(ROLES),
      password: passwordSchema.optional(),
      customerId: z.string().optional(),
    }),
  ),
  toAsync(async (req, res) => {
    const user = await createUser(db, { ...req.body, email: req.body.email.trim().toLowerCase() }, actorFromRequest(req));
    res.status(201).json({ user });
  }),
);

authRouter.post('/login', toAsync(async (req, res) => {
  const { email, password } = req.body;
  const result = await loginWithPassword(db, String(email ?? '').trim().toLowerCase(), String(password ?? ''));
  res.json(result);
}));

/**
 * Public self-registration for a buying organisation.
 *
 * Unauthenticated by design — a prospective customer has no account yet. The
 * body cannot name a role, a tier or an existing customer, so the worst a caller
 * can do is create a new lowest-tier organisation owning nothing. See
 * `registerCustomer` for why joining an existing customer is excluded.
 */
authRouter.post(
  '/register',
  validateBody(
    z.object({
      companyName: z.string().min(2).max(120),
      contactName: z.string().min(2).max(120),
      email: z.string().email(),
      password: passwordSchema,
    }),
  ),
  toAsync(async (req, res) => {
    const result = await registerCustomer(db, req.body);
    res.status(201).json(result);
  }),
);

/** Internal user directory, for the admin console. */
authRouter.get(
  '/users',
  internalOnly('ADMIN'),
  toAsync(async (req, res) => {
    const role = typeof req.query.role === 'string' && req.query.role !== '' ? req.query.role : undefined;
    res.json({
      data: await listUsers(db, {
        role: role as never,
        includeInactive: req.query.includeInactive === 'true',
      }),
    });
  }),
);

authRouter.patch(
  '/users/:id/active',
  internalOnly('ADMIN'),
  validateBody(z.object({ active: z.boolean() })),
  toAsync(async (req, res) => {
    const user = await db.transaction((tx) =>
      setUserActive(tx, String(req.params.id), req.body.active, actorFromRequest(req)),
    );
    res.json({ user });
  }),
);

authRouter.patch(
  '/users/:id/password',
  internalOnly('ADMIN'),
  validateBody(z.object({ password: passwordSchema })),
  toAsync(async (req, res) => {
    await db.transaction((tx) =>
      setUserPassword(tx, String(req.params.id), req.body.password, actorFromRequest(req)),
    );
    res.json({ ok: true });
  }),
);

/**
 * Stateless logout — JWTs are not server-tracked. The client drops the token;
 * the route exists to mirror the spec and so a future cookie-based session can
 * be revoked server-side without changing the contract.
 */
authRouter.post('/logout', toAsync(async (_req, res) => {
  res.json({ ok: true });
}));

authRouter.get('/me', authenticate(), toAsync(async (req, res) => {
  const token = req.headers.authorization!.slice('Bearer '.length);
  res.json(await me(db, token));
}));

/** Issue a portal magic link for a customer's portal user. */
authRouter.post(
  '/portal/magic-link',
  internalOnly('SALES_REP', 'SALES_MANAGER', 'ADMIN'),
  validateBody(
    z.object({
      customerId: z.string().min(1),
      userId: z.string().min(1),
      quotationId: z.string().optional(),
    }),
  ),
  toAsync(async (req, res) => {
    const result = await createPortalMagicLink(db, req.body, actorFromRequest(req));
    res.json(result);
  }),
);

/**
 * Spec names this `portal/auth/login`; mounted at `/api/portal/auth` so the path
 * reads naturally and `requireInternal` middleware above cannot intercept it
 * (auth/login is open to everyone).
 */
export const portalAuthRouter = Router();

portalAuthRouter.post('/login', validateBody(z.object({ token: z.string().min(1) })), toAsync(async (req, res) => {
  const result = await loginWithMagicLink(db, req.body.token);
  res.json(result);
}));