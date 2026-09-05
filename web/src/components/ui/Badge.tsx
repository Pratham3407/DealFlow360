import clsx from 'clsx';
import type { ReactNode } from 'react';

/**
 * Badge tones carry operational meaning, not decoration: neutral for
 * informational state, positive/warning/critical for status that needs action,
 * and accent for a highlighted classification.
 */
export type BadgeTone = 'neutral' | 'positive' | 'warning' | 'critical' | 'accent';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  positive: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  critical: 'bg-red-50 text-red-800 ring-red-200',
  accent: 'bg-brand-50 text-brand-800 ring-brand-100',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold',
        'uppercase tracking-wide ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
