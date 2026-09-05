import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireCapability } from '../../http/middleware/auth';
import { validate } from '../../http/middleware/validate';
import { codeSchema, moneySchema, nameSchema, percentSchema } from '../../http/fields';
import { listQuerySchema } from '../../http/pagination';
import { Capability } from '../auth/permissions';
import {
  createDiscountRule,
  createPriceList,
  getPriceList,
  listDiscountRules,
  listPriceLists,
  previewEffectiveCeiling,
  removePriceListItem,
  setPriceListItem,
  updateDiscountRule,
  updatePriceList,
} from './pricingService';

const idParam = z.object({ id: z.uuid() });
const itemParams = z.object({ id: z.uuid(), productId: z.uuid() });

const read = requireCapability(Capability.PRICING_READ);

// ---------------------------------------------------------------------------
// /api/price-lists
// ---------------------------------------------------------------------------

const createPriceListSchema = z
  .object({
    code: codeSchema,
    name: nameSchema,
    customerTierId: z.uuid().nullish(),
    // Single-currency for now (docs/PRD.md 3 lists multi-currency as a bonus),
    // but the column exists so the constraint is stated here rather than assumed.
    currency: z.literal('INR').optional(),
  })
  .strict();

const updatePriceListSchema = z
  .object({
    name: nameSchema.optional(),
    customerTierId: z.uuid().nullish(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

const setItemSchema = z.object({ price: moneySchema }).strict();

export const priceListRoutes = Router();

priceListRoutes.get('/', read, validate({ query: listQuerySchema.strict() }), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listQuerySchema>;
  res.status(200).json(await listPriceLists(query));
});

priceListRoutes.get('/:id', read, validate({ params: idParam }), async (req, res) => {
  const { id } = req.params as z.infer<typeof idParam>;
  res.status(200).json({ data: await getPriceList(id) });
});

priceListRoutes.post(
  '/',
  requireCapability(Capability.PRICE_LISTS_CONFIGURE),
  validate({ body: createPriceListSchema }),
  async (req, res) => {
    const body = req.body as z.infer<typeof createPriceListSchema>;
    res.status(201).json({ data: await createPriceList(authOf(req), body) });
  },
);

priceListRoutes.patch(
  '/:id',
  requireCapability(Capability.PRICE_LISTS_CONFIGURE),
  validate({ params: idParam, body: updatePriceListSchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const body = req.body as z.infer<typeof updatePriceListSchema>;
    res.status(200).json({ data: await updatePriceList(authOf(req), id, body) });
  },
);

priceListRoutes.put(
  '/:id/items/:productId',
  requireCapability(Capability.PRICE_LISTS_CONFIGURE),
  validate({ params: itemParams, body: setItemSchema }),
  async (req, res) => {
    const { id, productId } = req.params as z.infer<typeof itemParams>;
    const { price } = req.body as z.infer<typeof setItemSchema>;
    res.status(200).json({ data: await setPriceListItem(authOf(req), id, productId, price) });
  },
);

priceListRoutes.delete(
  '/:id/items/:productId',
  requireCapability(Capability.PRICE_LISTS_CONFIGURE),
  validate({ params: itemParams }),
  async (req, res) => {
    const { id, productId } = req.params as z.infer<typeof itemParams>;
    await removePriceListItem(authOf(req), id, productId);
    res.status(204).send();
  },
);

// ---------------------------------------------------------------------------
// /api/discount-rules
// ---------------------------------------------------------------------------

const createDiscountRuleSchema = z
  .object({
    customerTierId: z.uuid(),
    /** Null or omitted creates the tier-wide fallback rule. */
    categoryId: z.uuid().nullish(),
    maximumDiscount: percentSchema,
    priority: z.number().int().min(0).max(1000).optional(),
  })
  .strict();

const updateDiscountRuleSchema = z
  .object({
    maximumDiscount: percentSchema.optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

const listDiscountRulesQuerySchema = listQuerySchema
  .extend({ customerTierId: z.uuid().optional(), categoryId: z.uuid().optional() })
  .strict();

const effectiveQuerySchema = z
  .object({
    customerTierId: z.uuid(),
    categoryId: z.uuid().optional(),
  })
  .strict();

export const discountRuleRoutes = Router();

/**
 * Registered before `/:id` style routes so "effective" is never mistaken for an
 * identifier.
 */
discountRuleRoutes.get(
  '/effective',
  read,
  validate({ query: effectiveQuerySchema }),
  async (req, res) => {
    const query = req.query as unknown as z.infer<typeof effectiveQuerySchema>;
    res
      .status(200)
      .json({ data: await previewEffectiveCeiling(query.customerTierId, query.categoryId ?? null) });
  },
);

discountRuleRoutes.get(
  '/',
  read,
  validate({ query: listDiscountRulesQuerySchema }),
  async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listDiscountRulesQuerySchema>;
    res.status(200).json(await listDiscountRules(query));
  },
);

discountRuleRoutes.post(
  '/',
  requireCapability(Capability.DISCOUNT_RULES_CONFIGURE),
  validate({ body: createDiscountRuleSchema }),
  async (req, res) => {
    const body = req.body as z.infer<typeof createDiscountRuleSchema>;
    res.status(201).json({ data: await createDiscountRule(authOf(req), body) });
  },
);

discountRuleRoutes.patch(
  '/:id',
  requireCapability(Capability.DISCOUNT_RULES_CONFIGURE),
  validate({ params: idParam, body: updateDiscountRuleSchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const body = req.body as z.infer<typeof updateDiscountRuleSchema>;
    res.status(200).json({ data: await updateDiscountRule(authOf(req), id, body) });
  },
);
