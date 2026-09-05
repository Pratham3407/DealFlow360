import { Router } from 'express';
import { z } from 'zod';
import { ProductType } from '../../generated/prisma/enums';
import { authOf, requireCapability } from '../../http/middleware/auth';
import { validate } from '../../http/middleware/validate';
import {
  codeSchema,
  descriptionSchema,
  moneySchema,
  nameSchema,
  percentSchema,
} from '../../http/fields';
import { listQuerySchema } from '../../http/pagination';
import { Capability } from '../auth/permissions';
import {
  createCategory,
  createProduct,
  createProductVariant,
  getProduct,
  listCategories,
  listProductVariants,
  listProducts,
  updateCategory,
  updateProduct,
  updateProductVariant,
} from './catalogService';

const idParam = z.object({ id: z.uuid() });
const variantParams = z.object({ id: z.uuid(), variantId: z.uuid() });

const read = requireCapability(Capability.CATALOG_READ);
const write = requireCapability(Capability.PRODUCTS_CONFIGURE);

// ---------------------------------------------------------------------------
// /api/categories
// ---------------------------------------------------------------------------

const createCategorySchema = z
  .object({
    code: codeSchema,
    name: nameSchema,
    defaultMarginPercent: percentSchema.nullish(),
  })
  .strict();

const updateCategorySchema = z
  .object({
    name: nameSchema.optional(),
    defaultMarginPercent: percentSchema.nullish(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

export const categoryRoutes = Router();

categoryRoutes.get('/', read, validate({ query: listQuerySchema.strict() }), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listQuerySchema>;
  res.status(200).json(await listCategories(query));
});

categoryRoutes.post('/', write, validate({ body: createCategorySchema }), async (req, res) => {
  const body = req.body as z.infer<typeof createCategorySchema>;
  res.status(201).json({ data: await createCategory(authOf(req), body) });
});

categoryRoutes.patch(
  '/:id',
  write,
  validate({ params: idParam, body: updateCategorySchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const body = req.body as z.infer<typeof updateCategorySchema>;
    res.status(200).json({ data: await updateCategory(authOf(req), id, body) });
  },
);

// ---------------------------------------------------------------------------
// /api/products  (+ nested variants)
// ---------------------------------------------------------------------------

const createProductSchema = z
  .object({
    sku: codeSchema,
    name: nameSchema,
    categoryId: z.uuid(),
    productType: z.enum(ProductType),
    unit: z.string().trim().min(1).max(40).optional(),
    basePrice: moneySchema,
    costPrice: moneySchema,
    taxPercent: percentSchema.optional(),
    description: descriptionSchema.nullish(),
    subscriptionPlanId: z.uuid().nullish(),
  })
  .strict();

const updateProductSchema = z
  .object({
    name: nameSchema.optional(),
    categoryId: z.uuid().optional(),
    productType: z.enum(ProductType).optional(),
    unit: z.string().trim().min(1).max(40).optional(),
    basePrice: moneySchema.optional(),
    costPrice: moneySchema.optional(),
    taxPercent: percentSchema.optional(),
    description: descriptionSchema.nullish(),
    subscriptionPlanId: z.uuid().nullish(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

const listProductsQuerySchema = listQuerySchema
  .extend({
    categoryId: z.uuid().optional(),
    productType: z.enum(ProductType).optional(),
  })
  .strict();

const createVariantSchema = z
  .object({
    attribute: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(120),
    extraPrice: moneySchema.optional(),
  })
  .strict();

const updateVariantSchema = z
  .object({
    extraPrice: moneySchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

export const productRoutes = Router();

productRoutes.get('/', read, validate({ query: listProductsQuerySchema }), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listProductsQuerySchema>;
  res.status(200).json(await listProducts(query));
});

productRoutes.get('/:id', read, validate({ params: idParam }), async (req, res) => {
  const { id } = req.params as z.infer<typeof idParam>;
  res.status(200).json({ data: await getProduct(id) });
});

productRoutes.post('/', write, validate({ body: createProductSchema }), async (req, res) => {
  const body = req.body as z.infer<typeof createProductSchema>;
  res.status(201).json({ data: await createProduct(authOf(req), body) });
});

productRoutes.patch(
  '/:id',
  write,
  validate({ params: idParam, body: updateProductSchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const body = req.body as z.infer<typeof updateProductSchema>;
    res.status(200).json({ data: await updateProduct(authOf(req), id, body) });
  },
);

productRoutes.get(
  '/:id/variants',
  read,
  validate({ params: idParam, query: listQuerySchema.strict() }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const query = req.query as unknown as z.infer<typeof listQuerySchema>;
    res.status(200).json(await listProductVariants(id, query));
  },
);

productRoutes.post(
  '/:id/variants',
  write,
  validate({ params: idParam, body: createVariantSchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const body = req.body as z.infer<typeof createVariantSchema>;
    res.status(201).json({ data: await createProductVariant(authOf(req), id, body) });
  },
);

productRoutes.patch(
  '/:id/variants/:variantId',
  write,
  validate({ params: variantParams, body: updateVariantSchema }),
  async (req, res) => {
    const { id, variantId } = req.params as z.infer<typeof variantParams>;
    const body = req.body as z.infer<typeof updateVariantSchema>;
    res.status(200).json({ data: await updateProductVariant(authOf(req), id, variantId, body) });
  },
);
