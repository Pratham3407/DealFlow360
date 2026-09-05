/**
 * Audit service.
 *
 * Everything logs through here so that "every meaningful commercial decision
 * produces an audit event" (AGENT_INSTRUCTIONS.md §8) is one call, not a
 * scatter of insert statements. The database trigger in
 * `drizzle/0001_audit_append_only_triggers.sql` enforces append-only.
 *
 * `actor` is usually resolved by middleware; services pass it explicitly so a
 * background sweep (no HTTP request) can still attribute its events.
 */

import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { auditLogs } from '@/db/schema/index.js';
import type { AuditAction, AuditEntityType, Role } from '@dealflow/shared';
import type { DbExecutor } from '@/db/client.js';

export interface AuditActor {
  userId?: string;
  role?: Role;
  label?: string;
  ipAddress?: string;
}

export interface AuditEntryOptions extends AuditActor {
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  quotationId?: string;
  quotationVersion?: number;
}

function serialize(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(
    JSON.stringify(value, (_key, inner) => (inner instanceof Date ? inner.toISOString() : inner)),
  );
}

export async function writeAudit(exec: DbExecutor, entry: AuditEntryOptions): Promise<void> {
  await exec.insert(auditLogs).values({
    actorUserId: entry.userId ?? null,
    actorRole: entry.role ?? null,
    actorLabel: entry.label ?? null,
    entityType: entry.entityType,
    /**
     * Store entity ids as text because some reference tables are keyed by
     * non-UUID values (e.g. `system_settings.key`). For UUID entities the id is
     * stored as a UUID string without needing the column to be a foreign key.
     */
    entityId: entry.entityId,
    action: entry.action,
    oldValue: entry.oldValue === undefined ? null : serialize(entry.oldValue),
    newValue: entry.newValue === undefined ? null : serialize(entry.newValue),
    reason: entry.reason ?? null,
    quotationId: entry.quotationId ?? null,
    quotationVersion: entry.quotationVersion ?? null,
    ipAddress: entry.ipAddress ?? null,
  });
}

export interface AuditQuery {
  entityType?: AuditEntityType;
  entityId?: string;
  quotationId?: string;
  actorUserId?: string;
  action?: AuditAction;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

/** Read the audit log. The append-only trigger keeps this append-only-safe. */
export async function queryAudit(exec: DbExecutor, query: AuditQuery = {}) {
  const conditions: SQL[] = [];

  if (query.entityType && query.entityId) {
    conditions.push(
      and(eq(auditLogs.entityType, query.entityType), eq(auditLogs.entityId, query.entityId)) as SQL,
    );
  }
  if (query.quotationId) conditions.push(eq(auditLogs.quotationId, query.quotationId));
  if (query.actorUserId) conditions.push(eq(auditLogs.actorUserId, query.actorUserId));
  if (query.action) conditions.push(eq(auditLogs.action, query.action));
  if (query.from) conditions.push(gte(auditLogs.createdAt, query.from));
  if (query.to) conditions.push(lte(auditLogs.createdAt, query.to));

  const rows = await exec
    .select()
    .from(auditLogs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(query.limit ?? 100)
    .offset(query.offset ?? 0);

  return rows;
}