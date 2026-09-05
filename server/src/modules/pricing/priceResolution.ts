import { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../db/prisma';
import { NotFoundError } from '../../http/errors';
import { MONEY_SCALE } from '../../http/fields';

/**
 * Unit price resolution — docs/BUSINESS_RULES.md, and the fallback order stated in
 * docs/API_SPEC.md "Pricing".
 *
 * Lives in the pricing module, not the quotation module, because pricing owns
 * price lists. The quotation engine calls it; nothing else resolves a price.
 *
 * Order:
 *   1. an active price list bound to the customer's tier, holding this product
 *   2. the product's base_price
 *   + the selected variant's extra_price, when a variant is chosen
 *
 * A price list that exists but has no entry for the product falls through to
 * base price rather than failing: a list is a set of overrides, not a catalogue.
 */

export type PriceSource = 'PRICE_LIST' | 'BASE_PRICE';

export interface ResolvedPrice {
  /** Effective unit price including any variant uplift, 2 dp. */
  unitPrice: Prisma.Decimal;
  /** Authoritative unit cost, from the product. Never client-supplied. */
  unitCost: Prisma.Decimal;
  /** Tax rate to apply to this line, from the product. */
  taxPercent: Prisma.Decimal;
  /** Which rule decided the base figure, before any variant uplift. */
  source: PriceSource;
  /** The list that supplied the price, when source is PRICE_LIST. */
  priceListId: string | null;
  /** Variant uplift included in unitPrice, 2 dp. Zero when no variant. */
  variantExtraPrice: Prisma.Decimal;
  /** Category, carried through so the risk engine can resolve a ceiling. */
  categoryId: string;
  productType: 'ONE_TIME' | 'RECURRING';
  subscriptionPlanId: string | null;
}

/**
 * Pure core, so the fallback order can be unit tested without a database.
 *
 * `priceListPrice` is the matching price-list entry, or null when no active
 * tier-bound list holds this product.
 */
export function resolveUnitPriceFrom(input: {
  basePrice: Prisma.Decimal | string;
  priceListPrice: Prisma.Decimal | string | null;
  priceListId: string | null;
  variantExtraPrice: Prisma.Decimal | string | null;
}): { unitPrice: Prisma.Decimal; source: PriceSource; priceListId: string | null; variantExtraPrice: Prisma.Decimal } {
  const uplift = new Prisma.Decimal(input.variantExtraPrice ?? 0);
  const usePriceList = input.priceListPrice !== null && input.priceListPrice !== undefined;

  const base = usePriceList
    ? new Prisma.Decimal(input.priceListPrice as Prisma.Decimal | string)
    : new Prisma.Decimal(input.basePrice);

  return {
    // Round once, here, so the stored snapshot is exactly what arithmetic uses.
    unitPrice: base.plus(uplift).toDecimalPlaces(MONEY_SCALE),
    source: usePriceList ? 'PRICE_LIST' : 'BASE_PRICE',
    priceListId: usePriceList ? input.priceListId : null,
    variantExtraPrice: uplift.toDecimalPlaces(MONEY_SCALE),
  };
}

/**
 * Resolve the price for one product/variant as sold to one customer.
 *
 * Reads the customer's tier, then the active price list bound to that tier. Where
 * a tier has more than one active list the lowest `code` wins, so the choice is
 * deterministic rather than dependent on row order.
 */
export async function resolveUnitPrice(input: {
  customerId: string;
  productId: string;
  variantId?: string | null;
}): Promise<ResolvedPrice> {
  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: { tierId: true },
  });
  if (!customer) throw new NotFoundError('Customer not found');

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: {
      basePrice: true,
      costPrice: true,
      taxPercent: true,
      categoryId: true,
      productType: true,
      subscriptionPlanId: true,
    },
  });
  if (!product) throw new NotFoundError('Product not found');

  let variantExtraPrice: Prisma.Decimal | null = null;
  if (input.variantId) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: input.variantId },
      select: { productId: true, extraPrice: true },
    });
    // Ownership as well as existence: a variant must not be reachable through
    // another product.
    if (!variant || variant.productId !== input.productId) {
      throw new NotFoundError('Variant not found for this product');
    }
    variantExtraPrice = variant.extraPrice;
  }

  const priceListItem = await prisma.priceListItem.findFirst({
    where: {
      productId: input.productId,
      priceList: { active: true, customerTierId: customer.tierId },
    },
    select: { price: true, priceListId: true },
    orderBy: { priceList: { code: 'asc' } },
  });

  const resolved = resolveUnitPriceFrom({
    basePrice: product.basePrice,
    priceListPrice: priceListItem?.price ?? null,
    priceListId: priceListItem?.priceListId ?? null,
    variantExtraPrice,
  });

  return {
    ...resolved,
    unitCost: new Prisma.Decimal(product.costPrice).toDecimalPlaces(MONEY_SCALE),
    taxPercent: new Prisma.Decimal(product.taxPercent),
    categoryId: product.categoryId,
    productType: product.productType,
    subscriptionPlanId: product.subscriptionPlanId,
  };
}
