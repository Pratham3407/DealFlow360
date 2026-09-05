import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './http/logger';
import { errorHandler, notFoundHandler } from './http/middleware/errorHandler';
import { buildApiRouter } from './http/routes';
import './http/types';

/**
 * Build the Express application.
 *
 * Separated from server startup so the integration tests can mount the real app
 * with supertest instead of exercising a second, test-only code path.
 */
export function createApp(): Express {
  const app = express();

  // Behind a reverse proxy in production, so req.ip reflects X-Forwarded-For.
  if (env.isProduction) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON only; a restrictive CSP belongs on the web app,
      // which is served separately.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  // Only enabled when the web app really is on another origin. In development
  // Vite proxies /api, so the browser sees one origin and CORS stays off.
  if (env.CORS_ORIGIN) {
    app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  }

  app.use(
    pinoHttp({
      logger,
      // Health checks would otherwise dominate the log.
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      customLogLevel: (_req, res, error) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  // Quotations with many lines are still small; a low cap limits the damage a
  // malformed or hostile request can do.
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  app.use('/api', buildApiRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
