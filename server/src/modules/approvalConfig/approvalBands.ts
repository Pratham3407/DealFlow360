import { Prisma } from '../../generated/prisma/client';
import type { ApprovalLevelRequirement } from '../../generated/prisma/enums';

/**
 * Approval band validation - docs/BUSINESS_RULES.md 4.
 *
 * Thresholds are configuration, which means a well-meaning edit can leave a risk
 * score with nowhere to route. A pure validator lets the API reject that at write
 * time rather than discovering it when a quotation is submitted.
 *
 * Bands are half-open `[minimumRisk, maximumRisk)`; a null maximum is unbounded.
 * The active set must tile `[0, infinity)` with no gap and no overlap.
 */

export interface ApprovalBand {
  id: string;
  name: string;
  minimumRisk: string | Prisma.Decimal;
  maximumRisk: string | Prisma.Decimal | null;
  requiredLevel: ApprovalLevelRequirement;
  active: boolean;
}

export type BandProblem =
  | { kind: 'EMPTY'; message: string }
  | { kind: 'DOES_NOT_START_AT_ZERO'; message: string }
  | { kind: 'GAP'; message: string; from: string; to: string }
  | { kind: 'OVERLAP'; message: string; first: string; second: string }
  | { kind: 'UNBOUNDED_MISSING'; message: string }
  | { kind: 'INVERTED'; message: string; band: string };

interface NormalisedBand {
  id: string;
  name: string;
  min: Prisma.Decimal;
  max: Prisma.Decimal | null;
}

function normalise(bands: readonly ApprovalBand[]): NormalisedBand[] {
  return bands
    .filter((band) => band.active)
    .map((band) => ({
      id: band.id,
      name: band.name,
      min: new Prisma.Decimal(band.minimumRisk),
      max: band.maximumRisk === null ? null : new Prisma.Decimal(band.maximumRisk),
    }))
    .sort((a, b) => a.min.comparedTo(b.min));
}

/**
 * Every problem with the active set, not just the first, so an administrator can
 * fix the configuration in one pass.
 */
export function validateApprovalBands(bands: readonly ApprovalBand[]): BandProblem[] {
  const sorted = normalise(bands);
  const problems: BandProblem[] = [];

  if (sorted.length === 0) {
    return [
      {
        kind: 'EMPTY',
        message: 'At least one active approval rule is required, otherwise no risk score can route.',
      },
    ];
  }

  for (const band of sorted) {
    if (band.max !== null && band.max.lessThanOrEqualTo(band.min)) {
      problems.push({
        kind: 'INVERTED',
        message: `"${band.name}" ends at or before it starts.`,
        band: band.name,
      });
    }
  }

  const first = sorted[0]!;
  if (!first.min.isZero()) {
    problems.push({
      kind: 'DOES_NOT_START_AT_ZERO',
      message: `The lowest band starts at ${first.min.toString()}; a risk score below that would not route. It must start at 0.`,
    });
  }

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index]!;
    const next = sorted[index + 1]!;

    if (current.max === null) {
      problems.push({
        kind: 'OVERLAP',
        message: `"${current.name}" is unbounded, so "${next.name}" can never be reached.`,
        first: current.name,
        second: next.name,
      });
      continue;
    }

    const comparison = current.max.comparedTo(next.min);
    if (comparison < 0) {
      problems.push({
        kind: 'GAP',
        message: `Risk between ${current.max.toString()} and ${next.min.toString()} does not route anywhere.`,
        from: current.max.toString(),
        to: next.min.toString(),
      });
    } else if (comparison > 0) {
      problems.push({
        kind: 'OVERLAP',
        message: `"${current.name}" and "${next.name}" both cover risk at ${next.min.toString()}.`,
        first: current.name,
        second: next.name,
      });
    }
  }

  if (sorted[sorted.length - 1]!.max !== null) {
    problems.push({
      kind: 'UNBOUNDED_MISSING',
      message:
        'The highest band must have no maximum, otherwise a sufficiently risky quotation would not route.',
    });
  }

  return problems;
}

/**
 * The band a score falls into, or null when the configuration does not cover it.
 *
 * Used by the approval engine; kept beside the validator so routing and
 * validation share one definition of a band.
 */
export function bandForRisk(
  bands: readonly ApprovalBand[],
  riskScore: string | Prisma.Decimal,
): ApprovalBand | null {
  const score = new Prisma.Decimal(riskScore);

  const match = bands
    .filter((band) => band.active)
    .find((band) => {
      const min = new Prisma.Decimal(band.minimumRisk);
      if (score.lessThan(min)) return false;
      if (band.maximumRisk === null) return true;
      return score.lessThan(new Prisma.Decimal(band.maximumRisk));
    });

  return match ?? null;
}
