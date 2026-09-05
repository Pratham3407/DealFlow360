/**
 * Upsell / cross-sell recommendation engine (PRD §12).
 *
 * Candidates come from `product_pairings` seeded against products already on the
 * quote. The ranking combines pairing weight with active promotions (priority)
 * and enforces a minimum margin threshold so a suggestion can never lure the rep
 * into a margin-destroying add — "live margin impact" is the product promise, so
 * the engine reports exactly what each add would do to the quote.
 *
 * Everything below is data-driven; the seed file populates realistic pairings
 * and promotions rather than the engine hardcoding pairs.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { categories, products, productPairings, promotions, recommendationDismissals } from '@/db/schema/index.js';
import type { DbExecutor } from '@/db/client.js';
import { resolveProductPricing } from '../pricing/pricing.service.js';
import { writeAudit, type AuditActor } from '../audit/audit.service.js';
import { notFound } from '@/lib/errors.js';
import { BP_FULL } from '@dealflow/shared';

/** Hard floor below which a recommendation is withheld; config could expose it later. */
export const MIN_RECOMMENDATION_MARGIN_BP = 2000;

export interface RecommendationSuggestion {
  productId: string;
  productName: string;
  productSku: string;
  categoryName: string;
  unitPricePaise: number;
  /** Margin this product alone would carry at the current list price, in bp. */
  marginBp: number;
  /** Absolute margin in paise if added now. */
  marginPaise: number;
  /** Weighted score for ranking. */
  score: number;
  /** Active promotion name, if one applies. */
  promotion?: string;
  promotionPriority?: number;
}

export async function listRecommendations(exec: DbExecutor, quotationId: string): Promise<RecommendationSuggestion[]> {
  const quote = await exec.query.quotations.findFirst({
    where: (table, { eq }) => eq(table.id, quotationId),
    with: { customer: true, lines: true },
  });
  if (!quote) throw notFound('QUOTE_NOT_FOUND', 'Quotation not found');

  const sourceProductIds = quote.lines.map((line) => line.productId);
  if (!sourceProductIds.length) return [];

  const dismissals = await exec
    .select({ productId: recommendationDismissals.productId })
    .from(recommendationDismissals)
    .where(eq(recommendationDismissals.quotationId, quotationId));
  const dismissedIds = new Set(dismissals.map((d) => d.productId));

  const alreadyOnQuote = new Set(sourceProductIds);
  const pairings = await exec
    .select()
    .from(productPairings)
    .where(inArray(productPairings.productId, sourceProductIds));

  const candidateIds = [...new Set(pairings.map((p) => p.recommendedProductId))].filter(
    (id) => !alreadyOnQuote.has(id) && !dismissedIds.has(id),
  );
  if (!candidateIds.length) return [];

  // Sequential: `exec` is usually a transaction, which is pinned to one connection.
  const candidateRows = await exec
    .select()
    .from(products)
    .where(and(inArray(products.id, candidateIds), eq(products.active, true)));
  const activePromos = await exec
    .select()
    .from(promotions)
    .where(and(eq(promotions.active, true), inArray(promotions.productId, candidateIds)));
  const categoriesByName = await exec.select().from(categories);

  const categoryNameById = new Map(categoriesByName.map((c) => [c.id, c.name]));
  const promoByProduct = new Map<string, (typeof activePromos)[number][]>();
  for (const promo of activePromos) {
    const list = promoByProduct.get(promo.productId) ?? [];
    list.push(promo);
    promoByProduct.set(promo.productId, list);
  }

  const weightByCandidate = new Map<string, number>();
  for (const pairing of pairings) {
    weightByCandidate.set(
      pairing.recommendedProductId,
      (weightByCandidate.get(pairing.recommendedProductId) ?? 0) + pairing.weight,
    );
  }

  const suggestions: RecommendationSuggestion[] = [];

  for (const product of candidateRows) {
    const pricing = await resolveProductPricing(exec, product.id, quote.customer.tierId);
    const unitPrice = pricing.unitPricePaise;
    if (unitPrice <= 0) continue;

    const marginPaise = unitPrice - pricing.unitCostPaise;
    const marginBp = Math.round((marginPaise / unitPrice) * BP_FULL);
    if (marginBp < MIN_RECOMMENDATION_MARGIN_BP) continue;

    const now = new Date();
    const promos = (promoByProduct.get(product.id) ?? [])
      .filter((promo) => (!promo.startsAt || promo.startsAt <= now) && (!promo.endsAt || promo.endsAt >= now))
      .sort((a, b) => b.priority - a.priority);

    const promo = promos[0];
    const score = (weightByCandidate.get(product.id) ?? 1) + (promo ? promo.priority * 100 : 0);

    suggestions.push({
      productId: product.id,
      productName: product.name,
      productSku: product.sku,
      categoryName: categoryNameById.get(product.categoryId) ?? product.categoryId,
      unitPricePaise: unitPrice,
      marginBp,
      marginPaise,
      score,
      promotion: promo?.label,
      promotionPriority: promo?.priority,
    });
  }

  suggestions.sort((a, b) => b.score - a.score);
  return suggestions;
}

export async function dismissRecommendation(
  exec: DbExecutor,
  quotationId: string,
  productId: string,
  actor: AuditActor & { userId: string },
) {
  const quote = await exec.query.quotations.findFirst({ where: (table, { eq }) => eq(table.id, quotationId) });
  if (!quote) throw notFound('QUOTE_NOT_FOUND', 'Quotation not found');

  await exec
    .insert(recommendationDismissals)
    .values({
      quotationId,
      productId,
      dismissedById: actor.userId,
    })
    .onConflictDoNothing({ target: [recommendationDismissals.quotationId, recommendationDismissals.productId] });

  await writeAudit(exec, {
    ...actor,
    entityType: 'QUOTATION',
    entityId: quotationId,
    action: 'RECOMMENDATION_DISMISSED',
    newValue: { productId },
    quotationId,
    quotationVersion: quote.version,
    reason: 'Recommendation dismissed',
  });
}