/**
 * Shared loading / empty / error placeholders.
 *
 * These existed as bare `<div className="muted">Loading…</div>` on every page,
 * which meant the table jumped as data arrived and an empty result looked
 * identical to a failed one. Giving each state a shape of its own — a spinner
 * while fetching, an explanatory panel when there is genuinely nothing, a red
 * panel when the request failed — makes the difference legible at a glance.
 *
 * Purely presentational: no data fetching, no side effects.
 */

import type { ReactNode } from 'react';
import type { ApiError } from '../api.js';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/**
 * Skeleton rows sized to the column count, so the table keeps its geometry while
 * the first page of data is in flight.
 */
export function SkeletonRows({ columns, rows = 4 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden="true">
          {Array.from({ length: columns }, (_, c) => (
            <td key={c}>
              <div className="skeleton" style={{ width: c === 0 ? '58%' : `${42 + ((r + c) % 3) * 14}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Nothing to show, and why — plus an optional way out. */
export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="state center">
      <div className="empty-icon" aria-hidden="true">—</div>
      <div className="state-title">{title}</div>
      {hint && <div className="state-hint">{hint}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

/** A failed request, with the API's own code so it can be looked up. */
export function ErrorNotice({ error }: { error: ApiError }) {
  return (
    <div className="error" role="alert">
      <strong>{error.code}</strong> — {error.message}
    </div>
  );
}
