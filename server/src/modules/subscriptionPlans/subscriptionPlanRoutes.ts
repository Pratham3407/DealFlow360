import { Router } from 'express';
import { z } from 'zod';
import {
  BillingInterval,
  CancellationRule,
  ProrationRule,
  RefundRule,
} from '../../generated/prisma/enums';
import { authOf, requireCapability } from '../../http/middleware/auth';
import { validate } from '../../http/middleware/validate';
import { codeSchema, nameSchema } from '../../http/fields';
import { listQuerySchema } from '../../http/pagination';
import { Capability } from '../auth/permissions';
import {
  createSubscriptionPlan,
  listSubscriptionPlans,
  updateSubscriptionPlan,
} from './subscriptionPlanService';

const idParam = z.object({ id: z.uuid() });

const createSchema = z
  .object({
    code: codeSchema,
    name: nameSchema,
    interval: z.enum(BillingInterval),
    prorationRule: z.enum(ProrationRule).optional(),
    cancellationRule: z.enum(CancellationRule).optional(),
    refundRule: z.enum(RefundRule).optional(),
  })
  .strict();

const updateSchema = z
  .object({
    name: nameSchema.optional(),
    interval: z.enum(BillingInterval).optional(),
    prorationRule: z.enum(ProrationRule).optional(),
    cancellationRule: z.enum(CancellationRule).optional(),
    refundRule: z.enum(RefundRule).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

export const subscriptionPlanRoutes = Router();

/**
 * Reads sit behind catalog:read because a plan is what makes a recurring product
 * sellable - a rep choosing a subscription line needs to see the cadence.
 */
subscriptionPlanRoutes.get(
  '/',
  requireCapability(Capability.CATALOG_READ),
  validate({ query: listQuerySchema.strict() }),
  async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listQuerySchema>;
    res.status(200).json(await listSubscriptionPlans(query));
  },
);

subscriptionPlanRoutes.post(
  '/',
  requireCapability(Capability.SUBSCRIPTION_PLANS_CONFIGURE),
  validate({ body: createSchema }),
  async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    res.status(201).json({ data: await createSubscriptionPlan(authOf(req), body) });
  },
);

subscriptionPlanRoutes.patch(
  '/:id',
  requireCapability(Capability.SUBSCRIPTION_PLANS_CONFIGURE),
  validate({ params: idParam, body: updateSchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const body = req.body as z.infer<typeof updateSchema>;
    res.status(200).json({ data: await updateSubscriptionPlan(authOf(req), id, body) });
  },
);
