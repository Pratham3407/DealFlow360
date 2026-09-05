import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireCapability } from '../../http/middleware/auth';
import { validate } from '../../http/middleware/validate';
import { codeSchema, nameSchema, weightSchema } from '../../http/fields';
import { listQuerySchema } from '../../http/pagination';
import { Capability } from '../auth/permissions';
import {
  createProductPairing,
  createPromotion,
  listProductPairings,
  listPromotions,
  updateProductPairing,
  updatePromotion,
} from './recommendationConfigService';

const idParam = z.object({ id: z.uuid() });

const read = requireCapability(Capability.CATALOG_READ);
const write = requireCapability(Capability.PRODUCTS_CONFIGURE);

// ---------------------------------------------------------------------------
// /api/product-pairings
// ---------------------------------------------------------------------------

const createPairingSchema = z
  .object({
    productId: z.uuid(),
    recommendedProductId: z.uuid(),
    weight: weightSchema.optional(),
  })
  .strict();

const updatePairingSchema = z
  .object({
    weight: weightSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

const listPairingsQuerySchema = listQuerySchema.extend({ productId: z.uuid().optional() }).strict();

export const productPairingRoutes = Router();

productPairingRoutes.get(
  '/',
  read,
  validate({ query: listPairingsQuerySchema }),
  async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listPairingsQuerySchema>;
    res.status(200).json(await listProductPairings(query));
  },
);

productPairingRoutes.post('/', write, validate({ body: createPairingSchema }), async (req, res) => {
  const body = req.body as z.infer<typeof createPairingSchema>;
  res.status(201).json({ data: await createProductPairing(authOf(req), body) });
});

productPairingRoutes.patch(
  '/:id',
  write,
  validate({ params: idParam, body: updatePairingSchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const body = req.body as z.infer<typeof updatePairingSchema>;
    res.status(200).json({ data: await updateProductPairing(authOf(req), id, body) });
  },
);

// ---------------------------------------------------------------------------
// /api/promotions
// ---------------------------------------------------------------------------

/** ISO-8601 timestamp, coerced to a Date at the boundary. */
const timestampSchema = z.coerce.date();

const createPromotionSchema = z
  .object({
    code: codeSchema,
    name: nameSchema,
    productId: z.uuid(),
    priority: z.number().int().min(0).max(1000).optional(),
    startsAt: timestampSchema.nullish(),
    endsAt: timestampSchema.nullish(),
  })
  .strict();

const updatePromotionSchema = z
  .object({
    name: nameSchema.optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    startsAt: timestampSchema.nullish(),
    endsAt: timestampSchema.nullish(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

const listPromotionsQuerySchema = listQuerySchema
  .extend({
    productId: z.uuid().optional(),
    live: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();

export const promotionRoutes = Router();

promotionRoutes.get('/', read, validate({ query: listPromotionsQuerySchema }), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listPromotionsQuerySchema>;
  res.status(200).json(await listPromotions(query));
});

promotionRoutes.post('/', write, validate({ body: createPromotionSchema }), async (req, res) => {
  const body = req.body as z.infer<typeof createPromotionSchema>;
  res.status(201).json({ data: await createPromotion(authOf(req), body) });
});

promotionRoutes.patch(
  '/:id',
  write,
  validate({ params: idParam, body: updatePromotionSchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const body = req.body as z.infer<typeof updatePromotionSchema>;
    res.status(200).json({ data: await updatePromotion(authOf(req), id, body) });
  },
);
