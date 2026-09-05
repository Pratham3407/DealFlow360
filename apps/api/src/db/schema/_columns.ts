/**
 * Shared column builders.
 *
 * `timestamp with time zone` everywhere: approval timing, stall detection and
 * proration all compare instants across requests, and a naive timestamp would
 * make those comparisons depend on the server's local offset.
 */

import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

export const primaryId = () => uuid('id').primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().default(sql`now()`);

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().default(sql`now()`);

export const timestamps = () => ({
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
