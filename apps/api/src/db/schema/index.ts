/**
 * Schema barrel.
 *
 * Drizzle's relational query API needs the full table + relations graph in one
 * object, so everything is re-exported here and passed to `drizzle()` as the
 * schema. Import tables from `@/db/schema` rather than from the individual files
 * to keep call sites stable if a table moves between modules.
 */

export * from './enums.js';
export * from './identity.js';
export * from './catalog.js';
export * from './governance.js';
export * from './quotation.js';
export * from './inventory.js';
export * from './billing.js';
export * from './analytics.js';
