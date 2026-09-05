/** Express application assembly. */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from '../config/env.js';
import { authRouter, portalAuthRouter } from './auth.routes.js';
import { quotationRouter, approvalRouter } from './quotation.routes.js';
import {
  orderFulfillmentRouter,
  backorderRouter,
  stockRouter,
} from './fulfillment.routes.js';
import {
  orderBillingRouter,
  paymentRouter,
  subscriptionRouter,
  creditNoteRouter,
} from './billing.routes.js';
import { portalRouter } from './portal.routes.js';
import { dealHealthRouter, reportingRouter } from './reporting.routes.js';
import { masterDataRouter } from './masterdata.routes.js';
import { errorHandler, notFoundHandler } from '../middleware/error.js';

/**
 * Mounting rules:
 *  - Routers that already declare per-route guards go at their path prefix.
 *  - `masterDataRouter` declares per-route guards too; mounted last at `/api`
 *    so its 404s on unknown entities fall through cleanly.
 *  - Mount order matters: more-specific paths must come before the catch-all
 *    `/api` master-data mount, otherwise `/api/portal/quotes` would match a
 *    `/api/*` route first.
 */
export function buildApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'dealflow360-api', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/portal/auth', portalAuthRouter);
  app.use('/api/quotations', quotationRouter);
  app.use('/api/approvals', approvalRouter);
  app.use('/api/orders', orderFulfillmentRouter);
  app.use('/api/orders', orderBillingRouter);
  app.use('/api/backorders', backorderRouter);
  app.use('/api/stock', stockRouter);
  app.use('/api/payments', paymentRouter);
  app.use('/api/subscriptions', subscriptionRouter);
  app.use('/api/credit-notes', creditNoteRouter);
  app.use('/api/portal', portalRouter);
  app.use('/api/deal-health', dealHealthRouter);
  app.use('/api/reports', reportingRouter);
  app.use('/api', masterDataRouter);

  app.use(notFoundHandler());
  app.use(errorHandler());

  return app;
}