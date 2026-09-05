import { Prisma } from '../../generated/prisma/client';
import type { Db } from '../../db/prisma';
import type { AuthContext } from '../../http/types';
import { AuditAction, recordAudit, type AuditEntity } from './auditService';

/**
 * Convert a database row to a JSON value suitable for an audit column.
 *
 * `Prisma.Decimal` serialises to a string and `Date` to an ISO timestamp, both of
 * which round-trip exactly - important because these values are the evidence of
 * what a figure used to be, and a float would quietly lose precision.
 */
export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Pick only the fields that actually changed, alongside their previous values.
 *
 * A configuration patch usually touches one or two columns; recording the whole
 * row twice would bury the change. Returns null when nothing differs, which lets
 * a caller skip a no-op audit entry.
 */
export function diffFields<T extends object>(
  before: T,
  after: T,
  ignore: readonly string[] = ['updatedAt'],
): { before: Prisma.InputJsonValue; after: Prisma.InputJsonValue } | null {
  const previousRow = before as Record<string, unknown>;
  const nextRow = after as Record<string, unknown>;
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};

  for (const key of Object.keys(nextRow)) {
    if (ignore.includes(key)) continue;
    const previous = previousRow[key];
    const next = nextRow[key];
    // String comparison handles Decimal and Date without special-casing either.
    if (JSON.stringify(previous ?? null) === JSON.stringify(next ?? null)) continue;
    changedBefore[key] = previous ?? null;
    changedAfter[key] = next ?? null;
  }

  if (Object.keys(changedAfter).length === 0) return null;
  return { before: toJsonValue(changedBefore), after: toJsonValue(changedAfter) };
}

interface ConfigAuditInput {
  actor: AuthContext;
  entityType: AuditEntity;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/**
 * Record a master-data change.
 *
 * All configuration writes share the CONFIGURATION_CHANGED action, with
 * `entityType` distinguishing what was touched - `AGENTS.md` §39 specifies this,
 * and it keeps "show me every configuration change last week" a single indexed
 * query rather than a list of action names that grows with the schema.
 *
 * Must be called with the same transaction client as the change itself so the
 * two commit together (`AGENTS.md` §25).
 */
export async function recordConfigChange(db: Db, input: ConfigAuditInput): Promise<void> {
  await recordAudit(db, {
    action: AuditAction.CONFIGURATION_CHANGED,
    entityType: input.entityType,
    entityId: input.entityId,
    actorUserId: input.actor.userId,
    actorRole: input.actor.role,
    oldValue: input.before === undefined ? null : toJsonValue(input.before),
    newValue: input.after === undefined ? null : toJsonValue(input.after),
    reason: input.reason ?? null,
  });
}
