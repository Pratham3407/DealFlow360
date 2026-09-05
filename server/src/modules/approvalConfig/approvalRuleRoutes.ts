import { Router } from 'express';
import { z } from 'zod';
import { ApprovalLevelRequirement } from '../../generated/prisma/enums';
import { authOf, requireCapability } from '../../http/middleware/auth';
import { validate } from '../../http/middleware/validate';
import { nameSchema } from '../../http/fields';
import { listQuerySchema } from '../../http/pagination';
import { Capability } from '../auth/permissions';
import { createApprovalRule, listApprovalRules, updateApprovalRule } from './approvalRuleService';

const idParam = z.object({ id: z.uuid() });

/**
 * Risk scores run 0-100 on the blended scale documented in AGENTS.md, with four
 * decimals to match `Decimal(10,4)`.
 */
const riskSchema = z
  .number()
  .min(0)
  .max(100)
  .refine((value) => Math.round(value * 10_000) === value * 10_000, {
    message: 'supports at most 4 decimal places',
  });

const createSchema = z
  .object({
    name: nameSchema,
    minimumRisk: riskSchema,
    /** Null or omitted makes this the unbounded top band. */
    maximumRisk: riskSchema.nullish(),
    requiredLevel: z.enum(ApprovalLevelRequirement),
    priority: z.number().int().min(0).max(1000).optional(),
  })
  .strict();

const updateSchema = z
  .object({
    name: nameSchema.optional(),
    minimumRisk: riskSchema.optional(),
    maximumRisk: riskSchema.nullish(),
    requiredLevel: z.enum(ApprovalLevelRequirement).optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

export const approvalRuleRoutes = Router();

approvalRuleRoutes.get(
  '/',
  requireCapability(Capability.PRICING_READ),
  validate({ query: listQuerySchema.strict() }),
  async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listQuerySchema>;
    res.status(200).json(await listApprovalRules(query));
  },
);

approvalRuleRoutes.post(
  '/',
  requireCapability(Capability.APPROVAL_RULES_CONFIGURE),
  validate({ body: createSchema }),
  async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    res.status(201).json({ data: await createApprovalRule(authOf(req), body) });
  },
);

approvalRuleRoutes.patch(
  '/:id',
  requireCapability(Capability.APPROVAL_RULES_CONFIGURE),
  validate({ params: idParam, body: updateSchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const body = req.body as z.infer<typeof updateSchema>;
    res.status(200).json({ data: await updateApprovalRule(authOf(req), id, body) });
  },
);
