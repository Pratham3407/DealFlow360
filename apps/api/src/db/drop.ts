/**
 * Drops and recreates the schema, including Drizzle's migration journal.
 *
 * Used by `db:reset` and by the test bootstrap. Destructive by design and
 * therefore refuses to run against a database whose name does not look like a
 * DealFlow360 development or test database — the guard exists because a stray
 * `DATABASE_URL` in the shell is otherwise indistinguishable from an intentional
 * reset.
 *
 * The `drizzle` schema holds `__drizzle_migrations`. Dropping `public` alone would
 * leave that journal claiming every migration is already applied, so the following
 * `db:migrate` would be a silent no-op and leave an empty database behind.
 */

import { sql } from 'drizzle-orm';
import { closeDatabase, db } from './client.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

const ALLOWED_DATABASE_PATTERN = /^dealflow360(_test)?$/;

export async function dropPublicSchema(): Promise<void> {
  const databaseName = new URL(env.DATABASE_URL).pathname.replace(/^\//, '');

  if (!ALLOWED_DATABASE_PATTERN.test(databaseName)) {
    throw new Error(
      `Refusing to drop schema on database "${databaseName}". ` +
        'Only dealflow360 and dealflow360_test may be reset.',
    );
  }
  if (env.isProduction) {
    throw new Error('Refusing to drop schema with NODE_ENV=production.');
  }

  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  logger.info('Public schema and migration journal recreated', { database: databaseName });
}

const isEntrypoint = process.argv[1]?.endsWith('drop.ts') || process.argv[1]?.endsWith('drop.js');

if (isEntrypoint) {
  dropPublicSchema()
    .then(() => closeDatabase())
    .then(() => process.exit(0))
    .catch(async (error: unknown) => {
      logger.error('Schema drop failed', error);
      await closeDatabase().catch(() => undefined);
      process.exit(1);
    });
}
