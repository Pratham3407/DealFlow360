/**
 * Identity: internal users, portal users, customers and customer tiers.
 *
 * A portal user is a `users` row with role `CUSTOMER` and a non-null
 * `customer_id`. That single foreign key is what portal isolation is built on:
 * RBAC.md requires the server to verify `quotation.customer_id ==
 * authenticated_customer.id`, so the customer identity must come from the
 * authenticated user record and never from the request body.
 */

import { relations } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './_columns.js';
import { roleEnum } from './enums.js';

/**
 * Customer tier (Bronze / Silver / Gold in the seed set).
 *
 * `defaultDiscountCeilingBp` is the tier-wide ceiling used when no
 * category-specific `discount_rules` row applies (BUSINESS_RULES.md §1 fallback).
 * Stored in basis points: 15% = 1500.
 */
export const customerTiers = pgTable('customer_tiers', {
  id: primaryId(),
  name: text('name').notNull().unique(),
  /** Ordering only — higher rank = more commercially privileged tier. */
  rank: integer('rank').notNull().default(0),
  defaultDiscountCeilingBp: integer('default_discount_ceiling_bp').notNull(),
  description: text('description'),
  active: boolean('active').notNull().default(true),
  ...timestamps(),
});

export const customers = pgTable(
  'customers',
  {
    id: primaryId(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    tierId: uuid('tier_id')
      .notNull()
      .references(() => customerTiers.id, { onDelete: 'restrict' }),
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    billingAddress: text('billing_address'),
    /** Default payment terms in days, used to derive invoice due dates. */
    paymentTermsDays: integer('payment_terms_days').notNull().default(30),
    active: boolean('active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [index('customers_tier_idx').on(table.tierId)],
);

export const users = pgTable(
  'users',
  {
    id: primaryId(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    /**
     * Null for portal users who have only ever authenticated via magic link.
     * PRD FR-1 allows customers to use either a magic link or email + password.
     */
    passwordHash: text('password_hash'),
    role: roleEnum('role').notNull(),
    /**
     * Set only for `CUSTOMER` role. Enforced by `users_customer_role_chk` in the
     * migration: an internal user must not carry a customer scope, and a portal
     * user must not exist without one.
     */
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'cascade' }),
    active: boolean('active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    index('users_role_idx').on(table.role),
    index('users_customer_idx').on(table.customerId),
  ],
);

/**
 * Single-use portal magic links (PRD FR-1).
 *
 * Only the SHA-256 hash of the token is stored, so a database read cannot be
 * replayed as a login. `quotationId` is optional deep-link context: it decides
 * where the portal lands, never what the user is allowed to see — that is still
 * resolved from `users.customer_id` on every request.
 */
export const magicLinkTokens = pgTable(
  'magic_link_tokens',
  {
    id: primaryId(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    quotationId: uuid('quotation_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamps().createdAt,
  },
  (table) => [index('magic_link_user_idx').on(table.userId)],
);

export const customerTiersRelations = relations(customerTiers, ({ many }) => ({
  customers: many(customers),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  tier: one(customerTiers, { fields: [customers.tierId], references: [customerTiers.id] }),
  users: many(users),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  customer: one(customers, { fields: [users.customerId], references: [customers.id] }),
  magicLinks: many(magicLinkTokens),
}));

export const magicLinkTokensRelations = relations(magicLinkTokens, ({ one }) => ({
  user: one(users, { fields: [magicLinkTokens.userId], references: [users.id] }),
}));
