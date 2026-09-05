import { ProductType } from '../../generated/prisma/enums';
import { prisma } from '../../db/prisma';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../http/errors';
import { MONEY_SCALE, PERCENT_SCALE, toDecimalString } from '../../http/fields';
import type { AuthContext } from '../../http/types';
import { AuditAction, AuditEntity, recordAudit } from '../audit/auditService';
import { toJsonValue } from '../audit/configAudit';
import { resolveUnitPrice } from '../pricing/priceResolution';
import { assertDiscountCapability } from './quotationService';
import {
  assertOwnership,
  assertVersion,
  bumpVersion,
  findQuotationForActor,
  recalculateQuotation,
} from './quotationShared';
import { assertEditable } from './quotationStates';

/**
 * Quotation line operations.
 *
 * Every mutation here is a material commercial change, so each one bumps the
 * quotation version, recalculates the stored figures and writes an audit row —
 * all inside one transaction, so a quotation can never be left with lines that
 * disagree with its totals.
 *
 * Prices and costs are never accepted from the client: they are resolved through
 * the pricing module and snapshotted onto the line, so a historical quotation
 * stays reproducible when the catalogue changes.
 */

export interface AddLineInput {
  version: number;
  productId: string;
  variantId?: string | null;
  quantity: number;
  discountPercent?: number | undefined;
}

export interface UpdateLineInput {
  version: number;
  quantity?: number | undefined;
  discountPercent?: number | undefined;
  variantId?: string | null | undefined;
}

/**
 * Add a line, or merge into the existing line for the same product and variant.
 *
 * Merging rather than duplicating: two lines for the same product on identical
 * terms are the same commercial fact, and a duplicate would double-count in
 * fulfillment and billing. A different variant or a different discount is a
 * different commercial fact, so those stay separate lines.
 */
export async function addQuotationLine(
  auth: AuthContext,
  quotationId: string,
  input: AddLineInput,
): Promise<void> {
  const quotation = await findQuotationForActor(auth, quotationId);
  assertOwnership(auth, quotation.salesRepId);
  assertVersion(quotation.version, input.version);
  assertEditable(quotation.status);

  if (input.discountPercent !== undefined && input.discountPercent > 0) {
    assertDiscountCapability(auth);
  }

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { active: true, productType: true, subscriptionPlanId: true },
  });
  if (!product) throw new NotFoundError('Product not found');
  if (!product.active) {
    throw new ConflictError('That product is deactivated and cannot be quoted');
  }

  if (input.variantId) await assertVariantUsable(input.productId, input.variantId);

  // Mirrors products_recurring_requires_plan_check: a recurring line without a
  // cadence could not produce a billing schedule (docs/WORKFLOWS.md 8).
  if (product.productType === ProductType.RECURRING && !product.subscriptionPlanId) {
    throw new BusinessRuleError(
      'That recurring product has no subscription plan, so it cannot be quoted',
    );
  }

  const resolved = await resolveUnitPrice({
    customerId: quotation.customerId,
    productId: input.productId,
    variantId: input.variantId ?? null,
  });

  const discountPercent = toDecimalString(input.discountPercent ?? 0, PERCENT_SCALE);

  const existing = await prisma.quotationLine.findFirst({
    where: {
      quotationId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      discountPercent,
    },
    select: { id: true, quantity: true },
  });

  await prisma.$transaction(async (tx) => {
    const version = await bumpVersion(tx, quotationId, input.version);

    if (existing) {
      const mergedQuantity = existing.quantity + input.quantity;
      await tx.quotationLine.update({
        where: { id: existing.id },
        data: { quantity: mergedQuantity },
      });

      await recordAudit(tx, {
        action: AuditAction.QUOTATION_LINE_ADDED,
        entityType: AuditEntity.QUOTATION_LINE,
        entityId: existing.id,
        actorUserId: auth.userId,
        actorRole: auth.role,
        entityVersion: version,
        reason: 'Merged into the existing line for the same product, variant and discount',
        oldValue: toJsonValue({ quantity: existing.quantity }),
        newValue: toJsonValue({ quotationId, productId: input.productId, quantity: mergedQuantity }),
      });
    } else {
      // Positions are a sparse ordering key: append at max + 1 and never renumber,
      // because renumbering after a delete would transiently collide with the
      // (quotationId, position) unique index.
      const last = await tx.quotationLine.findFirst({
        where: { quotationId },
        select: { position: true },
        orderBy: { position: 'desc' },
      });

      const created = await tx.quotationLine.create({
        data: {
          quotationId,
          productId: input.productId,
          variantId: input.variantId ?? null,
          position: (last?.position ?? 0) + 1,
          quantity: input.quantity,
          unitPrice: resolved.unitPrice.toFixed(MONEY_SCALE),
          unitCost: resolved.unitCost.toFixed(MONEY_SCALE),
          discountPercent,
          taxPercent: resolved.taxPercent.toFixed(PERCENT_SCALE),
          lineType: resolved.productType,
          subscriptionPlanId: resolved.subscriptionPlanId,
        },
        select: { id: true },
      });

      await recordAudit(tx, {
        action: AuditAction.QUOTATION_LINE_ADDED,
        entityType: AuditEntity.QUOTATION_LINE,
        entityId: created.id,
        actorUserId: auth.userId,
        actorRole: auth.role,
        entityVersion: version,
        newValue: toJsonValue({
          quotationId,
          productId: input.productId,
          variantId: input.variantId ?? null,
          quantity: input.quantity,
          unitPrice: resolved.unitPrice.toFixed(MONEY_SCALE),
          discountPercent,
          priceSource: resolved.source,
        }),
      });
    }

    await recalculateQuotation(tx, quotationId);
  });
}

export async function updateQuotationLine(
  auth: AuthContext,
  quotationId: string,
  lineId: string,
  input: UpdateLineInput,
): Promise<void> {
  const quotation = await findQuotationForActor(auth, quotationId);
  assertOwnership(auth, quotation.salesRepId);
  assertVersion(quotation.version, input.version);
  assertEditable(quotation.status);

  const line = await prisma.quotationLine.findUnique({
    where: { id: lineId },
    select: {
      quotationId: true,
      productId: true,
      variantId: true,
      quantity: true,
      discountPercent: true,
      unitPrice: true,
    },
  });
  // Ownership as well as existence, so a line cannot be reached through another
  // quotation's URL.
  if (!line || line.quotationId !== quotationId) throw new NotFoundError('Quotation line not found');

  if (input.discountPercent !== undefined) assertDiscountCapability(auth);

  const changes: Record<string, { before: unknown; after: unknown }> = {};
  const data: Record<string, unknown> = {};

  if (input.quantity !== undefined && input.quantity !== line.quantity) {
    data['quantity'] = input.quantity;
    changes['quantity'] = { before: line.quantity, after: input.quantity };
  }

  if (input.discountPercent !== undefined) {
    const next = toDecimalString(input.discountPercent, PERCENT_SCALE);
    const before = line.discountPercent.toFixed(PERCENT_SCALE);
    if (next !== before) {
      data['discountPercent'] = next;
      changes['discountPercent'] = { before, after: next };
    }
  }

  // Changing the variant changes the price, so the snapshot is re-resolved rather
  // than adjusted by hand.
  if (input.variantId !== undefined && (input.variantId ?? null) !== line.variantId) {
    if (input.variantId) await assertVariantUsable(line.productId, input.variantId);

    const resolved = await resolveUnitPrice({
      customerId: quotation.customerId,
      productId: line.productId,
      variantId: input.variantId ?? null,
    });

    data['variantId'] = input.variantId ?? null;
    data['unitPrice'] = resolved.unitPrice.toFixed(MONEY_SCALE);
    changes['variantId'] = { before: line.variantId, after: input.variantId ?? null };
    changes['unitPrice'] = {
      before: line.unitPrice.toFixed(MONEY_SCALE),
      after: resolved.unitPrice.toFixed(MONEY_SCALE),
    };
  }

  // No-op patch: no version bump, no audit row, no recalculation.
  if (Object.keys(changes).length === 0) return;

  await prisma.$transaction(async (tx) => {
    const version = await bumpVersion(tx, quotationId, input.version);

    await tx.quotationLine.update({ where: { id: lineId }, data });

    await recordAudit(tx, {
      action:
        changes['discountPercent'] !== undefined
          ? AuditAction.DISCOUNT_CHANGED
          : AuditAction.QUOTATION_EDITED,
      entityType: AuditEntity.QUOTATION_LINE,
      entityId: lineId,
      actorUserId: auth.userId,
      actorRole: auth.role,
      entityVersion: version,
      oldValue: toJsonValue(
        Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, value.before])),
      ),
      newValue: toJsonValue(
        Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, value.after])),
      ),
    });

    await recalculateQuotation(tx, quotationId);
  });
}

export async function removeQuotationLine(
  auth: AuthContext,
  quotationId: string,
  lineId: string,
  version: number,
): Promise<void> {
  const quotation = await findQuotationForActor(auth, quotationId);
  assertOwnership(auth, quotation.salesRepId);
  assertVersion(quotation.version, version);
  assertEditable(quotation.status);

  const line = await prisma.quotationLine.findUnique({
    where: { id: lineId },
    select: {
      quotationId: true,
      productId: true,
      variantId: true,
      quantity: true,
      unitPrice: true,
      discountPercent: true,
      product: { select: { sku: true } },
    },
  });
  if (!line || line.quotationId !== quotationId) throw new NotFoundError('Quotation line not found');

  await prisma.$transaction(async (tx) => {
    const newVersion = await bumpVersion(tx, quotationId, version);

    await tx.quotationLine.delete({ where: { id: lineId } });

    // Remaining positions are left alone. They stay strictly increasing, which is
    // all the ordering needs; closing the gap would risk a unique-index collision
    // for no benefit.
    await recordAudit(tx, {
      action: AuditAction.QUOTATION_LINE_REMOVED,
      entityType: AuditEntity.QUOTATION_LINE,
      entityId: lineId,
      actorUserId: auth.userId,
      actorRole: auth.role,
      entityVersion: newVersion,
      oldValue: toJsonValue({
        quotationId,
        productId: line.productId,
        sku: line.product.sku,
        variantId: line.variantId,
        quantity: line.quantity,
        unitPrice: line.unitPrice.toFixed(MONEY_SCALE),
        discountPercent: line.discountPercent.toFixed(PERCENT_SCALE),
      }),
      newValue: null,
    });

    await recalculateQuotation(tx, quotationId);
  });
}

async function assertVariantUsable(productId: string, variantId: string): Promise<void> {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { productId: true, active: true },
  });
  if (!variant || variant.productId !== productId) {
    throw new NotFoundError('Variant not found for this product');
  }
  if (!variant.active) throw new ConflictError('That variant is deactivated');
}
