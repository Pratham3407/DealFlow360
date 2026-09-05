/**
 * Blended Discount Risk Score (BUSINESS_RULES.md §3).
 *
 * The source specification requires a risk score that:
 *   - flags a single severe line violation, **and**
 *   - lets several individually-small violations fire collectively, and
 *   - accounts for order-level discounts, and
 *   - is fully deterministic.
 *
 * The model is the weighted sum of four integer-basis-point components:
 *
 *   Severity  = max(line_violation_bp)                     — the worst single breach
 *   Breadth   = sum(line_violation_bp)                     — total violation mass
 *   Exposure  = sum(violation_bp × net_share_bp / 10000)   — value-weighted leakage
 *   OrderRisk = max(0, order_discount_bp − order_ceiling_bp) — order-level breach
 *
 *   total_bp = severity×wS + breadth×wB + exposure×wE + order×wO  /  (weights in bp)
 *
 * Why Exposure is included: `max(line_violation)` alone (the "worst line") misses
 * a 300-pt breach on a ₹5,000,000 line, and `sum` alone lets ten trivial breaches
 * on tiny lines outvote a material one. Exposure keeps both meaningful (PRD §13:
 * "one severe line can trigger approval; several smaller violations can
 * collectively trigger approval; do not use only max").
 *
 * The four weights and the approval bands are database configuration
 * (`system_settings.risk_weights`, `approval_rules`) — nothing here is hardcoded.
 */

import type { BasisPoints, Paise } from '@dealflow/shared';
import { BP_FULL, applyBp } from '@dealflow/shared';

export interface RiskLineInput {
  lineId: string;
  productName: string;
  /** Discount actually applied on the line, in basis points. */
  discountBp: BasisPoints;
  /** Ceiling resolved for this line, in basis points. */
  effectiveCeilingBp: BasisPoints;
  /** Net line amount (after line + order discounts), used for value weighting. */
  netAmountPaise: Paise;
}

export interface RiskWeights {
  /** Weight of the worst-single-line component, in basis points (e.g. 6000 = 0.60). */
  severityWeightBp: number;
  /** Weight of the total-violation-mass component. */
  breadthWeightBp: number;
  /** Weight of the value-weighted leakage component. */
  exposureWeightBp: number;
  /** Weight of the order-level discount component. */
  orderWeightBp: number;
}

export const DEFAULT_RISK_WEIGHTS: RiskWeights = {
  severityWeightBp: 6000,
  breadthWeightBp: 3000,
  exposureWeightBp: 10_000,
  orderWeightBp: 10_000,
};

export interface RiskLineDetail {
  lineId: string;
  productName: string;
  discountBp: BasisPoints;
  ceilingBp: BasisPoints;
  violationBp: BasisPoints;
  /** Share of order net amount, in basis points (0–10000). */
  shareBp: number;
  exposureBp: number;
}

export interface RiskComponent {
  name: 'SEVERITY' | 'BREADTH' | 'EXPOSURE' | 'ORDER';
  valueBp: number;
}

export interface RiskBreakdown {
  version: 1;
  totalBp: number;
  components: RiskComponent[];
  lines: RiskLineDetail[];
  orderDiscountBp: BasisPoints;
  orderCeilingBp: BasisPoints;
  orderViolationBp: BasisPoints;
}

/** Compute `max(0, requested − ceiling)` per BUSINESS_RULES.md §2. */
export function lineViolationBp(discountBp: BasisPoints, ceilingBp: BasisPoints): BasisPoints {
  return Math.max(0, discountBp - ceilingBp);
}

export function singleSeriousRiskBreakdown(): RiskBreakdown {
  return {
    version: 1,
    totalBp: 0,
    components: [],
    lines: [],
    orderDiscountBp: 0,
    orderCeilingBp: 0,
    orderViolationBp: 0,
  };
}

/**
 * Compute the blended score for a quotation.
 *
 * `orderCeilingBp` is the effective ceiling for the order-level discount: the
 * strictest line ceiling present. An order-level discount of 12% on a quote whose
 * binding category ceiling is 10% is a 2-point order violation even if every line
 * individually stays inside its own ceiling.
 */
export function computeBlendedRisk(params: {
  lines: RiskLineInput[];
  orderDiscountBp: BasisPoints;
  orderCeilingBp: BasisPoints;
  weights: RiskWeights;
}): RiskBreakdown {
  const { lines, orderDiscountBp, orderCeilingBp, weights } = params;

  const netTotal = lines.reduce((acc, line) => acc + line.netAmountPaise, 0);

  const lineDetails: RiskLineDetail[] = lines.map((line) => {
    const violationBp = lineViolationBp(line.discountBp, line.effectiveCeilingBp);
    const shareBp = netTotal > 0 ? Math.round((line.netAmountPaise / netTotal) * BP_FULL) : 0;
    const exposureBp = Math.round((violationBp * shareBp) / BP_FULL);
    return {
      lineId: line.lineId,
      productName: line.productName,
      discountBp: line.discountBp,
      ceilingBp: line.effectiveCeilingBp,
      violationBp,
      shareBp,
      exposureBp,
    };
  });

  const severityBp = lineDetails.reduce((max, line) => Math.max(max, line.violationBp), 0);
  const breadthBp = lineDetails.reduce((sum, line) => sum + line.violationBp, 0);
  const exposureBp = lineDetails.reduce((sum, line) => sum + line.exposureBp, 0);
  const orderViolationBp = lineViolationBp(orderDiscountBp, orderCeilingBp);

  const components: RiskComponent[] = [
    { name: 'SEVERITY', valueBp: severityBp },
    { name: 'BREADTH', valueBp: breadthBp },
    { name: 'EXPOSURE', valueBp: exposureBp },
    { name: 'ORDER', valueBp: orderViolationBp },
  ];

  const totalBp = components.reduce((total, component) => {
    const weight =
      component.name === 'SEVERITY'
        ? weights.severityWeightBp
        : component.name === 'BREADTH'
          ? weights.breadthWeightBp
          : component.name === 'EXPOSURE'
            ? weights.exposureWeightBp
            : weights.orderWeightBp;
    return total + applyBp(component.valueBp, weight);
  }, 0);

  return {
    version: 1,
    totalBp,
    components,
    lines: lineDetails,
    orderDiscountBp,
    orderCeilingBp,
    orderViolationBp,
  };
}

/** A band from the `approval_rules` table. */
export interface ApprovalBand {
  minRiskBp: number;
  /** Null = open-ended ("and above"). */
  maxRiskBp: number | null;
  requiredLevel: 'NONE' | 'MANAGER' | 'MANAGER_FINANCE';
  priority: number;
}

/**
 * Route a risk score to a required approval level.
 *
 * Bands are ordered by priority (still using the range to break ambiguity) and
 * the first band containing the score wins. The mapping itself lives in the
 * database (BUSINESS_RULES.md §4) — this function only applies the configured
 * bands deterministically.
 */
export function classifyRisk(
  totalBp: number,
  bands: readonly ApprovalBand[],
): 'NONE' | 'MANAGER' | 'MANAGER_FINANCE' {
  const ordered = [...bands].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.minRiskBp - b.minRiskBp;
  });

  for (const band of ordered) {
    const aboveMin = totalBp >= band.minRiskBp;
    const belowMax = band.maxRiskBp === null || totalBp <= band.maxRiskBp;
    if (aboveMin && belowMax) return band.requiredLevel;
  }

  return 'NONE';
}