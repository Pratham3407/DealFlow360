import { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../db/prisma';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../http/errors';
import { WEIGHT_SCALE, formatWeight, toDecimalString } from '../../http/fields';
import {
  activeFilter,
  pageArgs,
  paginated,
  searchFilter,
  type ListQuery,
  type Paginated,
} from '../../http/pagination';
import type { AuthContext } from '../../http/types';
import { AuditEntity } from '../audit/auditService';
import { diffFields, recordConfigChange } from '../audit/configAudit';

type DecimalLike = Prisma.Decimal;

// ---------------------------------------------------------------------------
// Product pairings
//
// The data behind upsell/cross-sell suggestions (docs/PRD.md 12). Ranking,
// margin-floor filtering and promotion boosting are the recommendation engine's
// job in a later slice; this module only owns the configuration.
// ---------------------------------------------------------------------------

const pairingSelect = {
  id: true,
  productId: true,
  recommendedProductId: true,
  weight: true,
  active: true,
  createdAt: true,
  product: { select: { sku: true, name: true } },
  recommendedProduct: { select: { sku: true, name: true, active: true } },
} as const;

export interface ProductPairingView {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  recommendedProductId: string;
  recommendedSku: string;
  recommendedName: string;
  /** Ranking weight; higher ranks sooner. */
  weight: string;
  active: boolean;
  createdAt: Date;
}

type PairingRow = {
  id: string;
  productId: string;
  recommendedProductId: string;
  weight: DecimalLike;
  active: boolean;
  createdAt: Date;
  product: { sku: string; name: string };
  recommendedProduct: { sku: string; name: string; active: boolean };
};

function toPairingView(row: PairingRow): ProductPairingView {
  return {
    id: row.id,
    productId: row.productId,
    productSku: row.product.sku,
    productName: row.product.name,
    recommendedProductId: row.recommendedProductId,
    recommendedSku: row.recommendedProduct.sku,
    recommendedName: row.recommendedProduct.name,
    weight: formatWeight(row.weight),
    active: row.active,
    createdAt: row.createdAt,
  };
}

export interface ListPairingsQuery extends ListQuery {
  productId?: string | undefined;
}

export async function listProductPairings(
  query: ListPairingsQuery,
): Promise<Paginated<ProductPairingView>> {
  const where = {
    ...activeFilter(query),
    ...(query.productId ? { productId: query.productId } : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.productPairing.findMany({
      where,
      select: pairingSelect,
      orderBy: [{ productId: 'asc' }, { weight: 'desc' }],
      ...pageArgs(query),
    }),
    prisma.productPairing.count({ where }),
  ]);

  return paginated(rows.map(toPairingView), total, query);
}

export interface CreatePairingInput {
  productId: string;
  recommendedProductId: string;
  weight?: number | undefined;
}

export async function createProductPairing(
  actor: AuthContext,
  input: CreatePairingInput,
): Promise<ProductPairingView> {
  if (input.productId === input.recommendedProductId) {
    throw new BusinessRuleError('A product cannot recommend itself', [
      { path: 'recommendedProductId', message: 'must differ from productId' },
    ]);
  }

  await assertProductExists(input.productId, 'productId');
  await assertProductExists(input.recommendedProductId, 'recommendedProductId');

  const clash = await prisma.productPairing.findUnique({
    where: {
      productId_recommendedProductId: {
        productId: input.productId,
        recommendedProductId: input.recommendedProductId,
      },
    },
    select: { id: true },
  });
  if (clash) throw new ConflictError('That pairing already exists');

  return prisma.$transaction(async (tx) => {
    const created = await tx.productPairing.create({
      data: {
        productId: input.productId,
        recommendedProductId: input.recommendedProductId,
        weight: toDecimalString(input.weight ?? 1, WEIGHT_SCALE),
      },
      select: pairingSelect,
    });

    await recordConfigChange(tx, {
      actor,
      entityType: AuditEntity.PRODUCT_PAIRING,
      entityId: created.id,
      after: {
        productId: created.productId,
        recommendedProductId: created.recommendedProductId,
        weight: formatWeight(created.weight),
      },
    });

    return toPairingView(created);
  });
}

export interface UpdatePairingInput {
  weight?: number | undefined;
  active?: boolean | undefined;
}

export async function updateProductPairing(
  actor: AuthContext,
  id: string,
  input: UpdatePairingInput,
): Promise<ProductPairingView> {
  const existing = await prisma.productPairing.findUnique({ where: { id }, select: pairingSelect });
  if (!existing) throw new NotFoundError('Pairing not found');

  return prisma.$transaction(async (tx) => {
    const updated = await tx.productPairing.update({
      where: { id },
      data: {
        ...(input.weight === undefined
          ? {}
          : { weight: toDecimalString(input.weight, WEIGHT_SCALE) }),
        ...(input.active === undefined ? {} : { active: input.active }),
      },
      select: pairingSelect,
    });

    const change = diffFields(toPairingView(existing), toPairingView(updated), [
      'productSku',
      'productName',
      'recommendedSku',
      'recommendedName',
    ]);
    if (change) {
      await recordConfigChange(tx, {
        actor,
        entityType: AuditEntity.PRODUCT_PAIRING,
        entityId: id,
        before: change.before,
        after: change.after,
      });
    }

    return toPairingView(updated);
  });
}

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------

const promotionSelect = {
  id: true,
  code: true,
  name: true,
  productId: true,
  active: true,
  priority: true,
  startsAt: true,
  endsAt: true,
  createdAt: true,
  product: { select: { sku: true, name: true } },
} as const;

export interface PromotionView {
  id: string;
  code: string;
  name: string;
  productId: string;
  productSku: string;
  productName: string;
  active: boolean;
  priority: number;
  startsAt: Date | null;
  endsAt: Date | null;
  /** True when active and inside its window right now. */
  live: boolean;
  createdAt: Date;
}

type PromotionRow = {
  id: string;
  code: string;
  name: string;
  productId: string;
  active: boolean;
  priority: number;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  product: { sku: string; name: string };
};

function toPromotionView(row: PromotionRow, now = new Date()): PromotionView {
  const started = row.startsAt === null || row.startsAt.getTime() <= now.getTime();
  const notEnded = row.endsAt === null || row.endsAt.getTime() > now.getTime();

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    productId: row.productId,
    productSku: row.product.sku,
    productName: row.product.name,
    active: row.active,
    priority: row.priority,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    live: row.active && started && notEnded,
    createdAt: row.createdAt,
  };
}

export interface ListPromotionsQuery extends ListQuery {
  productId?: string | undefined;
  /** Restrict to promotions in force right now. */
  live?: boolean | undefined;
}

export async function listPromotions(
  query: ListPromotionsQuery,
): Promise<Paginated<PromotionView>> {
  const now = new Date();
  const where = {
    ...activeFilter(query),
    ...searchFilter(query, ['code', 'name']),
    ...(query.productId ? { productId: query.productId } : {}),
    ...(query.live
      ? {
          active: true,
          AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
            { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          ],
        }
      : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.promotion.findMany({
      where,
      select: promotionSelect,
      orderBy: [{ priority: 'desc' }, { code: 'asc' }],
      ...pageArgs(query),
    }),
    prisma.promotion.count({ where }),
  ]);

  return paginated(
    rows.map((row) => toPromotionView(row, now)),
    total,
    query,
  );
}

export interface CreatePromotionInput {
  code: string;
  name: string;
  productId: string;
  priority?: number | undefined;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

export async function createPromotion(
  actor: AuthContext,
  input: CreatePromotionInput,
): Promise<PromotionView> {
  if (await prisma.promotion.findUnique({ where: { code: input.code }, select: { id: true } })) {
    throw new ConflictError(`A promotion with code ${input.code} already exists`);
  }
  await assertProductExists(input.productId, 'productId');
  assertWindowOrdered(input.startsAt ?? null, input.endsAt ?? null);

  return prisma.$transaction(async (tx) => {
    const created = await tx.promotion.create({
      data: {
        code: input.code,
        name: input.name,
        productId: input.productId,
        priority: input.priority ?? 0,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
      },
      select: promotionSelect,
    });

    await recordConfigChange(tx, {
      actor,
      entityType: AuditEntity.PROMOTION,
      entityId: created.id,
      after: {
        code: created.code,
        name: created.name,
        productId: created.productId,
        priority: created.priority,
        startsAt: created.startsAt,
        endsAt: created.endsAt,
      },
    });

    return toPromotionView(created);
  });
}

export interface UpdatePromotionInput {
  name?: string | undefined;
  priority?: number | undefined;
  startsAt?: Date | null | undefined;
  endsAt?: Date | null | undefined;
  active?: boolean | undefined;
}

export async function updatePromotion(
  actor: AuthContext,
  id: string,
  input: UpdatePromotionInput,
): Promise<PromotionView> {
  const existing = await prisma.promotion.findUnique({ where: { id }, select: promotionSelect });
  if (!existing) throw new NotFoundError('Promotion not found');

  // Validate the resulting window, not the supplied field alone: moving one bound
  // past the other is only visible when both are considered together.
  assertWindowOrdered(
    input.startsAt === undefined ? existing.startsAt : input.startsAt,
    input.endsAt === undefined ? existing.endsAt : input.endsAt,
  );

  return prisma.$transaction(async (tx) => {
    const updated = await tx.promotion.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.startsAt === undefined ? {} : { startsAt: input.startsAt }),
        ...(input.endsAt === undefined ? {} : { endsAt: input.endsAt }),
        ...(input.active === undefined ? {} : { active: input.active }),
      },
      select: promotionSelect,
    });

    const change = diffFields(toPromotionView(existing), toPromotionView(updated), [
      'productSku',
      'productName',
      'live',
    ]);
    if (change) {
      await recordConfigChange(tx, {
        actor,
        entityType: AuditEntity.PROMOTION,
        entityId: id,
        before: change.before,
        after: change.after,
      });
    }

    return toPromotionView(updated);
  });
}

function assertWindowOrdered(startsAt: Date | null, endsAt: Date | null): void {
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new BusinessRuleError('A promotion must end after it starts', [
      { path: 'endsAt', message: 'must be later than startsAt' },
    ]);
  }
}

async function assertProductExists(productId: string, path: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) {
    throw new NotFoundError(path === 'productId' ? 'Product not found' : 'Recommended product not found');
  }
}
