import { Prisma } from '../../generated/prisma/client';

/**
 * Effective discount ceiling resolution - docs/BUSINESS_RULES.md 1.
 *
 * Kept as a pure function over plain data so it can be unit tested exhaustively
 * and reused unchanged by the risk engine, which must reach the same answer the
 * configuration screen shows. Nothing here touches the database.
 *
 * Precedence, most specific first:
 *   1. an active rule for (tier, category)
 *   2. an active rule for (tier, any category)
 *   3. the tier's own default ceiling
 *
 * Priority only breaks ties between rules of equal specificity - a tier-wide rule
 * with priority 99 still loses to a category rule with priority 0, because
 * "most specific wins" is the documented rule and priority is the tiebreaker
 * within it, not an override of it.
 */

export interface CeilingRule {
  id: string;
  customerTierId: string;
  /** Null means the rule applies to every category in the tier. */
  categoryId: string | null;
  /** Percent 0-100. String or Decimal so no float ever enters the comparison. */
  maximumDiscount: string | Prisma.Decimal;
  priority: number;
  active: boolean;
}

export type CeilingSource = 'CATEGORY_RULE' | 'TIER_RULE' | 'TIER_DEFAULT';

export interface EffectiveCeiling {
  /** Percent 0-100, three decimals. */
  maximumDiscount: string;
  source: CeilingSource;
  /** The rule that decided it, or null when falling back to the tier default. */
  ruleId: string | null;
}

export interface ResolveCeilingInput {
  rules: readonly CeilingRule[];
  customerTierId: string;
  /** Null resolves the tier-wide ceiling, ignoring category rules. */
  categoryId: string | null;
  /** The tier's `defaultDiscountCeiling`, used when no rule matches. */
  tierDefaultCeiling: string | Prisma.Decimal;
}

const PERCENT_SCALE = 3;

/**
 * Among rules of equal specificity: highest priority wins; if priority ties, the
 * stricter (lower) ceiling wins; if both tie, the lowest id wins. The last step
 * exists only so the result never depends on row order.
 */
function pickBest(candidates: readonly CeilingRule[]): CeilingRule | null {
  let best: CeilingRule | null = null;
  let bestCeiling: Prisma.Decimal | null = null;

  for (const candidate of candidates) {
    const ceiling = new Prisma.Decimal(candidate.maximumDiscount);

    if (!best || !bestCeiling) {
      best = candidate;
      bestCeiling = ceiling;
      continue;
    }

    if (candidate.priority > best.priority) {
      best = candidate;
      bestCeiling = ceiling;
      continue;
    }
    if (candidate.priority < best.priority) continue;

    if (ceiling.lessThan(bestCeiling)) {
      best = candidate;
      bestCeiling = ceiling;
      continue;
    }
    if (ceiling.greaterThan(bestCeiling)) continue;

    if (candidate.id < best.id) {
      best = candidate;
      bestCeiling = ceiling;
    }
  }

  return best;
}

export function resolveEffectiveCeiling(input: ResolveCeilingInput): EffectiveCeiling {
  const forTier = input.rules.filter(
    (rule) => rule.active && rule.customerTierId === input.customerTierId,
  );

  if (input.categoryId !== null) {
    const categoryRule = pickBest(forTier.filter((rule) => rule.categoryId === input.categoryId));
    if (categoryRule) {
      return {
        maximumDiscount: new Prisma.Decimal(categoryRule.maximumDiscount).toFixed(PERCENT_SCALE),
        source: 'CATEGORY_RULE',
        ruleId: categoryRule.id,
      };
    }
  }

  const tierRule = pickBest(forTier.filter((rule) => rule.categoryId === null));
  if (tierRule) {
    return {
      maximumDiscount: new Prisma.Decimal(tierRule.maximumDiscount).toFixed(PERCENT_SCALE),
      source: 'TIER_RULE',
      ruleId: tierRule.id,
    };
  }

  return {
    maximumDiscount: new Prisma.Decimal(input.tierDefaultCeiling).toFixed(PERCENT_SCALE),
    source: 'TIER_DEFAULT',
    ruleId: null,
  };
}

/**
 * Violation in percentage points - docs/BUSINESS_RULES.md 2.
 *
 * Zero when the requested discount is within the ceiling. Exposed here so the
 * configuration preview and the risk engine cannot disagree about what a
 * violation is.
 */
export function violationPoints(
  requestedDiscount: string | Prisma.Decimal,
  effectiveCeiling: string | Prisma.Decimal,
): string {
  const over = new Prisma.Decimal(requestedDiscount).minus(new Prisma.Decimal(effectiveCeiling));
  return (over.isNegative() ? new Prisma.Decimal(0) : over).toFixed(PERCENT_SCALE);
}
