import { Prisma } from '../../generated/prisma/client';
import { ProductType } from '../../generated/prisma/enums';
import { prisma } from '../../db/prisma';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../http/errors';
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

type DecimalLike = Prisma.Decimal;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const categorySelect = {
  id: true,
  code: true,
  name: true,
  defaultMarginPercent: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: true, discountRules: true } },
} as const;

export interface CategoryView {
  id: string;
  code: string;
  name: string;
  defaultMarginPercent: string | null;
  active: boolean;
  productCount: number;
  discountRuleCount: number;
  createdAt: Date;
  updatedAt: Date;
}

type CategoryRow = {
  id: string;
  code: string;
  name: string;
  defaultMarginPercent: DecimalLike | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { products: number; discountRules: number };
};

function toCategoryView(row: CategoryRow): CategoryView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    defaultMarginPercent:
      row.defaultMarginPercent === null ? null : formatPercent(row.defaultMarginPercent),
    active: row.active,
    productCount: row._count.products,
    discountRuleCount: row._count.discountRules,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const CATEGORY_DERIVED = ['updatedAt', 'productCount', 'discountRuleCount'] as const;

export async function listCategories(query: ListQuery): Promise<Paginated<CategoryView>> {
  const where = { ...searchFilter(query, ['code', 'name']), ...activeFilter(query) };

  const [rows, total] = await prisma.$transaction([
    prisma.category.findMany({
      where,
      select: categorySelect,
      orderBy: { name: 'asc' },
      ...pageArgs(query),
    }),
    prisma.category.count({ where }),
  ]);

  return paginated(rows.map(toCategoryView), total, query);
}

export interface CreateCategoryInput {
  code: string;
  name: string;
  defaultMarginPercent?: number | null;
}

export async function createCategory(
  actor: AuthContext,
  input: CreateCategoryInput,
): Promise<CategoryView> {
  if (await prisma.category.findUnique({ where: { code: input.code }, select: { id: true } })) {
    throw new ConflictError(`A category with code ${input.code} already exists`);
  }
  if (await prisma.category.findUnique({ where: { name: input.name }, select: { id: true } })) {
    throw new ConflictError(`A category named ${input.name} already exists`);
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.category.create({
      data: {
        code: input.code,
        name: input.name,
        defaultMarginPercent:
          input.defaultMarginPercent === undefined || input.defaultMarginPercent === null
            ? null
            : toDecimalString(input.defaultMarginPercent, PERCENT_SCALE),
      },
      select: categorySelect,
    });

    await recordConfigChange(tx, {
      actor,
      entityType: AuditEntity.CATEGORY,
      entityId: created.id,
      after: { code: created.code, name: created.name },
    });

    return toCategoryView(created);
  });
}

export interface UpdateCategoryInput {
  name?: string | undefined;
  defaultMarginPercent?: number | null | undefined;
  active?: boolean | undefined;
}

export async function updateCategory(
  actor: AuthContext,
  id: string,
  input: UpdateCategoryInput,
): Promise<CategoryView> {
  const existing = await prisma.category.findUnique({ where: { id }, select: categorySelect });
  if (!existing) throw new NotFoundError('Category not found');

  if (input.name !== undefined && input.name !== existing.name) {
    if (await prisma.category.findUnique({ where: { name: input.name }, select: { id: true } })) {
      throw new ConflictError(`A category named ${input.name} already exists`);
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.category.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.defaultMarginPercent === undefined
          ? {}
          : {
              defaultMarginPercent:
                input.defaultMarginPercent === null
                  ? null
                  : toDecimalString(input.defaultMarginPercent, PERCENT_SCALE),
            }),
        ...(input.active === undefined ? {} : { active: input.active }),
      },
      select: categorySelect,
    });

    const change = diffFields(toCategoryView(existing), toCategoryView(updated), [
      ...CATEGORY_DERIVED,
    ]);
    if (change) {
      await recordConfigChange(tx, {
        actor,
        entityType: AuditEntity.CATEGORY,
        entityId: id,
        before: change.before,
        after: change.after,
      });
    }

    return toCategoryView(updated);
  });
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const productSelect = {
  id: true,
  sku: true,
  name: true,
  categoryId: true,
  productType: true,
  unit: true,
  basePrice: true,
  costPrice: true,
  taxPercent: true,
  description: true,
  active: true,
  subscriptionPlanId: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, code: true, name: true } },
  subscriptionPlan: { select: { id: true, code: true, name: true, interval: true } },
  _count: { select: { variants: true } },
} as const;

export interface ProductView {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  productType: ProductType;
  unit: string;
  basePrice: string;
  costPrice: string;
  taxPercent: string;
  /** basePrice - costPrice, computed server-side (docs/BUSINESS_RULES.md 6). */
  unitMargin: string;
  /** Gross margin as a percentage of basePrice. Null when basePrice is zero. */
  marginPercent: string | null;
  description: string | null;
  active: boolean;
  subscriptionPlanId: string | null;
  subscriptionPlanName: string | null;
  variantCount: number;
  createdAt: Date;
  updatedAt: Date;
}

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  productType: ProductType;
  unit: string;
  basePrice: Prisma.Decimal;
  costPrice: Prisma.Decimal;
  taxPercent: DecimalLike;
  description: string | null;
  active: boolean;
  subscriptionPlanId: string | null;
  createdAt: Date;
  updatedAt: Date;
  category: { id: string; code: string; name: string };
  subscriptionPlan: { id: string; code: string; name: string; interval: string } | null;
  _count: { variants: number };
};

function toProductView(row: ProductRow): ProductView {
  const basePrice = new Prisma.Decimal(row.basePrice);
  const costPrice = new Prisma.Decimal(row.costPrice);
  const unitMargin = basePrice.minus(costPrice);

  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    categoryId: row.categoryId,
    categoryCode: row.category.code,
    categoryName: row.category.name,
    productType: row.productType,
    unit: row.unit,
    basePrice: formatMoney(basePrice),
    costPrice: formatMoney(costPrice),
    taxPercent: formatPercent(row.taxPercent),
    unitMargin: formatMoney(unitMargin),
    // Decimal division, never float: a margin figure feeds approval decisions.
    marginPercent: basePrice.isZero()
      ? null
      : formatPercent(unitMargin.dividedBy(basePrice).times(100)),
    description: row.description,
    active: row.active,
    subscriptionPlanId: row.subscriptionPlanId,
    subscriptionPlanName: row.subscriptionPlan?.name ?? null,
    variantCount: row._count.variants,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const PRODUCT_DERIVED = [
  'updatedAt',
  'variantCount',
  'unitMargin',
  'marginPercent',
  'categoryCode',
  'categoryName',
  'subscriptionPlanName',
] as const;

export interface ListProductsQuery extends ListQuery {
  categoryId?: string | undefined;
  productType?: ProductType | undefined;
}

export async function listProducts(query: ListProductsQuery): Promise<Paginated<ProductView>> {
  const where = {
    ...searchFilter(query, ['sku', 'name', 'description']),
    ...activeFilter(query),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.productType ? { productType: query.productType } : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      select: productSelect,
      orderBy: [{ name: 'asc' }],
      ...pageArgs(query),
    }),
    prisma.product.count({ where }),
  ]);

  return paginated(rows.map(toProductView), total, query);
}

export async function getProduct(id: string): Promise<ProductView> {
  const row = await prisma.product.findUnique({ where: { id }, select: productSelect });
  if (!row) throw new NotFoundError('Product not found');
  return toProductView(row);
}

export interface CreateProductInput {
  sku: string;
  name: string;
  categoryId: string;
  productType: ProductType;
  unit?: string | undefined;
  basePrice: number;
  costPrice: number;
  taxPercent?: number | undefined;
  description?: string | null;
  subscriptionPlanId?: string | null;
}

export async function createProduct(
  actor: AuthContext,
  input: CreateProductInput,
): Promise<ProductView> {
  if (await prisma.product.findUnique({ where: { sku: input.sku }, select: { id: true } })) {
    throw new ConflictError(`A product with SKU ${input.sku} already exists`);
  }

  await assertCategoryUsable(input.categoryId);
  const planId = await resolvePlanForType(input.productType, input.subscriptionPlanId ?? null);

  return prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        sku: input.sku,
        name: input.name,
        categoryId: input.categoryId,
        productType: input.productType,
        unit: input.unit ?? 'unit',
        basePrice: toDecimalString(input.basePrice, MONEY_SCALE),
        costPrice: toDecimalString(input.costPrice, MONEY_SCALE),
        taxPercent: toDecimalString(input.taxPercent ?? 0, PERCENT_SCALE),
        description: input.description ?? null,
        subscriptionPlanId: planId,
      },
      select: productSelect,
    });

    await recordConfigChange(tx, {
      actor,
      entityType: AuditEntity.PRODUCT,
      entityId: created.id,
      after: {
        sku: created.sku,
        name: created.name,
        productType: created.productType,
        basePrice: formatMoney(created.basePrice),
        costPrice: formatMoney(created.costPrice),
      },
    });

    return toProductView(created);
  });
}

export interface UpdateProductInput {
  name?: string | undefined;
  categoryId?: string | undefined;
  productType?: ProductType | undefined;
  unit?: string | undefined;
  basePrice?: number | undefined;
  costPrice?: number | undefined;
  taxPercent?: number | undefined;
  description?: string | null | undefined;
  subscriptionPlanId?: string | null | undefined;
  active?: boolean | undefined;
}

export async function updateProduct(
  actor: AuthContext,
  id: string,
  input: UpdateProductInput,
): Promise<ProductView> {
  const existing = await prisma.product.findUnique({ where: { id }, select: productSelect });
  if (!existing) throw new NotFoundError('Product not found');

  if (input.categoryId !== undefined && input.categoryId !== existing.categoryId) {
    await assertCategoryUsable(input.categoryId);
  }

  // Type and plan are interdependent, so resolve them together against the
  // resulting state rather than each field in isolation.
  const nextType = input.productType ?? existing.productType;
  const nextPlanRequested =
    input.subscriptionPlanId === undefined ? existing.subscriptionPlanId : input.subscriptionPlanId;
  const planId = await resolvePlanForType(nextType, nextPlanRequested);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
        ...(input.productType === undefined ? {} : { productType: input.productType }),
        ...(input.unit === undefined ? {} : { unit: input.unit }),
        ...(input.basePrice === undefined
          ? {}
          : { basePrice: toDecimalString(input.basePrice, MONEY_SCALE) }),
        ...(input.costPrice === undefined
          ? {}
          : { costPrice: toDecimalString(input.costPrice, MONEY_SCALE) }),
        ...(input.taxPercent === undefined
          ? {}
          : { taxPercent: toDecimalString(input.taxPercent, PERCENT_SCALE) }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.active === undefined ? {} : { active: input.active }),
        subscriptionPlanId: planId,
      },
      select: productSelect,
    });

    const change = diffFields(toProductView(existing), toProductView(updated), [...PRODUCT_DERIVED]);
    if (change) {
      await recordConfigChange(tx, {
        actor,
        entityType: AuditEntity.PRODUCT,
        entityId: id,
        before: change.before,
        after: change.after,
      });
    }

    return toProductView(updated);
  });
}

async function assertCategoryUsable(categoryId: string): Promise<void> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { active: true },
  });
  if (!category) throw new NotFoundError('Category not found');
  if (!category.active) throw new ConflictError('That category is deactivated');
}

/**
 * Reconcile product type with subscription plan.
 *
 * A RECURRING product bills on a cadence, and the cadence comes from the plan, so
 * it must have one; a ONE_TIME product must not, or billing would see a schedule
 * where none belongs (docs/WORKFLOWS.md 8). The database enforces the first half
 * via products_recurring_requires_plan_check; this produces a readable business
 * error instead of a constraint violation, and rejects the second half too.
 */
async function resolvePlanForType(
  productType: ProductType,
  subscriptionPlanId: string | null,
): Promise<string | null> {
  if (productType === ProductType.RECURRING) {
    if (!subscriptionPlanId) {
      throw new BusinessRuleError('A recurring product must reference a subscription plan', [
        { path: 'subscriptionPlanId', message: 'required when productType is RECURRING' },
      ]);
    }
    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id: subscriptionPlanId },
      select: { active: true },
    });
    if (!plan) throw new NotFoundError('Subscription plan not found');
    if (!plan.active) throw new ConflictError('That subscription plan is deactivated');
    return subscriptionPlanId;
  }

  if (subscriptionPlanId) {
    throw new BusinessRuleError('Only a recurring product may reference a subscription plan', [
      { path: 'subscriptionPlanId', message: 'must be null unless productType is RECURRING' },
    ]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Product variants
// ---------------------------------------------------------------------------

const variantSelect = {
  id: true,
  productId: true,
  attribute: true,
  value: true,
  extraPrice: true,
  active: true,
  createdAt: true,
} as const;

export interface ProductVariantView {
  id: string;
  productId: string;
  attribute: string;
  value: string;
  extraPrice: string;
  active: boolean;
  createdAt: Date;
}

type VariantRow = {
  id: string;
  productId: string;
  attribute: string;
  value: string;
  extraPrice: DecimalLike;
  active: boolean;
  createdAt: Date;
};

function toVariantView(row: VariantRow): ProductVariantView {
  return {
    id: row.id,
    productId: row.productId,
    attribute: row.attribute,
    value: row.value,
    extraPrice: formatMoney(row.extraPrice),
    active: row.active,
    createdAt: row.createdAt,
  };
}

export async function listProductVariants(
  productId: string,
  query: ListQuery,
): Promise<Paginated<ProductVariantView>> {
  await assertProductExists(productId);
  const where = { productId, ...activeFilter(query) };

  const [rows, total] = await prisma.$transaction([
    prisma.productVariant.findMany({
      where,
      select: variantSelect,
      orderBy: [{ attribute: 'asc' }, { value: 'asc' }],
      ...pageArgs(query),
    }),
    prisma.productVariant.count({ where }),
  ]);

  return paginated(rows.map(toVariantView), total, query);
}

export interface CreateVariantInput {
  attribute: string;
  value: string;
  extraPrice?: number | undefined;
}

export async function createProductVariant(
  actor: AuthContext,
  productId: string,
  input: CreateVariantInput,
): Promise<ProductVariantView> {
  await assertProductExists(productId);

  const clash = await prisma.productVariant.findUnique({
    where: {
      productId_attribute_value: { productId, attribute: input.attribute, value: input.value },
    },
    select: { id: true },
  });
  if (clash) {
    throw new ConflictError(`This product already has ${input.attribute} = ${input.value}`);
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.productVariant.create({
      data: {
        productId,
        attribute: input.attribute,
        value: input.value,
        extraPrice: toDecimalString(input.extraPrice ?? 0, MONEY_SCALE),
      },
      select: variantSelect,
    });

    await recordConfigChange(tx, {
      actor,
      entityType: AuditEntity.PRODUCT_VARIANT,
      entityId: created.id,
      after: {
        productId,
        attribute: created.attribute,
        value: created.value,
        extraPrice: formatMoney(created.extraPrice),
      },
    });

    return toVariantView(created);
  });
}

export interface UpdateVariantInput {
  extraPrice?: number | undefined;
  active?: boolean | undefined;
}

export async function updateProductVariant(
  actor: AuthContext,
  productId: string,
  variantId: string,
  input: UpdateVariantInput,
): Promise<ProductVariantView> {
  const existing = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: variantSelect,
  });
  // Checking ownership as well as existence stops a variant being reached through
  // the wrong product's URL.
  if (!existing || existing.productId !== productId) throw new NotFoundError('Variant not found');

  return prisma.$transaction(async (tx) => {
    const updated = await tx.productVariant.update({
      where: { id: variantId },
      data: {
        ...(input.extraPrice === undefined
          ? {}
          : { extraPrice: toDecimalString(input.extraPrice, MONEY_SCALE) }),
        ...(input.active === undefined ? {} : { active: input.active }),
      },
      select: variantSelect,
    });

    const change = diffFields(toVariantView(existing), toVariantView(updated), []);
    if (change) {
      await recordConfigChange(tx, {
        actor,
        entityType: AuditEntity.PRODUCT_VARIANT,
        entityId: variantId,
        before: change.before,
        after: change.after,
      });
    }

    return toVariantView(updated);
  });
}

async function assertProductExists(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) throw new NotFoundError('Product not found');
}
