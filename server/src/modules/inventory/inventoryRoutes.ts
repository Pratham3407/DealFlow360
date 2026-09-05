import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireCapability } from '../../http/middleware/auth';
import { validate } from '../../http/middleware/validate';
import { codeSchema, nameSchema, quantitySchema, weightSchema } from '../../http/fields';
import { listQuerySchema } from '../../http/pagination';
import { Capability } from '../auth/permissions';
import {
  createWarehouse,
  listWarehouseInventory,
  listWarehouses,
  receiveStock,
  setWarehouseStock,
  updateWarehouse,
} from './inventoryService';

const idParam = z.object({ id: z.uuid() });
const stockParams = z.object({ id: z.uuid(), productId: z.uuid() });

const read = requireCapability(Capability.INVENTORY_READ);
const write = requireCapability(Capability.WAREHOUSES_CONFIGURE);

const createWarehouseSchema = z
  .object({
    code: codeSchema,
    name: nameSchema,
    shippingWeight: weightSchema.optional(),
  })
  .strict();

const updateWarehouseSchema = z
  .object({
    name: nameSchema.optional(),
    shippingWeight: weightSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

/**
 * `reservedQuantity` is absent by design.
 *
 * Reserved units are already promised to a fulfillment; letting configuration
 * edit that counter would allow the same unit to be committed twice. Reservation
 * moves units out of `availableQuantity` inside the allocation transaction, which
 * belongs to the fulfillment slice.
 */
const setStockSchema = z
  .object({
    availableQuantity: quantitySchema.optional(),
    reorderPoint: quantitySchema.optional(),
    reason: z.string().trim().max(500).nullish(),
  })
  .strict()
  .refine(
    (body) => body.availableQuantity !== undefined || body.reorderPoint !== undefined,
    { message: 'provide availableQuantity or reorderPoint' },
  );

const receiveStockSchema = z
  .object({
    quantity: z.number().int().min(1).max(1_000_000_000),
    reference: z.string().trim().max(120).nullish(),
  })
  .strict();

export const warehouseRoutes = Router();

warehouseRoutes.get('/', read, validate({ query: listQuerySchema.strict() }), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listQuerySchema>;
  res.status(200).json(await listWarehouses(query));
});

warehouseRoutes.post('/', write, validate({ body: createWarehouseSchema }), async (req, res) => {
  const body = req.body as z.infer<typeof createWarehouseSchema>;
  res.status(201).json({ data: await createWarehouse(authOf(req), body) });
});

warehouseRoutes.patch(
  '/:id',
  write,
  validate({ params: idParam, body: updateWarehouseSchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const body = req.body as z.infer<typeof updateWarehouseSchema>;
    res.status(200).json({ data: await updateWarehouse(authOf(req), id, body) });
  },
);

warehouseRoutes.get(
  '/:id/inventory',
  read,
  validate({ params: idParam, query: listQuerySchema.strict() }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const query = req.query as unknown as z.infer<typeof listQuerySchema>;
    res.status(200).json(await listWarehouseInventory(id, query));
  },
);

warehouseRoutes.patch(
  '/:id/inventory/:productId',
  write,
  validate({ params: stockParams, body: setStockSchema }),
  async (req, res) => {
    const { id, productId } = req.params as z.infer<typeof stockParams>;
    const body = req.body as z.infer<typeof setStockSchema>;
    res.status(200).json({ data: await setWarehouseStock(authOf(req), id, productId, body) });
  },
);

/**
 * Stock arrival. A relative increment, so two concurrent replenishments cannot
 * overwrite one another.
 */
warehouseRoutes.post(
  '/:id/inventory/:productId/receive',
  write,
  validate({ params: stockParams, body: receiveStockSchema }),
  async (req, res) => {
    const { id, productId } = req.params as z.infer<typeof stockParams>;
    const body = req.body as z.infer<typeof receiveStockSchema>;
    res.status(200).json({ data: await receiveStock(authOf(req), id, productId, body) });
  },
);
