/**
 * Audit trail and deal-health events.
 *
 * `audit_logs` is append-only. That is enforced in the database by the
 * `audit_logs_append_only` trigger added in a follow-up migration, not merely by
 * convention in the service layer — PRD §20 and BUSINESS_RULES.md §11 both require
 * that approval history cannot be rewritten, and a service-layer promise is not a
 * guarantee when raw SQL and future code exist.
 */

import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './_columns.js';
import { users } from './identity.js';
import { quotations } from './quotation.js';
import { dealHealthSeverityEnum, dealHealthTypeEnum, roleEnum } from './enums.js';

/**
 * One immutable record of a meaningful commercial decision.
 *
 * The column set answers exactly the questions AGENT_INSTRUCTIONS.md §8 requires:
 * who (`actor_user_id`, `actor_role`), what (`action`, `entity_type`,
 * `entity_id`), when (`created_at`), why (`reason`), which quote version
 * (`quotation_id`, `quotation_version`) and the before/after values.
 *
 * `action` and `entity_type` are `text` rather than PostgreSQL enums: the audit
 * vocabulary grows with every feature, and the `AuditAction` union in
 * `@dealflow/shared` already makes an unknown action a compile error at the call
 * site. A database enum would add a migration per new event for no extra safety.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Snapshotted so the record survives a later role change or user deletion. */
    actorRole: roleEnum('actor_role'),
    actorLabel: text('actor_label'),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    reason: text('reason'),
    /** Denormalised so a quotation's full history is one indexed lookup. */
    quotationId: uuid('quotation_id').references(() => quotations.id, { onDelete: 'set null' }),
    quotationVersion: integer('quotation_version'),
    ipAddress: text('ip_address'),
    createdAt: timestamps().createdAt,
  },
  (table) => [
    index('audit_logs_entity_idx').on(table.entityType, table.entityId),
    index('audit_logs_quotation_idx').on(table.quotationId),
    index('audit_logs_created_idx').on(table.createdAt),
    index('audit_logs_action_idx').on(table.action),
  ],
);

/**
 * A deal-health finding (PRD §17).
 *
 * `fingerprint` makes the detector idempotent: a sweep that runs hourly must not
 * create a new STALLED row every hour for the same quotation. It encodes the
 * detector's inputs (for example the inactivity bucket), so a *materially*
 * different finding creates a new event while a repeat of the same finding does
 * not. `resolvedAt` closes an event when the underlying condition clears.
 */
export const dealHealthEvents = pgTable(
  'deal_health_events',
  {
    id: primaryId(),
    quotationId: uuid('quotation_id')
      .notNull()
      .references(() => quotations.id, { onDelete: 'cascade' }),
    type: dealHealthTypeEnum('type').notNull(),
    severity: dealHealthSeverityEnum('severity').notNull(),
    fingerprint: text('fingerprint').notNull(),
    title: text('title').notNull(),
    detail: text('detail').notNull(),
    metadata: jsonb('metadata'),
    /**
     * How many follow-ups have been logged against this alert.
     *
     * `nudgedAt` alone only records the most recent one, so a second follow-up
     * looked like it had done nothing. The count is what makes repeated chasing
     * visible, and it is what an escalation decision is actually based on.
     */
    nudgeCount: integer('nudge_count').notNull().default(0),
    nudgedAt: timestamp('nudged_at', { withTimezone: true, mode: 'date' }),
    nudgedById: uuid('nudged_by_id').references(() => users.id, { onDelete: 'set null' }),
    escalatedAt: timestamp('escalated_at', { withTimezone: true, mode: 'date' }),
    escalatedById: uuid('escalated_by_id').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('deal_health_events_unique').on(table.quotationId, table.type, table.fingerprint),
    index('deal_health_events_type_idx').on(table.type),
    index('deal_health_events_open_idx').on(table.resolvedAt),
  ],
);

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, { fields: [auditLogs.actorUserId], references: [users.id] }),
  quotation: one(quotations, { fields: [auditLogs.quotationId], references: [quotations.id] }),
}));

export const dealHealthEventsRelations = relations(dealHealthEvents, ({ one }) => ({
  quotation: one(quotations, {
    fields: [dealHealthEvents.quotationId],
    references: [quotations.id],
  }),
}));
