/**
 * Customer portal routes — everything scoped to the authenticated customer.
 *
 * The customer id always comes from the authenticated user record, never from the
 * request, which is the isolation rule RBAC.md states. Paths follow API_SPEC.md
 * (`/api/portal/quotations`).
 */

import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import {
  confirmPortalQuotation,
  getPortalQuotation,
  listPortalQuotations,
  submitPortalNegotiation,
} from '../domain/portal/portal.service.js';
import { toAsync, actorFromRequest } from '../middleware/auth.js';
import { portalOnly, validateBody } from './helpers.js';
import { NEGOTIATION_REQUEST_TYPES } from '@dealflow/shared';

export const portalRouter = Router();

portalRouter.get('/quotations', portalOnly(), toAsync(async (req, res) => {
  const customerId = req.user!.customerId!;
  res.json({ data: await listPortalQuotations(db, customerId) });
}));

portalRouter.get('/quotations/:id', portalOnly(), toAsync(async (req, res) => {
  const customerId = req.user!.customerId!;
  res.json({ quote: await getPortalQuotation(db, customerId, String(req.params.id)) });
}));

portalRouter.post(
  '/quotations/:id/negotiations',
  portalOnly(),
  validateBody(
    z.object({
      requestType: z.enum(NEGOTIATION_REQUEST_TYPES),
      lineId: z.string().optional(),
      proposedDiscountBp: z.number().int().min(0).max(10000).optional(),
      proposedQuantity: z.number().int().min(1).optional(),
      comment: z.string().optional(),
      /** The version the customer was looking at; a stale value is rejected. */
      version: z.number().int().min(1),
    }),
  ),
  toAsync(async (req, res) => {
    const customerId = req.user!.customerId!;
    const request = await db.transaction((tx) =>
      submitPortalNegotiation(
        tx,
        customerId,
        String(req.params.id),
        {
          requestType: req.body.requestType,
          lineId: req.body.lineId,
          proposedDiscountBp: req.body.proposedDiscountBp,
          proposedQuantity: req.body.proposedQuantity,
          comment: req.body.comment,
          version: req.body.version,
        },
        { ...actorFromRequest(req), customerId },
      ),
    );
    res.status(201).json({ request });
  }),
);

portalRouter.post('/quotations/:id/confirm', portalOnly(), toAsync(async (req, res) => {
  const customerId = req.user!.customerId!;
  const quote = await db.transaction((tx) =>
    confirmPortalQuotation(tx, customerId, String(req.params.id), {
      ...actorFromRequest(req),
      customerId,
    }),
  );
  res.json({ quote });
}));