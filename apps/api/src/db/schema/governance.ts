/**
 * Discount governance and system configuration.
 *
 * Everything the risk and approval engines read lives here as data. That is the
 * hard requirement from AGENT_INSTRUCTIONS.md §2 — no `if quoteId == "Q1001"`
 * branches — and from BUSINESS_RULES.md §4, "the thresholds belong in database
 * configuration".
 */

import { relations } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamps, updatedAt } from './_columns.js';
import { categories } from './catalog.js';
import { customerTiers, users } from './identity.js';
import { requiredApprovalLevelEnum } from './enums.js';

/**
 * A discount ceiling.
 *
 * Both scope columns are nullable, which yields four levels of specificity:
 *
 * | tier | category | meaning                                   |
 * |------|----------|-------------------------------------------|
 * | set  | set      | "Gold customers, Services: max 10%"       |
 * | null | set      | "Services: max 10%, any tier"              |
 * | set  | null     | "Gold customers: max 15%, any category"   |
 * | null | null     | global backstop                            |
 *
 * The resolver picks the most specific match, breaking ties on `priority`
 * (BUSINESS_RULES.md §1). Encoding this as nullable scopes rather than separate
 * "customer ceiling" and "category ceiling" tables is what lets a single query
 * answer "what is the ceiling for *this* line" and keeps mixed-category quotes
 * (PRD FR-3) working without special cases.
 */
export const discountRules = pgTable(
  'discount_rules',
  {
    id: primaryId(),
    name: text('name').notNull(),
    customerTierId: uuid('customer_tier_id').references(() => customerTiers.id, {
      onDelete: 'cascade',
    }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'cascade' }),
    maxDiscountBp: integer('max_discount_bp').notNull(),
    /** Higher wins when two rules are equally specific. */
    priority: integer('priority').notNull().default(0),
    active: boolean('active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('discount_rules_scope_unique').on(table.customerTierId, table.categoryId),
    index('discount_rules_tier_idx').on(table.customerTierId),
    index('discount_rules_category_idx').on(table.categoryId),
  ],
);

/**
 * Risk-score band → required approval level.
 *
 * `maxRiskBp` null means "and above", so the top band is open-ended. Bands are
 * expressed in the same basis-point unit as `quotations.risk_score_bp`; see
 * `src/domain/risk/risk-engine.ts` for the scoring model.
 */
export const approvalRules = pgTable(
  'approval_rules',
  {
    id: primaryId(),
    name: text('name').notNull(),
    minRiskBp: integer('min_risk_bp').notNull(),
    maxRiskBp: integer('max_risk_bp'),
    requiredLevel: requiredApprovalLevelEnum('required_level').notNull(),
    priority: integer('priority').notNull().default(0),
    active: boolean('active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [index('approval_rules_band_idx').on(table.minRiskBp, table.maxRiskBp)],
);

/**
 * Typed key/value configuration for engine tuning knobs.
 *
 * Used for the risk-blend weights, deal-health windows and proration defaults —
 * values that must be adjustable without a migration but do not warrant their own
 * table. Canonical keys and defaults are declared in
 * `src/domain/config/settings.ts`, which is also where reads are type-checked.
 */
export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  valueType: text('value_type').notNull().default('string'),
  group: text('group').notNull().default('general'),
  description: text('description'),
  updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

export const discountRulesRelations = relations(discountRules, ({ one }) => ({
  tier: one(customerTiers, {
    fields: [discountRules.customerTierId],
    references: [customerTiers.id],
  }),
  category: one(categories, { fields: [discountRules.categoryId], references: [categories.id] }),
}));

export const systemSettingsRelations = relations(systemSettings, ({ one }) => ({
  updatedBy: one(users, { fields: [systemSettings.updatedById], references: [users.id] }),
}));
