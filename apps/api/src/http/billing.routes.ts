/**
 * Billing routes: order billing, payments, subscriptions, credit notes.
 *
 * Paths follow API_SPEC.md — `/api/orders/:id/billing` (the confirmed quotation is
 * the order), `POST /api/payments`, `/api/subscriptions/:id/modify|cancel`.
 */

import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import {
  cancelSubscription,
  changeSubscriptionQuantity,
  generateBilling,
  getBillingForQuotation,
  issueCreditNote,
  recordPayment,
} from '../domain/billing/billing.service.js';
import { toAsync, actorFromRequest } from '../middleware/auth.js';
import { internalOnly, validateBody } from './helpers.js';

/** Mounted at `/api/orders`. */
export const orderBillingRouter = Router();

orderBillingRouter.get('/:id/billing', internalOnly(), toAsync(async (req, res) => {
  res.json(await getBillingForQuotation(db, String(req.params.id)));
}));

/**
 * Issue the invoice for a confirmed order.
 *
 * Open to the whole commercial side, not just Finance: the rep who closed the
 * deal is usually the first to know the customer has accepted, and making them
 * wait on Finance to press a button delays the invoice for no control benefit.
 * The control that matters is the state guard inside `generateBilling` — nothing
 * can be billed before the customer has confirmed the order — and the audit
 * record of who issued it. *Money movement* stays with Finance: recording a
 * payment and issuing a credit note are still Finance and Admin only.
 */
orderBillingRouter.post(
  '/:id/billing/generate',
  internalOnly('SALES_REP', 'SALES_MANAGER', 'FINANCE_OPERATIONS', 'ADMIN'),
  toAsync(async (req, res) => {
    const billing = await db.transaction((tx) =>
      generateBilling(tx, String(req.params.id), actorFromRequest(req)),
    );
    res.json(billing);
  }),
);

/** Mounted at `/api/payments`. */
export const paymentRouter = Router();

paymentRouter.post(
  '/',
  internalOnly('FINANCE_OPERATIONS', 'ADMIN'),
  validateBody(
    z.object({
      invoiceId: z.string().min(1),
      amountPaise: z.number().int().positive(),
      method: z.string().optional(),
      reference: z.string().optional(),
    }),
  ),
  toAsync(async (req, res) => {
    const result = await db.transaction((tx) =>
      recordPayment(
        tx,
        req.body.invoiceId,
        { amountPaise: req.body.amountPaise, method: req.body.method, reference: req.body.reference },
        actorFromRequest(req),
      ),
    );
    res.status(201).json(result);
  }),
);

/** Mounted at `/api/subscriptions`. */
export const subscriptionRouter = Router();

subscriptionRouter.get('/:id/schedule', internalOnly(), toAsync(async (req, res) => {
  const subscription = await db.query.subscriptions.findFirst({
    where: (table, { eq }) => eq(table.id, String(req.params.id)),
    with: { schedules: true, plan: true, product: true },
  });
  if (!subscription) {
    res.status(404).json({ error: { code: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found', details: {} } });
    return;
  }
  res.json({ subscription, schedule: subscription.schedules });
}));

subscriptionRouter.post(
  '/:id/modify',
  internalOnly('SALES_REP', 'SALES_MANAGER', 'FINANCE_OPERATIONS', 'ADMIN'),
  validateBody(
    z.object({
      newQuantity: z.number().int().min(1),
      effectiveDate: z.string().optional(),
    }),
  ),
  toAsync(async (req, res) => {
    const subscription = await db.transaction((tx) =>
      changeSubscriptionQuantity(
        tx,
        String(req.params.id),
        req.body.newQuantity,
        req.body.effectiveDate ? new Date(req.body.effectiveDate) : null,
        actorFromRequest(req),
      ),
    );
    res.json({ subscription });
  }),
);

subscriptionRouter.post(
  '/:id/cancel',
  internalOnly('SALES_MANAGER', 'FINANCE_OPERATIONS', 'ADMIN'),
  validateBody(z.object({ effectiveDate: z.string().optional(), reason: z.string().optional() })),
  toAsync(async (req, res) => {
    const subscription = await db.transaction((tx) =>
      cancelSubscription(
        tx,
        String(req.params.id),
        {
          effectiveDate: req.body.effectiveDate ? new Date(req.body.effectiveDate) : null,
          reason: req.body.reason,
        },
        actorFromRequest(req),
      ),
    );
    res.json({ subscription });
  }),
);

/** Mounted at `/api/credit-notes`. */
export const creditNoteRouter = Router();

creditNoteRouter.post(
  '/',
  internalOnly('FINANCE_OPERATIONS', 'ADMIN'),
  validateBody(
    z.object({
      invoiceId: z.string().min(1),
      subscriptionId: z.string().optional(),
      customerId: z.string().min(1),
      amountPaise: z.number().int().positive(),
      reason: z.string().min(1),
    }),
  ),
  toAsync(async (req, res) => {
    const creditNote = await db.transaction((tx) =>
      issueCreditNote(tx, {
        invoiceId: req.body.invoiceId,
        subscriptionId: req.body.subscriptionId,
        customerId: req.body.customerId,
        amountPaise: req.body.amountPaise,
        reason: req.body.reason,
        actor: actorFromRequest(req),
      }),
    );
    res.status(201).json({ creditNote });
  }),
);