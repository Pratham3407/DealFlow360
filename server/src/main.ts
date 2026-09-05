import { createApp } from './app';
import { env } from './config/env';
import { prisma, disconnectPrisma } from './db/prisma';
import { logger } from './http/logger';
import { purgeExpiredSessions } from './modules/auth/sessionService';

/** Hourly sweep so the sessions table does not accumulate dead rows. */
const SESSION_PURGE_INTERVAL_MS = 60 * 60 * 1000;

async function start(): Promise<void> {
  // Fail fast on a bad connection string rather than at the first request.
  await prisma.$queryRaw`SELECT 1`;

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV },
      `DealFlow360 API listening on http://localhost:${env.PORT}`,
    );
  });

  const purgeTimer = setInterval(() => {
    void purgeExpiredSessions()
      .then((count) => {
        if (count > 0) logger.debug({ count }, 'purged expired sessions');
      })
      .catch((error: unknown) => logger.warn({ err: error }, 'session purge failed'));
  }, SESSION_PURGE_INTERVAL_MS);
  purgeTimer.unref();

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    clearInterval(purgeTimer);
    server.close((error) => {
      void (async () => {
        if (error) logger.error({ err: error }, 'error closing http server');
        await disconnectPrisma().catch((disconnectError: unknown) =>
          logger.error({ err: disconnectError }, 'error disconnecting prisma'),
        );
        process.exit(error ? 1 : 0);
      })();
    });

    // Do not let a hung connection block shutdown indefinitely.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

try {
  await start();
} catch (error) {
  logger.fatal({ err: error }, 'failed to start server');
  await disconnectPrisma().catch(() => undefined);
  process.exit(1);
}
