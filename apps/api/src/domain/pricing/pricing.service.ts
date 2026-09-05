/**
 * Price and ceiling resolvers.
 *
 * Everything here is a database read resolved server-side: neither price, cost
 * nor the applicable discount ceiling is ever accepted from the client
 * (AGENT_INSTRUCTIONS.md §2). The quotation service is the only consumer and the
 * returned values are snapshotted onto quotation lines at creation time.
 */

import { asc, eq } from 'drizzle-orm';
import { discountRules } from '@/db/schema/index.js';
import type { DbExecutor } from '@/db/client.js';
import type { BasisPoints, Paise } from '@dealflow/shared';
import { BP_FULL } from '@dealflow/shared';

export interface ProductPricing {
  /** List price (never discounted) as shown on the quotation. */
  listUnitPricePaise: Paise;
  /** Effective pre-discount unit price (list + variant extra). */
  unitPricePaise: Paise;
  /** Unit cost used for margin. */
  unitCostPaise: Paise;
  taxBp: BasisPoints;
}

/**
 * Resolve the effective price and cost for a product against a customer tier.
 *
 * Price list lookup order (PRD FR-2): the tier's price list, else the default
 * list, else the product's own base price. A variant, when given, adds its extra
 * price on top. The base price is always retained as the strike-through "list"
 * price even when a price list overrides the amount.
 */
export async function resolveProductPricing(
  exec: DbExecutor,
  productId: string,
  tierId: string,
  variantId?: string | null,
): Promise<ProductPricing> {
  const product = await exec.query.products.findFirst({
    where: (table, { eq }) => eq(table.id, productId),
    with: { category: true },
  });
  if (!product || !product.active) throw new Error(`Product ${productId} is not available`);
  if (!product.category || !product.category.active) {
    throw new Error(`Product ${productId} belongs to an inactive category`);
  }

  const tierList = await exec.query.priceLists.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.customerTierId, tierId), eq(table.active, true)),
  });
  const defaultList = tierList ? null : (
      await exec.query.priceLists.findFirst({
        where: (table, { and, eq, isNull }) =>
          and(eq(table.isDefault, true), eq(table.active, true), isNull(table.customerTierId)),
      })
    );

  const list = tierList ?? defaultList;
  let listPrice = product.basePricePaise;
  if (list) {
    const item = await exec.query.priceListItems.findFirst({
      where: (table, { and, eq }) => and(eq(table.priceListId, list.id), eq(table.productId, product.id)),
    });
    if (item) listPrice = item.pricePaise;
  }

  let variantExtra = 0;
  if (variantId) {
    const variant = await exec.query.productVariants.findFirst({
      where: (table, { and, eq }) => and(eq(table.id, variantId), eq(table.productId, product.id)),
    });
    if (variant) variantExtra = variant.extraPricePaise;
  }

  const unitPrice = listPrice + variantExtra;

  const unitCost =
    product.unitCostPaise ??
    Math.round((product.basePricePaise * (BP_FULL - product.category.defaultMarginBp)) / BP_FULL);

  return {
    listUnitPricePaise: listPrice,
    unitPricePaise: unitPrice,
    unitCostPaise: unitCost,
    taxBp: product.taxBp,
  };
}

/**
 * Resolve the effective discount ceiling for a line, per BUSINESS_RULES.md §1.
 *
 * Most-specific rule wins: tier+category → category → tier → global, with
 * `priority` breaking ties within a specificity level. If no rule exists at all
 * the tier's `defaultDiscountCeilingBp` is the fallback — which is exactly the
 * "Bronze 5% / Silver 10% / Gold 15%" configuration from SEED_DATA.md.
 */
export async function resolveEffectiveCeiling(
  exec: DbExecutor,
  params: { tierId: string; categoryId: string },
): Promise<{ ceilingBp: BasisPoints; ruleId: string | null; source: string }> {
  const { tierId, categoryId } = params;

  const rows = await exec
    .select()
    .from(discountRules)
    .where(eq(discountRules.active, true))
    .orderBy(asc(discountRules.priority), asc(discountRules.id));

  const rank = (rule: typeof rows[number]): number =>
    rule.customerTierId === tierId && rule.categoryId === categoryId
      ? 3
      : rule.categoryId === categoryId
        ? 2
        : rule.customerTierId === tierId
          ? 1
          : rule.customerTierId === null && rule.categoryId === null
            ? 0
            : -1;

  const applicable = rows
    .filter((rule) => rank(rule) >= 0)
    .sort((a, b) => rank(b) - rank(a) || b.priority - a.priority || b.maxDiscountBp - a.maxDiscountBp);

  const best = applicable[0];
  if (best) {
    return { ceilingBp: best.maxDiscountBp, ruleId: best.id, source: 'discount_rule' };
  }

  const tier = await exec.query.customerTiers.findFirst({ where: (table, { eq }) => eq(table.id, tierId) });
  if (tier) return { ceilingBp: tier.defaultDiscountCeilingBp, ruleId: null, source: 'tier_default' };

  return { ceilingBp: 0, ruleId: null, source: 'no_rule' };
}

/** Strictest ceiling among a set of line ceilings — the order-level ceiling. */
export function strictestCeilingBp(ceilings: readonly BasisPoints[]): BasisPoints {
  return ceilings.length ? Math.min(...ceilings) : 0;
}

/** Load a product with its category in one call. */
export async function getProductWithCategory(exec: DbExecutor, productId: string) {
  return exec.query.products.findFirst({
    where: (table, { eq }) => eq(table.id, productId),
    with: { category: true },
  });
}