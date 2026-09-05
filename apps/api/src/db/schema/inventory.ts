/**
 * Inventory and fulfillment.
 *
 * The confirmed quotation *is* the order — DOMAIN_MODEL.md refers to
 * "quotation/order id" throughout and the source specification never introduces a
 * separate order entity. `fulfillments.quotation_id` is therefore unique, and the
 * `/api/orders/:id/...` routes resolve `:id` to a quotation.
 */

import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './_columns.js';
import { products } from './catalog.js';
import { users } from './identity.js';
import { quotationLines, quotations } from './quotation.js';
import { backorderStatusEnum, fulfillmentStatusEnum } from './enums.js';

export const warehouses = pgTable('warehouses', {
  id: primaryId(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  location: text('location'),
  /**
   * Shipping-cost weighting (PRD §8). 10000 = neutral (1.0×); 12000 makes this
   * warehouse 20% more expensive to ship from. The allocation engine multiplies
   * `base_shipment_cost_paise` by this to rank candidate splits, so an admin can
   * change routing behaviour purely through configuration.
   */
  shippingWeightBp: integer('shipping_weight_bp').notNull().default(10_000),
  /** Flat cost of dispatching one shipment from this warehouse, before weighting. */
  baseShipmentCostPaise: integer('base_shipment_cost_paise').notNull().default(0),
  /** Tie-breaker when weighted costs are equal. Higher is preferred. */
  priority: integer('priority').notNull().default(0),
  /** Lead time used to project a delivery date for slippage detection. */
  leadTimeDays: integer('lead_time_days').notNull().default(2),
  active: boolean('active').notNull().default(true),
  ...timestamps(),
});

/**
 * Per-warehouse, per-product stock.
 *
 * `available_quantity` is unreserved stock; `reserved_quantity` is stock committed
 * to accepted allocations. BUSINESS_RULES.md §7 forbids allocating unavailable
 * stock, so reservation moves quantity between the two columns inside the same
 * transaction as the allocation rather than merely flagging a row.
 */
export const inventory = pgTable(
  'inventory',
  {
    id: primaryId(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    availableQuantity: integer('available_quantity').notNull().default(0),
    reservedQuantity: integer('reserved_quantity').notNull().default(0),
    /** Replenishment rule: reorder when available drops to or below this. */
    reorderPoint: integer('reorder_point').notNull().default(0),
    reorderQuantity: integer('reorder_quantity').notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('inventory_unique').on(table.warehouseId, table.productId),
    index('inventory_product_idx').on(table.productId),
  ],
);

export const fulfillments = pgTable(
  'fulfillments',
  {
    id: primaryId(),
    quotationId: uuid('quotation_id')
      .notNull()
      .unique()
      .references(() => quotations.id, { onDelete: 'cascade' }),
    status: fulfillmentStatusEnum('status').notNull().default('NOT_STARTED'),
    /** Distinct (warehouse) dispatches implied by the current plan (PRD §8 UI). */
    plannedShipmentCount: integer('planned_shipment_count').notNull().default(0),
    plannedShippingCostPaise: integer('planned_shipping_cost_paise').notNull().default(0),
    /** True when a human replaced the engine's recommendation. */
    isOverridden: boolean('is_overridden').notNull().default(false),
    acceptedById: uuid('accepted_by_id').references(() => users.id, { onDelete: 'set null' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
    projectedDeliveryDate: date('projected_delivery_date', { mode: 'date' }),
    notes: text('notes'),
    ...timestamps(),
  },
  (table) => [index('fulfillments_status_idx').on(table.status)],
);

export const fulfillmentAllocations = pgTable(
  'fulfillment_allocations',
  {
    id: primaryId(),
    fulfillmentId: uuid('fulfillment_id')
      .notNull()
      .references(() => fulfillments.id, { onDelete: 'cascade' }),
    quotationLineId: uuid('quotation_line_id')
      .notNull()
      .references(() => quotationLines.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    /** Weighted shipment cost attributed to this warehouse leg. */
    shipmentCostPaise: integer('shipment_cost_paise').notNull().default(0),
    /**
     * False while the split is only a recommendation. Stock is decremented and
     * reserved only when the plan is accepted or overridden by an authorised user,
     * which keeps "recalculate" a side-effect-free operation.
     */
    reserved: boolean('reserved').notNull().default(false),
    /** Set when this allocation was created by consolidating a backorder. */
    fromBackorderId: uuid('from_backorder_id'),
    shippedAt: timestamp('shipped_at', { withTimezone: true, mode: 'date' }),
    ...timestamps(),
  },
  (table) => [
    index('fulfillment_allocations_fulfillment_idx').on(table.fulfillmentId),
    index('fulfillment_allocations_line_idx').on(table.quotationLineId),
    index('fulfillment_allocations_warehouse_idx').on(table.warehouseId),
  ],
);

export const backorders = pgTable(
  'backorders',
  {
    id: primaryId(),
    fulfillmentId: uuid('fulfillment_id')
      .notNull()
      .references(() => fulfillments.id, { onDelete: 'cascade' }),
    quotationLineId: uuid('quotation_line_id')
      .notNull()
      .references(() => quotationLines.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    status: backorderStatusEnum('status').notNull().default('OPEN'),
    /** Warehouse that reported stock, set when the status becomes STOCK_AVAILABLE. */
    availableWarehouseId: uuid('available_warehouse_id').references(() => warehouses.id, {
      onDelete: 'set null',
    }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    ...timestamps(),
  },
  (table) => [
    index('backorders_fulfillment_idx').on(table.fulfillmentId),
    index('backorders_status_idx').on(table.status),
    index('backorders_product_idx').on(table.productId),
  ],
);

export const warehousesRelations = relations(warehouses, ({ many }) => ({
  inventory: many(inventory),
  allocations: many(fulfillmentAllocations),
}));

export const inventoryRelations = relations(inventory, ({ one }) => ({
  warehouse: one(warehouses, { fields: [inventory.warehouseId], references: [warehouses.id] }),
  product: one(products, { fields: [inventory.productId], references: [products.id] }),
}));

export const fulfillmentsRelations = relations(fulfillments, ({ one, many }) => ({
  quotation: one(quotations, { fields: [fulfillments.quotationId], references: [quotations.id] }),
  acceptedBy: one(users, { fields: [fulfillments.acceptedById], references: [users.id] }),
  allocations: many(fulfillmentAllocations),
  backorders: many(backorders),
}));

export const fulfillmentAllocationsRelations = relations(fulfillmentAllocations, ({ one }) => ({
  fulfillment: one(fulfillments, {
    fields: [fulfillmentAllocations.fulfillmentId],
    references: [fulfillments.id],
  }),
  line: one(quotationLines, {
    fields: [fulfillmentAllocations.quotationLineId],
    references: [quotationLines.id],
  }),
  warehouse: one(warehouses, {
    fields: [fulfillmentAllocations.warehouseId],
    references: [warehouses.id],
  }),
  product: one(products, { fields: [fulfillmentAllocations.productId], references: [products.id] }),
}));

export const backordersRelations = relations(backorders, ({ one }) => ({
  fulfillment: one(fulfillments, {
    fields: [backorders.fulfillmentId],
    references: [fulfillments.id],
  }),
  line: one(quotationLines, {
    fields: [backorders.quotationLineId],
    references: [quotationLines.id],
  }),
  product: one(products, { fields: [backorders.productId], references: [products.id] }),
  availableWarehouse: one(warehouses, {
    fields: [backorders.availableWarehouseId],
    references: [warehouses.id],
  }),
}));
