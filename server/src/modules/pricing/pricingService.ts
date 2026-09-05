import { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../db/prisma';
import { ConflictError, NotFoundError } from '../../http/errors';
import {
  MONEY_SCALE,
  PERCENT_SCALE,
  formatMoney,
  formatPercent,
  toDecimalString,
} from '../../http/fields';
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
import { resolveEffectiveCeiling, type EffectiveCeiling } from './discountRules';

type DecimalLike = Prisma.Decimal;

// ---------------------------------------------------------------------------
// Price lists
// ---------------------------------------------------------------------------

const priceListSelect = {
  id: true,
  code: true,
  name: true,
  customerTierId: true,
  currency: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  customerTier: { select: { id: true, code: true, name: true } },
  _count: { select: { items: true } },
} as const;

export interface PriceListView {
  id: string;
  code: string;
  name: string;
  customerTierId: string | null;
  customerTierName: string | null;
  currency: string;
  active: boolean;
  itemCount: number;
  createdAt: Date;
  updatedAt: Date;
}

type PriceListRow = {
  id: string;
  code: string;
  name: string;
  customerTierId: string | null;
  currency: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  customerTier: { id: string; code: string; name: string } | null;
  _count: { items: number };
};

function toPriceListView(row: PriceListRow): PriceListView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    customerTierId: row.customerTierId,
    customerTierName: row.customerTier?.name ?? null,
    currency: row.currency,
    active: row.active,
    itemCount: row._count.items,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface PriceListItemView {
  productId: string;
  sku: string;
  productName: string;
  price: string;
  /** The catalogue price this entry overrides, for comparison. */
  basePrice: string;
}

export interface PriceListDetailView extends PriceListView {
  items: PriceListItemView[];
}

export async function listPriceLists(query: ListQuery): Promise<Paginated<PriceListView>> {
  const where = { ...searchFilter(query, ['code', 'name']), ...activeFilter(query) };

  const [rows, total] = await prisma.$transaction([
    prisma.priceList.findMany({
      where,
      select: priceListSelect,
      orderBy: { name: 'asc' },
      ...pageArgs(query),
    }),
    prisma.priceList.count({ where }),
  ]);

  return paginated(rows.map(toPriceListView), total, query);
}

export async function getPriceList(id: string): Promise<PriceListDetailView> {
  const row = await prisma.priceList.findUnique({ where: { id }, select: priceListSelect });
  if (!row) throw new NotFoundError('Price list not found');

  const items = await prisma.priceListItem.findMany({
    where: { priceListId: id },
    select: {
      productId: true,
      price: true,
      product: { select: { sku: true, name: true, basePrice: true } },
    },
    orderBy: { product: { name: 'asc' } },
  });

  return {
    ...toPriceListView(row),
    items: items.map((item) => ({
      productId: item.productId,
      sku: item.product.sku,
      productName: item.product.name,
      price: formatMoney(item.price),
      basePrice: formatMoney(item.product.basePrice),
    })),
  };
}

export interface CreatePriceListInput {
  code: string;
  name: string;
  customerTierId?: string | null;
  currency?: string | undefined;
}

export async function createPriceList(
  actor: AuthContext,
  input: CreatePriceListInput,
): Promise<PriceListView> {
  if (await prisma.priceList.findUnique({ where: { code: input.code }, select: { id: true } })) {
    throw new ConflictError(`A price list with code ${input.code} already exists`);
  }
  if (input.customerTierId) await assertTierExists(input.customerTierId);

  return prisma.$transaction(async (tx) => {
    const created = await tx.priceList.create({
      data: {
        code: input.code,
        name: input.name,
        customerTierId: input.customerTierId ?? null,
        currency: input.currency ?? 'INR',
      },
      select: priceListSelect,
    });

    await recordConfigChange(tx, {
      actor,
      entityType: AuditEntity.PRICE_LIST,
      entityId: created.id,
      after: { code: created.code, name: created.name, currency: created.currency },
    });

    return toPriceListView(created);
  });
}

export interface UpdatePriceListInput {
  name?: string | undefined;
  customerTierId?: string | null | undefined;
  active?: boolean | undefined;
}

export async function updatePriceList(
  actor: AuthContext,
  id: string,
  input: UpdatePriceListInput,
): Promise<PriceListView> {
  const existing = await prisma.priceList.findUnique({ where: { id }, select: priceListSelect });
  if (!existing) throw new NotFoundError('Price list not found');
  if (input.customerTierId) await assertTierExists(input.customerTierId);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.priceList.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.customerTierId === undefined ? {} : { customerTierId: input.customerTierId }),
        ...(input.active === undefined ? {} : { active: input.active }),
      },
      select: priceListSelect,
    });

    const change = diffFields(toPriceListView(existing), toPriceListView(updated), [
      'updatedAt',
      'itemCount',
      'customerTierName',
    ]);
    if (change) {
      await recordConfigChange(tx, {
        actor,
        entityType: AuditEntity.PRICE_LIST,
        entityId: id,
        before: change.before,
        after: change.after,
      });
    }

    return toPriceListView(updated);
  });
}

/**
 * Set one product's price on a list.
 *
 * Upsert rather than separate create and update: a price entry has no identity of
 * its own beyond (list, product), so "what is this product's price on this list"
 * is the only question a caller ever has.
 */
export async function setPriceListItem(
  actor: AuthContext,
  priceListId: string,
  productId: string,
  price: number,
): Promise<PriceListItemView> {
  const list = await prisma.priceList.findUnique({
    where: { id: priceListId },
    select: { id: true },
  });
  if (!list) throw new NotFoundError('Price list not found');

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { sku: true, name: true, basePrice: true },
  });
  if (!product) throw new NotFoundError('Product not found');

  const previous = await prisma.priceListItem.findUnique({
    where: { priceListId_productId: { priceListId, productId } },
    select: { price: true },
  });

  const nextPrice = toDecimalString(price, MONEY_SCALE);

  return prisma.$transaction(async (tx) => {
    const item = await tx.priceListItem.upsert({
      where: { priceListId_productId: { priceListId, productId } },
      create: { priceListId, productId, price: nextPrice },
      update: { price: nextPrice },
      select: { price: true },
    });

    await recordConfigChange(tx, {
      actor,
      entityType: AuditEntity.PRICE_LIST_ITEM,
      entityId: `${priceListId}:${productId}`,
      before: previous ? { price: formatMoney(previous.price) } : undefined,
      after: { priceListId, productId, price: formatMoney(item.price) },
    });

    return {
      productId,
      sku: product.sku,
      productName: product.name,
      price: formatMoney(item.price),
      basePrice: formatMoney(product.basePrice),
    };
  });
}

/**
 * Remove a price entry.
 *
 * The only delete in master data. A price entry carries no history - removing it
 * simply makes pricing fall back to the product's base price - so there is
 * nothing to preserve by deactivating it instead.
 */
export async function removePriceListItem(
  actor: AuthContext,
  priceListId: string,
  productId: string,
): Promise<void> {
  const existing = await prisma.priceListItem.findUnique({
    where: { priceListId_productId: { priceListId, productId } },
    select: { price: true },
  });
  if (!existing) throw new NotFoundError('This product has no price on that list');

  await prisma.$transaction(async (tx) => {
    await tx.priceListItem.delete({
      where: { priceListId_productId: { priceListId, productId } },
    });

    await recordConfigChange(tx, {
      actor,
      entityType: AuditEntity.PRICE_LIST_ITEM,
      entityId: `${priceListId}:${productId}`,
      before: { priceListId, productId, price: formatMoney(existing.price) },
      after: null,
      reason: 'Price entry removed; pricing falls back to base price',
    });
  });
}

// ---------------------------------------------------------------------------
// Discount rules
// ---------------------------------------------------------------------------

const discountRuleSelect = {
  id: true,
  customerTierId: true,
  categoryId: true,
  maximumDiscount: true,
  priority: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  customerTier: { select: { code: true, name: true } },
  category: { select: { code: true, name: true } },
} as const;

export interface DiscountRuleView {
  id: string;
  customerTierId: string;
  customerTierName: string;
  categoryId: string | null;
  categoryName: string | null;
  /** Percent 0-100. */
  maximumDiscount: string;
  priority: number;
  active: boolean;
  /** True for the tier-wide fallback rule. */
  tierWide: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type DiscountRuleRow = {
  id: string;
  customerTierId: string;
  categoryId: string | null;
  maximumDiscount: DecimalLike;
  priority: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  customerTier: { code: string; name: string };
  category: { code: string; name: string } | null;
};

function toDiscountRuleView(row: DiscountRuleRow): DiscountRuleView {
  return {
    id: row.id,
    customerTierId: row.customerTierId,
    customerTierName: row.customerTier.name,
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? null,
    maximumDiscount: formatPercent(row.maximumDiscount),
    priority: row.priority,
    active: row.active,
    tierWide: row.categoryId === null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface ListDiscountRulesQuery extends ListQuery {
  customerTierId?: string | undefined;
  categoryId?: string | undefined;
}

export async function listDiscountRules(
  query: ListDiscountRulesQuery,
): Promise<Paginated<DiscountRuleView>> {
  const where = {
    ...activeFilter(query),
    ...(query.customerTierId ? { customerTierId: query.customerTierId } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.discountRule.findMany({
      where,
      select: discountRuleSelect,
      orderBy: [{ customerTierId: 'asc' }, { priority: 'desc' }],
      ...pageArgs(query),
    }),
    prisma.discountRule.count({ where }),
  ]);

  return paginated(rows.map(toDiscountRuleView), total, query);
}

export interface CreateDiscountRuleInput {
  customerTierId: string;
  categoryId?: string | null;
  maximumDiscount: number;
  priority?: number | undefined;
}

export async function createDiscountRule(
  actor: AuthContext,
  input: CreateDiscountRuleInput,
): Promise<DiscountRuleView> {
  await assertTierExists(input.customerTierId);
  const categoryId = input.categoryId ?? null;
  if (categoryId) await assertCategoryExists(categoryId);

  /*
   * Postgres treats NULLs as distinct in an ordinary unique index, so the
   * composite @@unique(customerTierId, categoryId) does not stop a second
   * tier-wide rule. A partial unique index in the init migration does, and this
   * lookup turns that constraint into a readable conflict.
   */
  const clash = await prisma.discountRule.findFirst({
    where: { customerTierId: input.customerTierId, categoryId },
    select: { id: true },
  });
  if (clash) {
    throw new ConflictError(
      categoryId
        ? 'A discount rule already exists for that tier and category'
        : 'That tier already has a tier-wide discount rule',
    );
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.discountRule.create({
      data: {
        customerTierId: input.customerTierId,
        categoryId,
        maximumDiscount: toDecimalString(input.maximumDiscount, PERCENT_SCALE),
        priority: input.priority ?? 0,
      },
      select: discountRuleSelect,
    });

    await recordConfigChange(tx, {
      actor,
      entityType: AuditEntity.DISCOUNT_RULE,
      entityId: created.id,
      after: {
        customerTierId: created.customerTierId,
        categoryId: created.categoryId,
        maximumDiscount: formatPercent(created.maximumDiscount),
        priority: created.priority,
      },
    });

    return toDiscountRuleView(created);
  });
}

export interface UpdateDiscountRuleInput {
  maximumDiscount?: number | undefined;
  priority?: number | undefined;
  active?: boolean | undefined;
}

export async function updateDiscountRule(
  actor: AuthContext,
  id: string,
  input: UpdateDiscountRuleInput,
): Promise<DiscountRuleView> {
  const existing = await prisma.discountRule.findUnique({
    where: { id },
    select: discountRuleSelect,
  });
  if (!existing) throw new NotFoundError('Discount rule not found');

  return prisma.$transaction(async (tx) => {
    const updated = await tx.discountRule.update({
      where: { id },
      data: {
        ...(input.maximumDiscount === undefined
          ? {}
          : { maximumDiscount: toDecimalString(input.maximumDiscount, PERCENT_SCALE) }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.active === undefined ? {} : { active: input.active }),
      },
      select: discountRuleSelect,
    });

    const change = diffFields(toDiscountRuleView(existing), toDiscountRuleView(updated), [
      'updatedAt',
      'customerTierName',
      'categoryName',
      'tierWide',
    ]);
    if (change) {
      await recordConfigChange(tx, {
        actor,
        entityType: AuditEntity.DISCOUNT_RULE,
        entityId: id,
        before: change.before,
        after: change.after,
      });
    }

    return toDiscountRuleView(updated);
  });
}

export interface EffectiveCeilingResult extends EffectiveCeiling {
  customerTierId: string;
  customerTierName: string;
  categoryId: string | null;
  categoryName: string | null;
}

/**
 * Preview which rule governs a (tier, category) pair.
 *
 * Exists so an administrator can answer "why is this the ceiling?" without
 * reading the rule table by eye, and so the resolution the risk engine will use
 * is inspectable before a quotation depends on it.
 */
export async function previewEffectiveCeiling(
  customerTierId: string,
  categoryId: string | null,
): Promise<EffectiveCeilingResult> {
  const tier = await prisma.customerTier.findUnique({
    where: { id: customerTierId },
    select: { id: true, name: true, defaultDiscountCeiling: true },
  });
  if (!tier) throw new NotFoundError('Customer tier not found');

  let categoryName: string | null = null;
  if (categoryId) {
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      select: { name: true },
    });
    if (!category) throw new NotFoundError('Category not found');
    categoryName = category.name;
  }

  const rules = await prisma.discountRule.findMany({
    where: { customerTierId, active: true },
    select: {
      id: true,
      customerTierId: true,
      categoryId: true,
      maximumDiscount: true,
      priority: true,
      active: true,
    },
  });

  const resolved = resolveEffectiveCeiling({
    rules,
    customerTierId,
    categoryId,
    tierDefaultCeiling: tier.defaultDiscountCeiling,
  });

  return {
    ...resolved,
    customerTierId: tier.id,
    customerTierName: tier.name,
    categoryId,
    categoryName,
  };
}

async function assertTierExists(tierId: string): Promise<void> {
  const tier = await prisma.customerTier.findUnique({
    where: { id: tierId },
    select: { id: true },
  });
  if (!tier) throw new NotFoundError('Customer tier not found');
}

async function assertCategoryExists(categoryId: string): Promise<void> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });
  if (!category) throw new NotFoundError('Category not found');
}
