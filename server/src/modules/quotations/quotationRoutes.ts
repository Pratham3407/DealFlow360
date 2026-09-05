import { Router } from 'express';
import { z } from 'zod';
import { QuotationStatus } from '../../generated/prisma/enums';
import { authOf, requireCapability } from '../../http/middleware/auth';
import { validate } from '../../http/middleware/validate';
import { descriptionSchema, percentSchema } from '../../http/fields';
import { listQuerySchema } from '../../http/pagination';
import { Capability } from '../auth/permissions';
import {
  createQuotation,
  getQuotation,
  listQuotations,
  recalculate,
  submitQuotation,
  updateQuotation,
} from './quotationService';
import {
  addQuotationLine,
  removeQuotationLine,
  updateQuotationLine,
} from './quotationLineService';

const idParam = z.object({ id: z.uuid() });
const lineParams = z.object({ id: z.uuid(), lineId: z.uuid() });

/**
 * Optimistic concurrency token, required on every mutation.
 *
 * A client must state which version it believes it is changing; the service
 * rejects a stale one with 409 VERSION_CONFLICT rather than overwriting newer
 * commercial state.
 */
const versionField = z.number().int().min(1);

/** Calendar date, coerced at the boundary. */
const dateSchema = z.coerce.date();

const quantitySchema = z.number().int().min(1).max(1_000_000);

/**
 * Note what these schemas do NOT accept: status, version as a settable field,
 * quoteNumber, unitPrice, unitCost, any line or quotation total, margin, riskScore
 * or approvedVersion. Schemas are strict, so a request carrying one is rejected
 * 400 rather than silently ignored — the server is the sole author of every
 * derived and lifecycle field.
 */
const createSchema = z
  .object({
    customerId: z.uuid(),
    salesRepId: z.uuid().nullish(),
    notes: descriptionSchema.nullish(),
    validUntil: dateSchema.nullish(),
  })
  .strict();

const updateSchema = z
  .object({
    version: versionField,
    customerId: z.uuid().optional(),
    orderDiscountPercent: percentSchema.optional(),
    notes: descriptionSchema.nullish(),
    validUntil: dateSchema.nullish(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 1, {
    message: 'provide at least one field to update alongside version',
  });

const versionOnlySchema = z.object({ version: versionField }).strict();

const addLineSchema = z
  .object({
    version: versionField,
    productId: z.uuid(),
    variantId: z.uuid().nullish(),
    quantity: quantitySchema,
    discountPercent: percentSchema.optional(),
  })
  .strict();

const updateLineSchema = z
  .object({
    version: versionField,
    quantity: quantitySchema.optional(),
    discountPercent: percentSchema.optional(),
    variantId: z.uuid().nullish(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 1, {
    message: 'provide at least one field to update alongside version',
  });

const listSchema = listQuerySchema
  .extend({
    status: z.enum(QuotationStatus).optional(),
    customerId: z.uuid().optional(),
    salesRepId: z.uuid().optional(),
  })
  .strict();

export const quotationRoutes = Router();

const read = requireCapability(Capability.QUOTATIONS_READ_INTERNAL);
const edit = requireCapability(Capability.QUOTATIONS_EDIT);

quotationRoutes.get('/', read, validate({ query: listSchema }), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listSchema>;
  res.status(200).json(await listQuotations(authOf(req), query));
});

quotationRoutes.get('/:id', read, validate({ params: idParam }), async (req, res) => {
  const { id } = req.params as z.infer<typeof idParam>;
  res.status(200).json({ data: await getQuotation(authOf(req), id) });
});

quotationRoutes.post(
  '/',
  requireCapability(Capability.QUOTATIONS_CREATE),
  validate({ body: createSchema }),
  async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    res.status(201).json({
      data: await createQuotation(authOf(req), {
        customerId: body.customerId,
        salesRepId: body.salesRepId ?? null,
        notes: body.notes ?? null,
        validUntil: body.validUntil ?? null,
      }),
    });
  },
);

quotationRoutes.patch(
  '/:id',
  edit,
  validate({ params: idParam, body: updateSchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const body = req.body as z.infer<typeof updateSchema>;
    res.status(200).json({ data: await updateQuotation(authOf(req), id, body) });
  },
);

/** Idempotent; recomputes stored figures from the lines without bumping version. */
quotationRoutes.post(
  '/:id/recalculate',
  edit,
  validate({ params: idParam }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParam>;
    res.status(200).json({ data: await recalculate(authOf(req), id) });
  },
);

/**
 * Submit for approval. Risk scoring (slice 4) will decide the target state; the
 * transition, its guards and the audit shape are established here.
 */
quotationRoutes.post(
  '/:id/submit',
  edit,
  validate({ params: idParam, body: versionOnlySchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const { version } = req.body as z.infer<typeof versionOnlySchema>;
    res.status(200).json({ data: await submitQuotation(authOf(req), id, version) });
  },
);

// ---------------------------------------------------------------------------
// Lines
//
// Every line mutation returns the whole quotation, because a line change alters
// the quotation's totals and version. Returning only the line would leave a
// client holding a stale version and unable to make its next call.
// ---------------------------------------------------------------------------

quotationRoutes.post(
  '/:id/lines',
  edit,
  validate({ params: idParam, body: addLineSchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const body = req.body as z.infer<typeof addLineSchema>;
    const auth = authOf(req);

    await addQuotationLine(auth, id, {
      version: body.version,
      productId: body.productId,
      variantId: body.variantId ?? null,
      quantity: body.quantity,
      discountPercent: body.discountPercent,
    });

    res.status(201).json({ data: await getQuotation(auth, id) });
  },
);

quotationRoutes.patch(
  '/:id/lines/:lineId',
  edit,
  validate({ params: lineParams, body: updateLineSchema }),
  async (req, res) => {
    const { id, lineId } = req.params as z.infer<typeof lineParams>;
    const body = req.body as z.infer<typeof updateLineSchema>;
    const auth = authOf(req);

    await updateQuotationLine(auth, id, lineId, body);
    res.status(200).json({ data: await getQuotation(auth, id) });
  },
);

/**
 * Removal needs the version too, so it cannot be replayed against a quotation
 * that has since changed. It arrives in the body rather than the query string
 * because it is part of the command, not a filter.
 */
quotationRoutes.delete(
  '/:id/lines/:lineId',
  edit,
  validate({ params: lineParams, body: versionOnlySchema }),
  async (req, res) => {
    const { id, lineId } = req.params as z.infer<typeof lineParams>;
    const { version } = req.body as z.infer<typeof versionOnlySchema>;
    const auth = authOf(req);

    await removeQuotationLine(auth, id, lineId, version);
    res.status(200).json({ data: await getQuotation(auth, id) });
  },
);
