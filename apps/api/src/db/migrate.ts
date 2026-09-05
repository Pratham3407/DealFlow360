/**
 * Applies pending SQL migrations.
 *
 * Run through the app's own client rather than `drizzle-kit migrate` so migrations
 * use the same validated `DATABASE_URL` the server will use — a mismatch there is
 * the classic "migrated the wrong database" failure.
 */

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, db } from './client.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

async function main(): Promise<void> {
  logger.info('Applying migrations', { database: redact(env.DATABASE_URL), migrationsFolder });
  await migrate(db, { migrationsFolder });
  logger.info('Migrations applied');
}

function redact(url: string): string {
  return url.replace(/:\/\/([^:@/]+)(:[^@/]*)?@/, '://$1:***@');
}

main()
  .then(() => closeDatabase())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    logger.error('Migration failed', error);
    await closeDatabase().catch(() => undefined);
    process.exit(1);
  });
