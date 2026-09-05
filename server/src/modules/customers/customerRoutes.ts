import { Router } from 'express';
import { z } from 'zod';
import {
  assertCapability,
  authOf,
  requireAnyCapability,
  requireCapability,
} from '../../http/middleware/auth';
import { validate } from '../../http/middleware/validate';
import { codeSchema, nameSchema, percentSchema } from '../../http/fields';
import { listQuerySchema } from '../../http/pagination';
import { Capability } from '../auth/permissions';
import {
  createCustomer,
  createCustomerTier,
  getCustomer,
  listCustomerTiers,
  listCustomers,
  updateCustomer,
  updateCustomerTier,
} from './customerService';

const idParam = z.object({ id: z.uuid() });

// ---------------------------------------------------------------------------
// /api/customer-tiers
// ---------------------------------------------------------------------------

const createTierSchema = z
  .object({
    code: codeSchema,
    name: nameSchema,
    defaultDiscountCeiling: percentSchema,
  })
  .strict();

const updateTierSchema = z
  .object({
    name: nameSchema.optional(),
    defaultDiscountCeiling: percentSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

export const customerTierRoutes = Router();

customerTierRoutes.get(
  '/',
  requireCapability(Capability.CUSTOMERS_READ),
  validate({ query: listQuerySchema.strict() }),
  async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listQuerySchema>;
    res.status(200).json(await listCustomerTiers(query));
  },
);

/**
 * A tier is customer master data to an administrator and a discount ceiling to a
 * sales manager, and docs/RBAC.md grants those two different capabilities. The
 * router admits either, then each handler narrows which fields the caller may
 * actually touch.
 */
customerTierRoutes.post(
  '/',
  requireAnyCapability(Capability.CUSTOMERS_CONFIGURE, Capability.DISCOUNT_RULES_CONFIGURE),
  validate({ body: createTierSchema }),
  async (req, res) => {
    const actor = authOf(req);
    // Creating a tier defines both its identity and its ceiling.
    assertCapability(actor, Capability.CUSTOMERS_CONFIGURE, 'Only an administrator may create a customer tier');
    const body = req.body as z.infer<typeof createTierSchema>;
    res.status(201).json({ data: await createCustomerTier(actor, body) });
  },
);

customerTierRoutes.patch(
  '/:id',
  requireAnyCapability(Capability.CUSTOMERS_CONFIGURE, Capability.DISCOUNT_RULES_CONFIGURE),
  validate({ params: idParam, body: updateTierSchema }),
  async (req, res) => {
    const actor = authOf(req);
    const body = req.body as z.infer<typeof updateTierSchema>;
    const { id } = req.params as z.infer<typeof idParam>;

    if (body.defaultDiscountCeiling !== undefined) {
      assertCapability(
        actor,
        Capability.DISCOUNT_RULES_CONFIGURE,
        'Changing a discount ceiling requires discount rule configuration rights',
      );
    }
    if (body.name !== undefined || body.active !== undefined) {
      assertCapability(
        actor,
        Capability.CUSTOMERS_CONFIGURE,
        'Renaming or deactivating a tier requires customer configuration rights',
      );
    }

    res.status(200).json({ data: await updateCustomerTier(actor, id, body) });
  },
);

// ---------------------------------------------------------------------------
// /api/customers
// ---------------------------------------------------------------------------

const contactSchema = {
  contactName: nameSchema.nullish(),
  contactEmail: z.string().trim().max(320).pipe(z.email()).nullish(),
  contactPhone: z.string().trim().max(40).nullish(),
  billingAddress: z.string().trim().max(1000).nullish(),
};

const createCustomerSchema = z
  .object({
    code: codeSchema,
    name: nameSchema,
    tierId: z.uuid(),
    ...contactSchema,
  })
  .strict();

const updateCustomerSchema = z
  .object({
    name: nameSchema.optional(),
    tierId: z.uuid().optional(),
    active: z.boolean().optional(),
    ...contactSchema,
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

const listCustomersQuerySchema = listQuerySchema.extend({ tierId: z.uuid().optional() }).strict();

export const customerRoutes = Router();

customerRoutes.get(
  '/',
  requireCapability(Capability.CUSTOMERS_READ),
  validate({ query: listCustomersQuerySchema }),
  async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listCustomersQuerySchema>;
    res.status(200).json(await listCustomers(query));
  },
);

customerRoutes.get(
  '/:id',
  requireCapability(Capability.CUSTOMERS_READ),
  validate({ params: idParam }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParam>;
    res.status(200).json({ data: await getCustomer(id) });
  },
);

customerRoutes.post(
  '/',
  requireCapability(Capability.CUSTOMERS_CONFIGURE),
  validate({ body: createCustomerSchema }),
  async (req, res) => {
    const body = req.body as z.infer<typeof createCustomerSchema>;
    res.status(201).json({ data: await createCustomer(authOf(req), body) });
  },
);

customerRoutes.patch(
  '/:id',
  requireCapability(Capability.CUSTOMERS_CONFIGURE),
  validate({ params: idParam, body: updateCustomerSchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const body = req.body as z.infer<typeof updateCustomerSchema>;
    res.status(200).json({ data: await updateCustomer(authOf(req), id, body) });
  },
);
