/**
 * Money and percentage primitives.
 *
 * ## Why integers
 *
 * Every monetary amount in DealFlow360 is stored and transported as an **integer
 * number of paise** (INR minor units, 1 rupee = 100 paise). Every percentage is
 * stored and transported as an integer number of **basis points** (1% = 100 bp).
 *
 * PRD §22 (Correctness) requires deterministic, testable business rules, and
 * DOMAIN_MODEL invariant 10 requires quote totals to be derivable from persisted
 * lines. Binary floating point cannot satisfy either: `0.1 + 0.2 !== 0.3`, and a
 * discount of `18%` applied to `₹10,000` must produce exactly the same number on
 * the risk engine, the invoice and the credit note. Integer minor units make all
 * arithmetic exact and all comparisons total.
 *
 * Conversion to a human-readable decimal happens only at the presentation edge.
 */

/** An integer count of paise. 1 INR === 100 paise. */
export type Paise = number;

/** An integer count of basis points. 1% === 100 bp. */
export type BasisPoints = number;

export const PAISE_PER_RUPEE = 100;
export const BP_PER_PERCENT = 100;
export const BP_FULL = 10_000; // 100%

/**
 * Round half-away-from-zero to an integer.
 *
 * `Math.round` is asymmetric for negatives (`Math.round(-0.5) === -0`), which
 * would make a proration credit and its equivalent debit differ by one paise.
 * Proration and credit notes legitimately produce negative amounts, so rounding
 * must be sign-symmetric.
 */
export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Convert a rupee amount (possibly fractional) to exact paise. */
export function rupeesToPaise(rupees: number): Paise {
  return roundHalfAwayFromZero(rupees * PAISE_PER_RUPEE);
}

/** Convert paise to a rupee number. Presentation only — never use for maths. */
export function paiseToRupees(amount: Paise): number {
  return amount / PAISE_PER_RUPEE;
}

/** Convert a percent (possibly fractional, e.g. 12.5) to exact basis points. */
export function percentToBp(percent: number): BasisPoints {
  return roundHalfAwayFromZero(percent * BP_PER_PERCENT);
}

/** Convert basis points to a percent number. Presentation only. */
export function bpToPercent(bp: BasisPoints): number {
  return bp / BP_PER_PERCENT;
}

/**
 * Apply a basis-point rate to a paise amount, rounded to the nearest paise.
 * e.g. `applyBp(1_000_000, 1_800)` = 18% of ₹10,000 = ₹1,800 = 180000 paise.
 */
export function applyBp(amount: Paise, bp: BasisPoints): Paise {
  return roundHalfAwayFromZero((amount * bp) / BP_FULL);
}

/** Sum a list of paise amounts. Exact — no accumulation error. */
export function sumPaise(amounts: readonly Paise[]): Paise {
  let total = 0;
  for (const amount of amounts) total += amount;
  return total;
}

/**
 * Multiply a paise amount by an integer quantity.
 * Separate helper so the intent is explicit at call sites.
 */
export function multiplyPaise(unitAmount: Paise, quantity: number): Paise {
  return roundHalfAwayFromZero(unitAmount * quantity);
}

/**
 * Proportional share of `total` weighted by `weight / totalWeight`, in paise.
 * Used by order-level discount apportionment so the apportioned parts always
 * re-sum to the original total (see `apportionPaise`).
 */
export function apportionPaise(total: Paise, weights: readonly number[]): Paise[] {
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  if (totalWeight <= 0) return weights.map(() => 0);

  const parts: Paise[] = [];
  let allocated = 0;
  for (let index = 0; index < weights.length; index += 1) {
    const isLast = index === weights.length - 1;
    if (isLast) {
      // The final part absorbs the rounding remainder so the sum is exact.
      parts.push(total - allocated);
      break;
    }
    const weight = weights[index] ?? 0;
    const part = roundHalfAwayFromZero((total * weight) / totalWeight);
    parts.push(part);
    allocated += part;
  }
  return parts;
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format paise as "₹80,000.00". Presentation only. */
export function formatMoney(amount: Paise): string {
  return inrFormatter.format(paiseToRupees(amount));
}

/** Format basis points as "12%" / "12.5%". Presentation only. */
export function formatPercent(bp: BasisPoints, fractionDigits?: number): string {
  const percent = bpToPercent(bp);
  const digits = fractionDigits ?? (Number.isInteger(percent) ? 0 : 2);
  return `${percent.toFixed(digits)}%`;
}

/** Format basis points as percentage *points* — used for violation reporting. */
export function formatPoints(bp: BasisPoints): string {
  const points = bpToPercent(bp);
  const digits = Number.isInteger(points) ? 0 : 2;
  return `${points.toFixed(digits)} pt${points === 1 ? '' : 's'}`;
}
