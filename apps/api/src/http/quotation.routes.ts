/**
 * Quotation lifecycle routes + recommendations + approvals (internal workspace).
 *
 * Guards are attached per route rather than with `router.use`, so an unmatched path
 * still reaches the 404 handler and a router mounted at a shared prefix cannot
 * reject another router's requests.
 */

import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import {
  addLine,
  applyNegotiation,
  confirmQuotation,
  createQuotation,
  getQuotation,
  listQuotations,
  recalculateQuote,
  removeLine,
  sendQuotation,
  setOrderDiscount,
  updateLine,
} from '../domain/quotation/quotation.service.js';
import {
  dismissRecommendation,
  listRecommendations,
} from '../domain/recommendation/recommendation.service.js';
import {
  approveApproval,
  getApproval,
  listApprovals,
  rejectApproval,
  returnForRevision,
} from '../domain/approval/approval.service.js';
import { queryAudit } from '../domain/audit/audit.service.js';
import { toAsync, actorFromRequest } from '../middleware/auth.js';
import { internalOnly, validateBody, optionalDate, optionalString } from './helpers.js';
import { notFound } from '../lib/errors.js';

/** Roles that may author commercial changes on a quote. */
const AUTHORS = ['SALES_REP', 'SALES_MANAGER', 'ADMIN'] as const;

export const quotationRouter = Router();

quotationRouter.get('/', internalOnly(), toAsync(async (req, res) => {
  const quotes = await listQuotations(db, {
    customerId: optionalString(req.query.customerId),
    salesRepId: optionalString(req.query.salesRepId),
    status: optionalString(req.query.status) as never,
    from: optionalDate(req.query.from),
    to: optionalDate(req.query.to),
    limit: Number(req.query.limit) || 100,
    offset: Number(req.query.offset) || 0,
  });
  res.json({ data: quotes });
}));

quotationRouter.post(
  '/',
  internalOnly(...AUTHORS),
  validateBody(
    z.object({
      customerId: z.string().min(1),
      /** Managers/admins may raise a quote on behalf of a rep; defaults to self. */
      salesRepId: z.string().min(1).optional(),
      notes: z.string().optional(),
      promisedDeliveryDate: z.string().optional(),
      orderDiscountBp: z.number().int().min(0).max(10000).optional(),
    }),
  ),
  toAsync(async (req, res) => {
    const user = req.user!;
    const quote = await db.transaction((tx) =>
      createQuotation(tx, {
        customerId: req.body.customerId,
        salesRepId: req.body.salesRepId ?? user.id,
        notes: req.body.notes,
        promisedDeliveryDate: req.body.promisedDeliveryDate
          ? new Date(req.body.promisedDeliveryDate)
          : undefined,
        orderDiscountBp: req.body.orderDiscountBp,
      }),
    );
    res.status(201).json({ quote });
  }),
);

quotationRouter.get('/:id', internalOnly(), toAsync(async (req, res) => {
  const quote = await getQuotation(db, String(req.params.id));
  if (!quote) throw notFound('QUOTE_NOT_FOUND', 'Quotation not found');
  res.json({ quote });
}));

/** Audit trail for one quotation (PRD §20 — "who changed what, when and why"). */
quotationRouter.get('/:id/audit', internalOnly(), toAsync(async (req, res) => {
  const rows = await queryAudit(db, {
    quotationId: String(req.params.id),
    limit: Number(req.query.limit) || 200,
  });
  res.json({ data: rows });
}));

/**
 * Commercial edits. The order-level discount is routed through `setOrderDiscount`
 * so it bumps the version and re-runs the risk engine; notes and dates do not.
 */
quotationRouter.patch(
  '/:id',
  internalOnly(...AUTHORS),
  validateBody(
    z.object({
      orderDiscountBp: z.number().int().min(0).max(10000).optional(),
    }),
  ),
  toAsync(async (req, res) => {
    if (req.body.orderDiscountBp === undefined) {
      res.status(400).json({
        error: { code: 'NOTHING_TO_UPDATE', message: 'Provide orderDiscountBp', details: {} },
      });
      return;
    }
    const result = await db.transaction((tx) =>
      setOrderDiscount(tx, String(req.params.id), req.body.orderDiscountBp, actorFromRequest(req)),
    );
    res.json(result);
  }),
);

quotationRouter.post(
  '/:id/lines',
  internalOnly(...AUTHORS),
  validateBody(
    z.object({
      productId: z.string().min(1),
      quantity: z.number().int().min(1).optional(),
      variantId: z.string().optional(),
      discountBp: z.number().int().min(0).max(10000).optional(),
      fromRecommendation: z.boolean().optional(),
    }),
  ),
  toAsync(async (req, res) => {
    const result = await db.transaction((tx) =>
      addLine(tx, String(req.params.id), req.body, actorFromRequest(req)),
    );
    res.status(201).json(result);
  }),
);

quotationRouter.patch(
  '/:id/lines/:lineId',
  internalOnly(...AUTHORS),
  validateBody(
    z.object({
      quantity: z.number().int().min(1).optional(),
      discountBp: z.number().int().min(0).max(10000).optional(),
    }),
  ),
  toAsync(async (req, res) => {
    const result = await db.transaction((tx) =>
      updateLine(tx, String(req.params.id), String(req.params.lineId), req.body, actorFromRequest(req)),
    );
    res.json(result);
  }),
);

quotationRouter.delete('/:id/lines/:lineId', internalOnly(...AUTHORS), toAsync(async (req, res) => {
  const result = await db.transaction((tx) =>
    removeLine(tx, String(req.params.id), String(req.params.lineId), actorFromRequest(req)),
  );
  res.json(result);
}));

quotationRouter.post('/:id/recalculate', internalOnly(...AUTHORS), toAsync(async (req, res) => {
  const result = await db.transaction((tx) =>
    recalculateQuote(tx, String(req.params.id), { bumpVersion: false, reason: 'Manual recalculation' }),
  );
  res.json(result);
}));

quotationRouter.post('/:id/confirm', internalOnly(...AUTHORS), toAsync(async (req, res) => {
  const quote = await db.transaction((tx) =>
    confirmQuotation(tx, String(req.params.id), actorFromRequest(req)),
  );
  res.json({ quote });
}));

quotationRouter.post('/:id/send', internalOnly(...AUTHORS), toAsync(async (req, res) => {
  const quote = await db.transaction((tx) =>
    sendQuotation(tx, String(req.params.id), actorFromRequest(req)),
  );
  res.json({ quote });
}));

quotationRouter.post(
  '/:id/negotiations/:requestId/apply',
  internalOnly(...AUTHORS),
  toAsync(async (req, res) => {
    const quote = await db.transaction((tx) =>
      applyNegotiation(tx, String(req.params.requestId), actorFromRequest(req)),
    );
    res.json({ quote });
  }),
);

// ---- recommendations ------------------------------------------------------

quotationRouter.get('/:id/recommendations', internalOnly(), toAsync(async (req, res) => {
  res.json({ data: await listRecommendations(db, String(req.params.id)) });
}));

/** Accept a suggestion: adds the line and flags it as recommendation-sourced. */
quotationRouter.post(
  '/:id/recommendations/:productId/add',
  internalOnly(...AUTHORS),
  validateBody(
    z.object({
      quantity: z.number().int().min(1).optional(),
      discountBp: z.number().int().min(0).max(10000).optional(),
    }),
  ),
  toAsync(async (req, res) => {
    const result = await db.transaction((tx) =>
      addLine(
        tx,
        String(req.params.id),
        {
          productId: String(req.params.productId),
          quantity: req.body.quantity,
          discountBp: req.body.discountBp,
          fromRecommendation: true,
        },
        actorFromRequest(req),
      ),
    );
    res.status(201).json(result);
  }),
);

quotationRouter.post(
  '/:id/recommendations/:productId/dismiss',
  internalOnly(...AUTHORS),
  toAsync(async (req, res) => {
    await db.transaction((tx) =>
      dismissRecommendation(tx, String(req.params.id), String(req.params.productId), actorFromRequest(req)),
    );
    res.status(204).end();
  }),
);

// ---- approvals ------------------------------------------------------------

/** Mounted at `/api/approvals`. The service enforces which role may act on a rung. */
export const approvalRouter = Router();

const REVIEWERS = ['SALES_MANAGER', 'FINANCE_OPERATIONS', 'ADMIN'] as const;

approvalRouter.get('/', internalOnly(), toAsync(async (req, res) => {
  const rows = await listApprovals(
    db,
    optionalString(req.query.quotationId),
    optionalString(req.query.onlyPending) !== 'false',
  );
  res.json({ data: rows });
}));

approvalRouter.get('/:id', internalOnly(), toAsync(async (req, res) => {
  const approval = await getApproval(db, String(req.params.id));
  if (!approval) throw notFound('APPROVAL_NOT_FOUND', 'Approval not found');
  res.json({ approval });
}));

approvalRouter.post(
  '/:id/approve',
  internalOnly(...REVIEWERS),
  validateBody(z.object({ reason: z.string().optional() })),
  toAsync(async (req, res) => {
    const approval = await db.transaction((tx) =>
      approveApproval(tx, String(req.params.id), actorFromRequest(req), req.body.reason),
    );
    res.json({ approval });
  }),
);

approvalRouter.post(
  '/:id/reject',
  internalOnly(...REVIEWERS),
  validateBody(z.object({ reason: z.string().min(1) })),
  toAsync(async (req, res) => {
    const approval = await db.transaction((tx) =>
      rejectApproval(tx, String(req.params.id), actorFromRequest(req), req.body.reason),
    );
    res.json({ approval });
  }),
);

approvalRouter.post(
  '/:id/return',
  internalOnly(...REVIEWERS),
  validateBody(z.object({ reason: z.string().min(1) })),
  toAsync(async (req, res) => {
    const approval = await db.transaction((tx) =>
      returnForRevision(tx, String(req.params.id), actorFromRequest(req), req.body.reason),
    );
    res.json({ approval });
  }),
);