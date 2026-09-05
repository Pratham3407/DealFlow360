/**
 * One-time bootstrap for the whole suite: recreate `dealflow360_test` from
 * migrations.
 *
 * Schema is built once here; row state is reset per test file by `resetDatabase()`
 * in `tests/helpers/db.ts`. Splitting it that way keeps the expensive step (DDL)
 * out of the per-file path while still giving each file a known dataset.
 */

process.env.NODE_ENV = 'test';

export async function setup(): Promise<void> {
  const { dropPublicSchema } = await import('../src/db/drop.js');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const { db, closeDatabase } = await import('../src/db/client.js');
  const { resolve } = await import('node:path');

  await dropPublicSchema();
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
  await closeDatabase();
}