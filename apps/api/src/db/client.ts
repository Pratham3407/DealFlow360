/**
 * Database client.
 *
 * A single pooled `node-postgres` connection shared by the process. The schema is
 * passed to `drizzle()` so the relational query API (`db.query.quotations.findFirst`
 * with nested `with`) is available — quotations are almost always read together
 * with their lines, approvals and negotiation history.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config/env.js';
import * as schema from './schema/index.js';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // The demo workload is small; a modest ceiling keeps `pg_stat_activity` readable
  // and surfaces connection leaks quickly instead of masking them.
  max: env.isTest ? 5 : 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;

export type Schema = typeof schema;

/**
 * A transaction handle.
 *
 * Every write path that touches more than one table takes a `DbExecutor` so it can
 * run either standalone or enlisted in a caller's transaction. This is what makes
 * "confirm quote → create approval → write audit event" atomic, which PRD §22
 * (Consistency) requires.
 */
export type Transaction = PgTransaction<
  NodePgQueryResultHKT,
  Schema,
  ExtractTablesWithRelations<Schema>
>;

export type DbExecutor = Database | Transaction;

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

export { schema };
