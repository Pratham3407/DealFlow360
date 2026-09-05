/**
 * Human labels for subscription-plan enums.
 *
 * The plan table rendered raw values like `DAILY_PRORATA` and `END_OF_PERIOD`,
 * which name the mode without saying what it does to a customer's bill. Each one
 * gets a short label and the consequence it actually has, so a finance operator
 * can tell two plans apart without reading the service code.
 */

export interface ModeLabel {
  label: string;
  effect: string;
}

export const INTERVAL_LABEL: Record<string, ModeLabel> = {
  MONTHLY: { label: 'Monthly', effect: 'Invoiced every month.' },
  QUARTERLY: { label: 'Quarterly', effect: 'Invoiced every three months.' },
  YEARLY: { label: 'Yearly', effect: 'Invoiced once a year.' },
};

export const PRORATION_LABEL: Record<string, ModeLabel> = {
  NONE: {
    label: 'No proration',
    effect: 'A quantity change takes effect from the next period; the current one bills unchanged.',
  },
  DAILY_PRORATA: {
    label: 'Daily pro-rata',
    effect: 'A mid-period change is charged for the days remaining in the period.',
  },
  FULL_PERIOD: {
    label: 'Full period',
    effect: 'A mid-period change is charged as if it applied for the whole period.',
  },
};

export const CANCELLATION_LABEL: Record<string, ModeLabel> = {
  IMMEDIATE: {
    label: 'Immediate',
    effect: 'Service stops on the cancellation date and no further periods are billed.',
  },
  END_OF_PERIOD: {
    label: 'End of period',
    effect: 'Service continues until the paid period ends, then stops.',
  },
};

export const REFUND_LABEL: Record<string, ModeLabel> = {
  NONE: { label: 'No refund', effect: 'Cancelling does not return any part of the period already paid.' },
  PARTIAL_PRORATA: { label: 'Pro-rata refund', effect: 'The unused days of the current period are credited back.' },
  FULL: { label: 'Full refund', effect: 'The whole current period is credited back on cancellation.' },
};

export const DAY_COUNT_LABEL: Record<string, ModeLabel> = {
  ACTUAL_DAYS: { label: 'Actual days', effect: 'Proration uses the real number of days in the period.' },
  THIRTY_DAY_MONTH: { label: '30-day month', effect: 'Proration treats every month as exactly 30 days.' },
};

/** Fall back to a readable form of the raw value rather than showing nothing. */
export function modeLabel(map: Record<string, ModeLabel>, raw: string | null | undefined): ModeLabel {
  if (!raw) return { label: '—', effect: 'Not configured on this plan.' };
  return map[raw] ?? { label: raw.replace(/_/g, ' ').toLowerCase(), effect: '' };
}
