import { Router } from 'express';
import { z } from 'zod';
import { Role } from '../../generated/prisma/enums';
import { authOf, requireCapability } from '../../http/middleware/auth';
import { validate } from '../../http/middleware/validate';
import { listQuerySchema } from '../../http/pagination';
import { Capability } from '../auth/permissions';
import { createUser, deactivateUser, listUsers } from './userService';

const createUserSchema = z
  .object({
    email: z.string().trim().min(3).max(320).toLowerCase().pipe(z.string().includes('@')),
    name: z.string().trim().min(1).max(200),
    // Long rather than ornate: length beats composition rules for real strength.
    password: z.string().min(10).max(200),
    role: z.enum(Role),
    customerId: z.uuid().nullish(),
  })
  .strict();

const deactivateSchema = z
  .object({ reason: z.string().trim().max(500).nullish() })
  .strict();

const listUsersQuerySchema = listQuerySchema.extend({ role: z.enum(Role).optional() }).strict();

const idParamSchema = z.object({ id: z.uuid() });

export const userRoutes = Router();

// Every route here is gated on users:manage, which only ADMIN holds
// (see modules/auth/permissions.ts).
userRoutes.use(requireCapability(Capability.USERS_MANAGE));

userRoutes.get('/', validate({ query: listUsersQuerySchema }), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listUsersQuerySchema>;
  res.status(200).json(await listUsers(query));
});

userRoutes.post('/', validate({ body: createUserSchema }), async (req, res) => {
  const input = req.body as z.infer<typeof createUserSchema>;
  const created = await createUser(authOf(req), {
    email: input.email,
    name: input.name,
    password: input.password,
    role: input.role,
    customerId: input.customerId ?? null,
  });
  res.status(201).json({ data: created });
});

userRoutes.post(
  '/:id/deactivate',
  validate({ params: idParamSchema, body: deactivateSchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParamSchema>;
    const { reason } = req.body as z.infer<typeof deactivateSchema>;
    res.status(200).json({ data: await deactivateUser(authOf(req), id, reason ?? null) });
  },
);
