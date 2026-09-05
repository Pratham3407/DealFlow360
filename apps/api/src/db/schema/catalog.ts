/**
 * Catalog: categories, products, variants, price lists and recommendation inputs.
 *
 * Note the deliberate separation DOMAIN_MODEL.md calls out explicitly: `category`
 * and `billing_type` are independent dimensions. Category drives which discount
 * ceiling applies; billing type drives invoicing. Collapsing them would make a
 * recurring hardware lease unrepresentable and would break the ceiling lookup,
 * which keys off category alone.
 */

import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './_columns.js';
import { billingTypeEnum } from './enums.js';
import { customerTiers } from './identity.js';

export const categories = pgTable('categories', {
  id: primaryId(),
  name: text('name').notNull().unique(),
  description: text('description'),
  /**
   * Category margin characteristic (DOMAIN_MODEL.md `default_margin`).
   *
   * Used as the cost fallback when a product has no explicit `unit_cost_paise`:
   * `cost = base_price × (1 − default_margin_bp / 10000)`. BUSINESS_RULES.md §6
   * leaves the costing methodology as an implementation decision but requires a
   * live margin figure, so every product must resolve to *some* cost.
   */
  defaultMarginBp: integer('default_margin_bp').notNull().default(3000),
  active: boolean('active').notNull().default(true),
  ...timestamps(),
});

export const products = pgTable(
  'products',
  {
    id: primaryId(),
    sku: text('sku').notNull().unique(),
    name: text('name').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    unit: text('unit').notNull().default('unit'),
    /** List price in paise, before price-list overrides and variant extras. */
    basePricePaise: integer('base_price_paise').notNull(),
    /** Explicit unit cost in paise. Null falls back to the category margin. */
    unitCostPaise: integer('unit_cost_paise'),
    /** Tax rate in basis points, e.g. 18% GST = 1800. */
    taxBp: integer('tax_bp').notNull().default(1800),
    description: text('description'),
    billingType: billingTypeEnum('billing_type').notNull().default('ONE_TIME'),
    /**
     * Whether this product consumes warehouse stock. Services and subscriptions
     * are not stock-bearing, so the allocation engine must skip them rather than
     * report them as permanently backordered.
     */
    stockTracked: boolean('stock_tracked').notNull().default(true),
    active: boolean('active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    index('products_category_idx').on(table.categoryId),
    index('products_billing_type_idx').on(table.billingType),
  ],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: primaryId(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    attribute: text('attribute').notNull(),
    value: text('value').notNull(),
    /** Added to the resolved unit price. May be negative for a downgrade. */
    extraPricePaise: integer('extra_price_paise').notNull().default(0),
    active: boolean('active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('product_variants_unique').on(table.productId, table.attribute, table.value),
  ],
);

/**
 * A price list scoped to a customer tier and currency (PRD FR-2).
 *
 * `isDefault` marks the fallback list used when a customer's tier has no list.
 * Multi-currency is a documented bonus capability (PRD §3), so `currency` exists
 * on the schema but the base implementation seeds INR only.
 */
export const priceLists = pgTable(
  'price_lists',
  {
    id: primaryId(),
    name: text('name').notNull().unique(),
    customerTierId: uuid('customer_tier_id').references(() => customerTiers.id, {
      onDelete: 'cascade',
    }),
    currency: text('currency').notNull().default('INR'),
    isDefault: boolean('is_default').notNull().default(false),
    active: boolean('active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [index('price_lists_tier_idx').on(table.customerTierId)],
);

export const priceListItems = pgTable(
  'price_list_items',
  {
    id: primaryId(),
    priceListId: uuid('price_list_id')
      .notNull()
      .references(() => priceLists.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    pricePaise: integer('price_paise').notNull(),
    ...timestamps(),
  },
  (table) => [uniqueIndex('price_list_items_unique').on(table.priceListId, table.productId)],
);

/**
 * Co-purchase affinity used by the upsell/cross-sell engine (PRD §12).
 *
 * `weight` is the ranking strength. Seeded from realistic co-purchase pairs; a
 * production system would recompute it from historical order lines, which is why
 * the engine reads this table rather than hardcoding pairs.
 */
export const productPairings = pgTable(
  'product_pairings',
  {
    id: primaryId(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    recommendedProductId: uuid('recommended_product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    weight: integer('weight').notNull().default(1),
    active: boolean('active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('product_pairings_unique').on(table.productId, table.recommendedProductId),
    index('product_pairings_product_idx').on(table.productId),
  ],
);

/** Active promotions surface as the "promotion tag" on a recommendation (PRD §12). */
export const promotions = pgTable(
  'promotions',
  {
    id: primaryId(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    priority: integer('priority').notNull().default(0),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }),
    active: boolean('active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [index('promotions_product_idx').on(table.productId)],
);

export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  variants: many(productVariants),
  priceListItems: many(priceListItems),
  promotions: many(promotions),
}));

export const productVariantsRelations = relations(productVariants, ({ one }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
}));

export const priceListsRelations = relations(priceLists, ({ one, many }) => ({
  tier: one(customerTiers, { fields: [priceLists.customerTierId], references: [customerTiers.id] }),
  items: many(priceListItems),
}));

export const priceListItemsRelations = relations(priceListItems, ({ one }) => ({
  priceList: one(priceLists, { fields: [priceListItems.priceListId], references: [priceLists.id] }),
  product: one(products, { fields: [priceListItems.productId], references: [products.id] }),
}));

export const productPairingsRelations = relations(productPairings, ({ one }) => ({
  product: one(products, {
    fields: [productPairings.productId],
    references: [products.id],
    relationName: 'pairing_source',
  }),
  recommendedProduct: one(products, {
    fields: [productPairings.recommendedProductId],
    references: [products.id],
    relationName: 'pairing_target',
  }),
}));

export const promotionsRelations = relations(promotions, ({ one }) => ({
  product: one(products, { fields: [promotions.productId], references: [products.id] }),
}));
