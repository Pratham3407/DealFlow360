import clsx from 'clsx';
import type { ReactNode } from 'react';
import { ApiError } from '../../lib/api';

type AlertTone = 'error' | 'warning' | 'info';

const ALERT_TONES: Record<AlertTone, string> = {
  error: 'border-red-200 bg-red-50 text-red-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-brand-100 bg-brand-50 text-brand-800',
};

interface AlertProps {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  className?: string;
}

export function Alert({ tone = 'error', title, children, className }: AlertProps): ReactNode {
  return (
    <div
      // role=alert so a submission failure is announced immediately rather than
      // relying on the user noticing new red text.
      role="alert"
      className={clsx('rounded-md border px-3 py-2.5 text-[13px]', ALERT_TONES[tone], className)}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? 'mt-0.5' : undefined}>{children}</div> : null}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }): ReactNode {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-500">
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"
      />
      <span>{label}</span>
    </span>
  );
}

/** Full-panel loading state. */
export function LoadingState({ label = 'Loading' }: { label?: string }): ReactNode {
  return (
    <div className="flex items-center justify-center py-12" aria-live="polite" aria-busy="true">
      <Spinner label={label} />
    </div>
  );
}

/** Full-panel empty state. Explains what would appear here and why it has not. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-md text-[13px] text-slate-500">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * Full-panel error state.
 *
 * Distinguishes the three failures a user can act on differently: the API is
 * unreachable, the session has gone, or permission is missing.
 */
export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: (() => void) | undefined;
}): ReactNode {
  const apiError = error instanceof ApiError ? error : null;

  const title = (() => {
    if (!apiError) return 'Something went wrong';
    if (apiError.code === 'NETWORK_ERROR') return 'Cannot reach the API';
    if (apiError.isUnauthenticated) return 'Your session has ended';
    if (apiError.isForbidden) return 'You do not have access to this';
    return 'Request failed';
  })();

  const message =
    apiError?.code === 'NETWORK_ERROR'
      ? 'The DealFlow360 API is not responding. Check that the server is running on port 4000.'
      : (apiError?.message ?? (error instanceof Error ? error.message : 'Unknown error'));

  return (
    <div className="px-6 py-10">
      <Alert tone="error" title={title}>
        <p>{message}</p>
        {apiError?.requestId ? (
          <p className="mt-1 font-mono text-[11px] opacity-70">request {apiError.requestId}</p>
        ) : null}
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 text-[13px] font-semibold underline underline-offset-2"
          >
            Try again
          </button>
        ) : null}
      </Alert>
    </div>
  );
}
