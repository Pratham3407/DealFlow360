/**
 * Master data routes: customers, products, categories, tiers, price lists,
 * discount/governance rules, warehouses, inventory, plans, pairings, promotions.
 *
 * Kept as thin validated CRUD over the schema; writeAudit is called so master-data
 * changes still appear in the append-only audit log (PRD §20).
 */

import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  approvalRules,
  categories,
  customerTiers,
  customers,
  discountRules,
  inventory,
  priceListItems,
  priceLists,
  productPairings,
  products,
  promotions,
  subscriptionPlanProducts,
  subscriptionPlans,
  systemSettings,
  warehouses,
} from '../db/schema/index.js';
import { writeAudit } from '../domain/audit/audit.service.js';
import { toAsync, actorFromRequest } from '../middleware/auth.js';
import { internalOnly, validateBody } from './helpers.js';

/**
 * Who may change configuration.
 *
 * RBAC.md draws a line between *configuration* (Admin owns it; Manager shares
 * discount and approval rules, and "optionally" products and price lists) and
 * *operations*. Reads are open to every internal role because a rep cannot build a
 * quote without seeing customers, products and ceilings.
 */
const CONFIG_ADMINS = ['ADMIN', 'SALES_MANAGER'] as const;
/** Warehouses, stock levels, shipping weighting and plans are Admin-only. */
const ADMIN_ONLY = ['ADMIN'] as const;

export const masterDataRouter = Router();

// ---- customers -------------------------------------------------------------

masterDataRouter.get('/customers', internalOnly(), toAsync(async (req, res) => {
  res.json({ data: await db.query.customers.findMany({ with: { tier: true } }) });
}));

masterDataRouter.get('/customers/:id', internalOnly(), toAsync(async (req, res) => {
  const customer = await db.query.customers.findFirst({
    where: (table, { eq }) => eq(table.id, String(req.params.id)),
    with: { tier: true },
  });
  if (!customer) {
    res.status(404).json({ error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found', details: {} } });
    return;
  }
  res.json({ customer });
}));

masterDataRouter.post(
  '/customers',
  internalOnly(...CONFIG_ADMINS),
  validateBody(
    z.object({
      code: z.string().min(1),
      name: z.string().min(1),
      tierId: z.string().min(1),
      contactName: z.string().optional(),
      contactEmail: z.string().email().optional(),
      contactPhone: z.string().optional(),
      billingAddress: z.string().optional(),
      paymentTermsDays: z.number().int().positive().optional(),
    }),
  ),
  toAsync(async (req, res) => {
    const [row] = await db
      .insert(customers)
      .values({
        code: req.body.code,
        name: req.body.name,
        tierId: req.body.tierId,
        contactName: req.body.contactName ?? null,
        contactEmail: req.body.contactEmail ?? null,
        contactPhone: req.body.contactPhone ?? null,
        billingAddress: req.body.billingAddress ?? null,
        paymentTermsDays: req.body.paymentTermsDays ?? 30,
      })
      .returning();
    await writeAudit(db, { ...actorFromRequest(req), entityType: 'CUSTOMER', entityId: row!.id, action: 'CONFIG_CHANGED', newValue: { name: req.body.name } });
    res.status(201).json({ customer: row });
  }),
);

masterDataRouter.patch(
  '/customers/:id',
  internalOnly(...CONFIG_ADMINS),
  validateBody(
    z.object({
      name: z.string().optional(),
      tierId: z.string().optional(),
      contactName: z.string().optional(),
      contactEmail: z.string().email().optional(),
      contactPhone: z.string().optional(),
      billingAddress: z.string().optional(),
      paymentTermsDays: z.number().int().positive().optional(),
      active: z.boolean().optional(),
    }),
  ),
  toAsync(async (req, res) => {
    const [row] = await db
      .update(customers)
      .set(req.body as Partial<typeof customers.$inferInsert>)
      .where(eq(customers.id, String(req.params.id)))
      .returning();
    await writeAudit(db, { ...actorFromRequest(req), entityType: 'CUSTOMER', entityId: String(req.params.id), action: 'CONFIG_CHANGED', newValue: req.body });
    res.json({ customer: row });
  }),
);

// ---- products ---------------------------------------------------------------

masterDataRouter.get('/products', internalOnly(), toAsync(async (req, res) => {
  res.json({ data: await db.query.products.findMany({ with: { category: true } }) });
}));

masterDataRouter.get('/products/:id', internalOnly(), toAsync(async (req, res) => {
  const product = await db.query.products.findFirst({
    where: (table, { eq }) => eq(table.id, String(req.params.id)),
    with: { category: true },
  });
  if (!product) {
    res.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found', details: {} } });
    return;
  }
  res.json({ product });
}));

masterDataRouter.post(
  '/products',
  internalOnly(...CONFIG_ADMINS),
  validateBody(
    z.object({
      sku: z.string().min(1),
      name: z.string().min(1),
      description: z.string().optional(),
      categoryId: z.string().min(1),
      unit: z.string().optional(),
      basePricePaise: z.number().int().nonnegative(),
      /** Omit to fall back to the category margin (see pricing.service). */
      unitCostPaise: z.number().int().nonnegative().nullish(),
      taxBp: z.number().int().min(0).max(10000).optional(),
      billingType: z.enum(['ONE_TIME', 'RECURRING']).optional(),
      stockTracked: z.boolean().optional(),
      active: z.boolean().optional(),
    }),
  ),
  toAsync(async (req, res) => {
    const [row] = await db
      .insert(products)
      .values({
        sku: req.body.sku,
        name: req.body.name,
        description: req.body.description ?? null,
        categoryId: req.body.categoryId,
        unit: req.body.unit ?? 'unit',
        basePricePaise: req.body.basePricePaise,
        unitCostPaise: req.body.unitCostPaise ?? null,
        ...(req.body.taxBp === undefined ? {} : { taxBp: req.body.taxBp }),
        ...(req.body.billingType === undefined ? {} : { billingType: req.body.billingType }),
        ...(req.body.stockTracked === undefined ? {} : { stockTracked: req.body.stockTracked }),
        ...(req.body.active === undefined ? {} : { active: req.body.active }),
      })
      .returning();
    await writeAudit(db, { ...actorFromRequest(req), entityType: 'PRODUCT', entityId: row!.id, action: 'CONFIG_CHANGED', newValue: { sku: req.body.sku } });
    res.status(201).json({ product: row });
  }),
);

masterDataRouter.patch(
  '/products/:id',
  internalOnly(...CONFIG_ADMINS),
  validateBody(
    z.object({
      name: z.string().optional(),
      description: z.string().optional(),
      basePricePaise: z.number().int().nonnegative().optional(),
      unitCostPaise: z.number().int().nonnegative().nullish(),
      taxBp: z.number().int().min(0).max(10000).optional(),
      stockTracked: z.boolean().optional(),
      active: z.boolean().optional(),
    }),
  ),
  toAsync(async (req, res) => {
    const [row] = await db
      .update(products)
      .set(req.body as Partial<typeof products.$inferInsert>)
      .where(eq(products.id, String(req.params.id)))
      .returning();
    res.json({ product: row });
  }),
);

// ---- categories / tiers ----------------------------------------------------

masterDataRouter.get('/categories', internalOnly(), toAsync(async (_req, res) => {
  res.json({ data: await db.select().from(categories) });
}));

masterDataRouter.post('/categories', internalOnly(...CONFIG_ADMINS), validateBody(z.object({ name: z.string().min(1), description: z.string().optional(), defaultMarginBp: z.number().int().min(0).max(10000).optional(), active: z.boolean().optional() })), toAsync(async (req, res) => {
  const [row] = await db.insert(categories).values({
    name: req.body.name,
    description: req.body.description ?? null,
    ...(req.body.defaultMarginBp === undefined ? {} : { defaultMarginBp: req.body.defaultMarginBp }),
    ...(req.body.active === undefined ? {} : { active: req.body.active }),
  }).returning();
  res.status(201).json({ category: row });
}));

masterDataRouter.get('/tiers', internalOnly(), toAsync(async (_req, res) => {
  res.json({ data: await db.select().from(customerTiers) });
}));

masterDataRouter.post('/tiers', internalOnly(...CONFIG_ADMINS), validateBody(z.object({ name: z.string().min(1), rank: z.number().int().optional(), defaultDiscountCeilingBp: z.number().int().min(0).max(10000), description: z.string().optional(), active: z.boolean().optional() })), toAsync(async (req, res) => {
  const [row] = await db.insert(customerTiers).values({
    name: req.body.name,
    defaultDiscountCeilingBp: req.body.defaultDiscountCeilingBp,
    description: req.body.description ?? null,
    rank: req.body.rank ?? 0,
    active: req.body.active ?? true,
  }).returning();
  res.status(201).json({ tier: row });
}));

// ---- price lists ------------------------------------------------------------

masterDataRouter.get('/price-lists', internalOnly(), toAsync(async (_req, res) => {
  res.json({ data: await db.query.priceLists.findMany({ with: { items: true } }) });
}));

masterDataRouter.post('/price-lists', internalOnly(...CONFIG_ADMINS), validateBody(z.object({ name: z.string().min(1), customerTierId: z.string().nullish(), currency: z.string().optional(), isDefault: z.boolean().optional(), active: z.boolean().optional() })), toAsync(async (req, res) => {
  const [row] = await db.insert(priceLists).values({
    name: req.body.name,
    customerTierId: req.body.customerTierId ?? null,
    currency: req.body.currency ?? 'INR',
    isDefault: req.body.isDefault ?? false,
    active: req.body.active ?? true,
  }).returning();
  res.status(201).json({ priceList: row });
}));

/** Upsert a per-product override price on a list (drives tier pricing, PRD FR-2). */
masterDataRouter.put('/price-lists/:priceListId/items/:productId', internalOnly(...CONFIG_ADMINS), validateBody(z.object({ pricePaise: z.number().int().nonnegative() })), toAsync(async (req, res) => {
  const [row] = await db
    .insert(priceListItems)
    .values({ priceListId: String(req.params.priceListId), productId: String(req.params.productId), pricePaise: req.body.pricePaise })
    .onConflictDoUpdate({
      target: [priceListItems.priceListId, priceListItems.productId],
      set: { pricePaise: req.body.pricePaise },
    })
    .returning();
  res.json({ item: row });
}));

// ---- governance rules --------------------------------------------------------

masterDataRouter.get('/discount-rules', internalOnly(), toAsync(async (_req, res) => {
  res.json({ data: await db.select().from(discountRules) });
}));

masterDataRouter.post('/discount-rules', internalOnly(...CONFIG_ADMINS), validateBody(z.object({ name: z.string().min(1), customerTierId: z.string().nullish(), categoryId: z.string().nullish(), maxDiscountBp: z.number().int().min(0).max(10000), priority: z.number().int().optional(), active: z.boolean().optional() })), toAsync(async (req, res) => {
  const [row] = await db.insert(discountRules).values({
    name: req.body.name,
    customerTierId: req.body.customerTierId ?? null,
    categoryId: req.body.categoryId ?? null,
    maxDiscountBp: req.body.maxDiscountBp,
    priority: req.body.priority ?? 0,
    active: req.body.active ?? true,
  }).returning();
  await writeAudit(db, { ...actorFromRequest(req), entityType: 'DISCOUNT_RULE', entityId: row!.id, action: 'CONFIG_CHANGED', newValue: req.body });
  res.status(201).json({ rule: row });
}));

/**
 * Editing a ceiling changes the governance rules under live quotes. Existing
 * quotes keep the ceiling they were evaluated against (it is snapshotted on the
 * line) until they are recalculated, which is what makes the change auditable
 * rather than retroactive.
 */
masterDataRouter.patch('/discount-rules/:id', internalOnly(...CONFIG_ADMINS), validateBody(z.object({ name: z.string().optional(), maxDiscountBp: z.number().int().min(0).max(10000).optional(), priority: z.number().int().optional(), active: z.boolean().optional() })), toAsync(async (req, res) => {
  const [row] = await db
    .update(discountRules)
    .set(req.body as Partial<typeof discountRules.$inferInsert>)
    .where(eq(discountRules.id, String(req.params.id)))
    .returning();
  if (!row) {
    res.status(404).json({ error: { code: 'RULE_NOT_FOUND', message: 'Discount rule not found', details: {} } });
    return;
  }
  await writeAudit(db, { ...actorFromRequest(req), entityType: 'DISCOUNT_RULE', entityId: row.id, action: 'CONFIG_CHANGED', newValue: req.body });
  res.json({ rule: row });
}));

masterDataRouter.get('/approval-rules', internalOnly(), toAsync(async (_req, res) => {
  res.json({ data: await db.select().from(approvalRules) });
}));

masterDataRouter.post('/approval-rules', internalOnly(...CONFIG_ADMINS), validateBody(z.object({ name: z.string().min(1), minRiskBp: z.number().int().min(0), maxRiskBp: z.number().int().min(0).nullish(), requiredLevel: z.enum(['NONE', 'MANAGER', 'MANAGER_FINANCE']), priority: z.number().int().optional(), active: z.boolean().optional() })), toAsync(async (req, res) => {
  const [row] = await db.insert(approvalRules).values({
    name: req.body.name,
    minRiskBp: req.body.minRiskBp,
    maxRiskBp: req.body.maxRiskBp ?? null,
    requiredLevel: req.body.requiredLevel,
    priority: req.body.priority ?? 0,
    active: req.body.active ?? true,
  }).returning();
  await writeAudit(db, { ...actorFromRequest(req), entityType: 'APPROVAL_RULE', entityId: row!.id, action: 'CONFIG_CHANGED', newValue: req.body });
  res.status(201).json({ rule: row });
}));

masterDataRouter.patch('/approval-rules/:id', internalOnly(...CONFIG_ADMINS), validateBody(z.object({ name: z.string().optional(), minRiskBp: z.number().int().min(0).optional(), maxRiskBp: z.number().int().min(0).nullish(), requiredLevel: z.enum(['NONE', 'MANAGER', 'MANAGER_FINANCE']).optional(), priority: z.number().int().optional(), active: z.boolean().optional() })), toAsync(async (req, res) => {
  const [row] = await db
    .update(approvalRules)
    .set(req.body as Partial<typeof approvalRules.$inferInsert>)
    .where(eq(approvalRules.id, String(req.params.id)))
    .returning();
  if (!row) {
    res.status(404).json({ error: { code: 'RULE_NOT_FOUND', message: 'Approval rule not found', details: {} } });
    return;
  }
  await writeAudit(db, { ...actorFromRequest(req), entityType: 'APPROVAL_RULE', entityId: row.id, action: 'CONFIG_CHANGED', newValue: req.body });
  res.json({ rule: row });
}));

// ---- warehouses / inventory --------------------------------------------------

masterDataRouter.get('/warehouses', internalOnly(), toAsync(async (_req, res) => {
  res.json({ data: await db.select().from(warehouses) });
}));

masterDataRouter.post('/warehouses', internalOnly(...ADMIN_ONLY), validateBody(z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  location: z.string().optional(),
  shippingWeightBp: z.number().int().positive().optional(),
  baseShipmentCostPaise: z.number().int().nonnegative().optional(),
  priority: z.number().int().optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
})), toAsync(async (req, res) => {
  const [row] = await db.insert(warehouses).values({
    code: req.body.code,
    name: req.body.name,
    location: req.body.location ?? null,
    ...(req.body.shippingWeightBp === undefined ? {} : { shippingWeightBp: req.body.shippingWeightBp }),
    ...(req.body.baseShipmentCostPaise === undefined ? {} : { baseShipmentCostPaise: req.body.baseShipmentCostPaise }),
    ...(req.body.priority === undefined ? {} : { priority: req.body.priority }),
    ...(req.body.leadTimeDays === undefined ? {} : { leadTimeDays: req.body.leadTimeDays }),
    ...(req.body.active === undefined ? {} : { active: req.body.active }),
  }).returning();
  res.status(201).json({ warehouse: row });
}));

masterDataRouter.get('/inventory', internalOnly(), toAsync(async (req, res) => {
  const { productId, warehouseId } = req.query;
  const rows = await db.query.inventory.findMany({
    where: (table, { and, eq }) => and(productId ? eq(table.productId, String(productId)) : undefined, warehouseId ? eq(table.warehouseId, String(warehouseId)) : undefined),
    with: { warehouse: true, product: true },
  });
  res.json({ data: rows });
}));

/** Per-warehouse inventory listing (API_SPEC.md `/api/warehouses/:id/inventory`). */
masterDataRouter.get('/warehouses/:id/inventory', internalOnly(), toAsync(async (req, res) => {
  const rows = await db.query.inventory.findMany({
    where: (table, { eq }) => eq(table.warehouseId, String(req.params.id)),
    with: { product: true, warehouse: true },
  });
  res.json({ data: rows });
}));

/**
 * Replace the row's available quantity and reorder thresholds for a
 * (warehouse, product) pair. RESTy upsert so the route is idempotent.
 */
masterDataRouter.patch(
  '/warehouses/:warehouseId/inventory/:productId',
  internalOnly(...ADMIN_ONLY),
  validateBody(
    z.object({
      availableQuantity: z.number().int().min(0).optional(),
      reservedQuantity: z.number().int().min(0).optional(),
      reorderPoint: z.number().int().optional(),
      reorderQuantity: z.number().int().optional(),
    }),
  ),
  toAsync(async (req, res) => {
    const [row] = await db
      .insert(inventory)
      .values({
        warehouseId: String(req.params.warehouseId),
        productId: String(req.params.productId),
        availableQuantity: req.body.availableQuantity ?? 0,
        reservedQuantity: req.body.reservedQuantity ?? 0,
        reorderPoint: req.body.reorderPoint ?? 0,
        reorderQuantity: req.body.reorderQuantity ?? 0,
      })
      .onConflictDoUpdate({
        target: [inventory.warehouseId, inventory.productId],
        set: {
          ...(req.body.availableQuantity === undefined ? {} : { availableQuantity: req.body.availableQuantity }),
          ...(req.body.reservedQuantity === undefined ? {} : { reservedQuantity: req.body.reservedQuantity }),
          ...(req.body.reorderPoint === undefined ? {} : { reorderPoint: req.body.reorderPoint }),
          ...(req.body.reorderQuantity === undefined ? {} : { reorderQuantity: req.body.reorderQuantity }),
        },
      })
      .returning();
    await writeAudit(db, { ...actorFromRequest(req), entityType: 'INVENTORY', entityId: row!.id, action: 'CONFIG_CHANGED', newValue: req.body });
    res.json({ inventory: row });
  }),
);

masterDataRouter.post('/inventory', internalOnly(...ADMIN_ONLY), validateBody(z.object({ warehouseId: z.string().min(1), productId: z.string().min(1), availableQuantity: z.number().int().min(0), reservedQuantity: z.number().int().min(0).optional(), reorderPoint: z.number().int().optional(), reorderQuantity: z.number().int().optional() })), toAsync(async (req, res) => {
  const [row] = await db
    .insert(inventory)
    .values({
      warehouseId: req.body.warehouseId,
      productId: req.body.productId,
      availableQuantity: req.body.availableQuantity,
      reservedQuantity: req.body.reservedQuantity ?? 0,
      reorderPoint: req.body.reorderPoint ?? 0,
      reorderQuantity: req.body.reorderQuantity ?? 0,
    })
    .onConflictDoUpdate({
      target: [inventory.warehouseId, inventory.productId],
      set: { availableQuantity: req.body.availableQuantity, reorderPoint: req.body.reorderPoint ?? 0, reorderQuantity: req.body.reorderQuantity ?? 0 },
    })
    .returning();
  res.status(201).json({ inventory: row });
}));

// ---- plans / pairings / promotions --------------------------------------------

masterDataRouter.get('/subscription-plans', internalOnly(), toAsync(async (_req, res) => {
  res.json({ data: await db.query.subscriptionPlans.findMany({ with: { eligibleProducts: true } }) });
}));

masterDataRouter.post('/subscription-plans', internalOnly(...ADMIN_ONLY), validateBody(z.object({
  name: z.string().min(1),
  interval: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']),
  prorationMode: z.enum(['NONE', 'DAILY_PRORATA', 'FULL_PERIOD']).optional(),
  cancellationMode: z.enum(['IMMEDIATE', 'END_OF_PERIOD']).optional(),
  refundMode: z.enum(['NONE', 'PARTIAL_PRORATA', 'FULL']).optional(),
  dayCountConvention: z.enum(['ACTUAL_DAYS', 'THIRTY_DAY_MONTH']).optional(),
  minTermIntervals: z.number().int().min(0).optional(),
  description: z.string().optional(),
  active: z.boolean().optional(),
})), toAsync(async (req, res) => {
  const [row] = await db.insert(subscriptionPlans).values({
    name: req.body.name,
    interval: req.body.interval,
    prorationMode: req.body.prorationMode ?? 'DAILY_PRORATA',
    cancellationMode: req.body.cancellationMode ?? 'END_OF_PERIOD',
    refundMode: req.body.refundMode ?? 'PARTIAL_PRORATA',
    dayCountConvention: req.body.dayCountConvention ?? 'ACTUAL_DAYS',
    minTermIntervals: req.body.minTermIntervals ?? 0,
    description: req.body.description ?? null,
    active: req.body.active ?? true,
  }).returning();
  res.status(201).json({ plan: row });
}));

masterDataRouter.patch('/subscription-plans/:id', internalOnly(...ADMIN_ONLY), validateBody(z.object({
  prorationMode: z.enum(['NONE', 'DAILY_PRORATA', 'FULL_PERIOD']).optional(),
  cancellationMode: z.enum(['IMMEDIATE', 'END_OF_PERIOD']).optional(),
  refundMode: z.enum(['NONE', 'PARTIAL_PRORATA', 'FULL']).optional(),
  dayCountConvention: z.enum(['ACTUAL_DAYS', 'THIRTY_DAY_MONTH']).optional(),
  minTermIntervals: z.number().int().min(0).optional(),
  description: z.string().optional(),
  active: z.boolean().optional(),
})), toAsync(async (req, res) => {
  const [row] = await db.update(subscriptionPlans).set(req.body as Partial<typeof subscriptionPlans.$inferInsert>).where(eq(subscriptionPlans.id, String(req.params.id))).returning();
  if (!row) {
    res.status(404).json({ error: { code: 'PLAN_NOT_FOUND', message: 'Subscription plan not found', details: {} } });
    return;
  }
  res.json({ plan: row });
}));

masterDataRouter.post('/subscription-plans/:planId/products', internalOnly(...ADMIN_ONLY), validateBody(z.object({ productId: z.string().min(1), isDefault: z.boolean().optional() })), toAsync(async (req, res) => {
  const [row] = await db.insert(subscriptionPlanProducts).values({
    planId: String(req.params.planId),
    productId: req.body.productId,
    isDefault: req.body.isDefault ?? false,
  }).returning();
  res.status(201).json({ mapping: row });
}));

masterDataRouter.get('/pairings', internalOnly(), toAsync(async (_req, res) => {
  const data = await db.select().from(productPairings);
  res.json({ data });
}));

masterDataRouter.post('/pairings', internalOnly(...CONFIG_ADMINS), validateBody(z.object({ productId: z.string().min(1), recommendedProductId: z.string().min(1), weight: z.number().int().min(1).optional() })), toAsync(async (req, res) => {
  const [row] = await db
    .insert(productPairings)
    .values({ productId: req.body.productId, recommendedProductId: req.body.recommendedProductId, weight: req.body.weight ?? 1 })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    res.status(200).json({ pairing: { productId: req.body.productId, recommendedProductId: req.body.recommendedProductId } });
    return;
  }
  res.status(201).json({ pairing: row });
}));

masterDataRouter.get('/promotions', internalOnly(), toAsync(async (_req, res) => {
  res.json({ data: await db.select().from(promotions) });
}));

masterDataRouter.post('/promotions', internalOnly(...CONFIG_ADMINS), validateBody(z.object({ label: z.string().min(1), productId: z.string().min(1), priority: z.number().int().optional(), startsAt: z.string().optional(), endsAt: z.string().optional(), active: z.boolean().optional() })), toAsync(async (req, res) => {
  const [row] = await db.insert(promotions).values({
    label: req.body.label,
    productId: req.body.productId,
    priority: req.body.priority ?? 0,
    startsAt: req.body.startsAt ? new Date(req.body.startsAt) : null,
    endsAt: req.body.endsAt ? new Date(req.body.endsAt) : null,
    active: req.body.active ?? true,
  }).returning();
  res.status(201).json({ promotion: row });
}));

// ---- settings ---------------------------------------------------------------

masterDataRouter.get('/settings', internalOnly(), toAsync(async (_req, res) => {
  res.json({ data: await db.select().from(systemSettings) });
}));

masterDataRouter.put('/settings/:key', internalOnly(...ADMIN_ONLY), validateBody(z.object({ value: z.string().min(1), valueType: z.string().optional(), group: z.string().optional(), description: z.string().optional() })), toAsync(async (req, res) => {
  const user = req.user!;
  const [row] = await db
    .insert(systemSettings)
    .values({ key: String(req.params.key), ...req.body, updatedById: user.id })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: req.body.value, valueType: req.body.valueType ?? 'string', description: req.body.description, updatedById: user.id } })
    .returning();
  await writeAudit(db, { ...actorFromRequest(req), entityType: 'SYSTEM_SETTING', entityId: String(req.params.key), action: 'CONFIG_CHANGED', newValue: { value: req.body.value } });
  res.json({ setting: row });
}));