/**
 * Fulfillment + inventory routes.
 *
 * Paths follow API_SPEC.md: the confirmed quotation *is* the order, so
 * `/api/orders/:id/...` resolves `:id` to a quotation id (see the note on
 * `fulfillments.quotation_id` in the schema).
 */

import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import {
  acceptPlan,
  consolidateBackorder,
  overridePlan,
  recalculatePlan,
  restockProduct,
  type OverrideSplit,
} from '../domain/fulfillment/fulfillment.service.js';
import { toAsync, actorFromRequest } from '../middleware/auth.js';
import { internalOnly, validateBody } from './helpers.js';

/** Mounted at `/api/orders`. */
export const orderFulfillmentRouter = Router();

orderFulfillmentRouter.get('/:id/fulfillment', internalOnly(), toAsync(async (req, res) => {
  const fulfillment = await db.query.fulfillments.findFirst({
    where: (table, { eq }) => eq(table.quotationId, String(req.params.id)),
    with: {
      allocations: { with: { warehouse: true, line: true } },
      backorders: { with: { availableWarehouse: true } },
      quotation: true,
    },
  });
  res.json({ fulfillment: fulfillment ?? null });
}));

orderFulfillmentRouter.post(
  '/:id/fulfillment/recalculate',
  internalOnly('SALES_REP', 'SALES_MANAGER', 'FINANCE_OPERATIONS', 'ADMIN'),
  toAsync(async (req, res) => {
    const fulfillment = await db.transaction((tx) =>
      recalculatePlan(tx, String(req.params.id), actorFromRequest(req)),
    );
    res.json({ fulfillment });
  }),
);

orderFulfillmentRouter.post(
  '/:id/fulfillment/accept',
  internalOnly('SALES_MANAGER', 'FINANCE_OPERATIONS', 'ADMIN'),
  toAsync(async (req, res) => {
    const fulfillment = await db.transaction((tx) =>
      acceptPlan(tx, String(req.params.id), actorFromRequest(req)),
    );
    res.json({ fulfillment });
  }),
);

orderFulfillmentRouter.post(
  '/:id/fulfillment/override',
  internalOnly('SALES_MANAGER', 'FINANCE_OPERATIONS', 'ADMIN'),
  validateBody(
    z.object({
      splits: z
        .array(
          z.object({
            quotationLineId: z.string().min(1),
            warehouseId: z.string().min(1),
            quantity: z.number().int().min(1),
          }),
        )
        .min(1),
    }),
  ),
  toAsync(async (req, res) => {
    const fulfillment = await db.transaction((tx) =>
      overridePlan(tx, String(req.params.id), req.body.splits as OverrideSplit[], actorFromRequest(req)),
    );
    res.json({ fulfillment });
  }),
);

/** Mounted at `/api/backorders`. */
export const backorderRouter = Router();

backorderRouter.post(
  '/:id/consolidate',
  internalOnly('SALES_MANAGER', 'FINANCE_OPERATIONS', 'ADMIN'),
  toAsync(async (req, res) => {
    const fulfillment = await db.transaction((tx) =>
      consolidateBackorder(tx, String(req.params.id), actorFromRequest(req)),
    );
    res.json({ fulfillment });
  }),
);

/** Mounted at `/api/stock`. Restock is what makes a backorder consolidatable. */
export const stockRouter = Router();

stockRouter.post(
  '/:productId/restock',
  internalOnly('FINANCE_OPERATIONS', 'ADMIN'),
  validateBody(z.object({ warehouseId: z.string().min(1), quantity: z.number().int().min(1) })),
  toAsync(async (req, res) => {
    await db.transaction((tx) =>
      restockProduct(tx, String(req.params.productId), req.body.warehouseId, req.body.quantity, actorFromRequest(req)),
    );
    res.status(204).end();
  }),
);