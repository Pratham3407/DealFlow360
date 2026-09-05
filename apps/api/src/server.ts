/** Process entry. */

import { buildApp } from './http/app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';

const app = buildApp();

const server = app.listen(env.PORT, () => {
  logger.info('DealFlow360 API listening', { port: env.PORT, env: env.NODE_ENV });
});

// Deal-health sweep timer (disabled in test environment).
if (env.DEAL_HEALTH_SWEEP_MINUTES > 0) {
  import('./domain/dealhealth/scheduler.js').then(({ startScheduler }) => startScheduler());
}

function shutdown(signal: string) {
  logger.info('Shutting down', { signal });
  server.close(() => {
    import('./db/client.js').then(({ closeDatabase }) => closeDatabase()).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));