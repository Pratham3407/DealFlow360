/**
 * Canonical system settings.
 *
 * These keys are the source of truth for every engine knob. Values stored in
 * `system_settings` override the defaults; reads are typed here so a typo in a
 * setting key is a compile error rather than a silent default.
 *
 * Storing real config as data (AGENT_INSTRUCTIONS.md §2) does not mean treating
 * defaults as disposable — the defaults below are the *documented* calibration
 * the acceptance tests and the canonical demo are built against.
 */

import type { RiskWeights } from '../risk/risk-engine.js';
import type { DbExecutor } from '@/db/client.js';

export interface RiskSettings {
  weights: RiskWeights;
}

export interface DealHealthSettings {
  /** A quotation with no commercial activity beyond this many days is STALLED. */
  stalledAfterDays: number;
  /**
   * A rep's quotation discount that exceeds their historical average by more than
   * this multiple (in basis points, i.e. 15000 = 1.50×) is a DISCOUNT_ANOMALY.
   */
  anomalyVsHistoricalMultiplierBp: number;
  /** A projected delivery later than promised by more than this many days slips. */
  deliverySlippageDays: number;
}

export interface BillingSettings {
  /** How many intervals of a billing schedule to generate ahead at creation. */
  scheduleHorizon: number;
}

export const SETTING_DEFAULTS = {
  riskWeights: {
    severityWeightBp: 6000,
    breadthWeightBp: 3000,
    exposureWeightBp: 10_000,
    orderWeightBp: 10_000,
  } satisfies RiskWeights,
  dealHealthStalledAfterDays: 7,
  dealHealthAnomalyMultiplierBp: 15_000,
  dealHealthDeliverySlippageDays: 2,
  billingScheduleHorizon: 12,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

const asInt = (value: string | null | undefined, fallback: number): number => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Read a single integer-valued setting from the database, merging the default. */
export async function readSettingInt(exec: Pick<DbExecutor, 'query'>, key: string, fallback: number): Promise<number> {
  const row = await exec.query.systemSettings.findFirst({
    where: (table, { eq }) => eq(table.key, key),
  });
  return asInt(row?.value ?? null, fallback);
}

/**
 * Read the currently effective settings, merging DB overrides over defaults.
 *
 * Parse failures fall back to the default rather than returning garbage. The
 * deal-health sweep and the risk engine both run as background work, and a
 * half-written setting should degrade to the documented behaviour, not crash.
 */
export function resolveSettings(
  overrides: ReadonlyMap<string, string>,
): {
  riskWeights: RiskSettings['weights'];
  dealHealth: DealHealthSettings;
  billing: BillingSettings;
} {
  return {
    riskWeights: {
      severityWeightBp: asInt(overrides.get('riskWeights.severityWeightBp'), SETTING_DEFAULTS.riskWeights.severityWeightBp),
      breadthWeightBp: asInt(overrides.get('riskWeights.breadthWeightBp'), SETTING_DEFAULTS.riskWeights.breadthWeightBp),
      exposureWeightBp: asInt(overrides.get('riskWeights.exposureWeightBp'), SETTING_DEFAULTS.riskWeights.exposureWeightBp),
      orderWeightBp: asInt(overrides.get('riskWeights.orderWeightBp'), SETTING_DEFAULTS.riskWeights.orderWeightBp),
    },
    dealHealth: {
      stalledAfterDays: asInt(overrides.get('dealHealth.stalledAfterDays'), SETTING_DEFAULTS.dealHealthStalledAfterDays),
      anomalyVsHistoricalMultiplierBp: asInt(
        overrides.get('dealHealth.anomalyVsHistoricalMultiplierBp'),
        SETTING_DEFAULTS.dealHealthAnomalyMultiplierBp,
      ),
      deliverySlippageDays: asInt(
        overrides.get('dealHealth.deliverySlippageDays'),
        SETTING_DEFAULTS.dealHealthDeliverySlippageDays,
      ),
    },
    billing: {
      scheduleHorizon: asInt(overrides.get('billing.scheduleHorizon'), SETTING_DEFAULTS.billingScheduleHorizon),
    },
  };
}