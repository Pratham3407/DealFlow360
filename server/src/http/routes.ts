import { Router } from 'express';
import { prisma } from '../db/prisma';
import { requireAuth, requireCustomer, requireInternal } from './middleware/auth';
import { authRoutes, portalAuthRoutes } from '../modules/auth/authRoutes';
import { userRoutes } from '../modules/users/userRoutes';

/**
 * API surface.
 *
 * Three namespaces with different trust levels:
 *   /api/health, /api/auth/*      - unauthenticated or self-service
 *   /api/portal/*                 - customer sessions only, scoped by customer id
 *   everything else under /api    - internal roles only
 *
 * The internal and portal guards are mounted on the routers rather than repeated
 * per handler, so a future route cannot be added to the wrong side of the
 * boundary by omission (docs/PRD.md 15).
 */
export function buildApiRouter(): Router {
  const api = Router();

  api.get('/health', async (_req, res) => {
    // Report the database too: an API that answers while the database is down is
    // a misleading health signal.
    let database: 'up' | 'down' = 'up';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }

    res.status(database === 'up' ? 200 : 503).json({
      data: { status: database === 'up' ? 'ok' : 'degraded', database, time: new Date().toISOString() },
    });
  });

  api.use('/auth', authRoutes);

  const portal = Router();
  portal.use('/auth', portalAuthRoutes);
  portal.use(requireAuth, requireCustomer);
  // Customer-facing quotation and negotiation routes are added in a later slice.
  api.use('/portal', portal);

  const internal = Router();
  internal.use(requireAuth, requireInternal);
  internal.use('/users', userRoutes);
  api.use(internal);

  return api;
}
