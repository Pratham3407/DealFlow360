import clsx from 'clsx';
import type { ReactNode } from 'react';

interface PanelProps {
  title?: string;
  description?: string;
  /** Right-aligned header slot for actions. */
  actions?: ReactNode;
  /** Removes body padding, for panels whose body is a full-bleed table. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

/** Bordered content container - the standard surface for a section of a page. */
export function Panel({
  title,
  description,
  actions,
  flush = false,
  className,
  children,
}: PanelProps): ReactNode {
  return (
    <section
      className={clsx(
        'overflow-hidden rounded-lg border border-hairline bg-surface shadow-xs',
        className,
      )}
    >
      {title ? (
        <header className="flex items-start justify-between gap-4 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {description ? <p className="mt-0.5 text-[13px] text-slate-500">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={flush ? undefined : 'px-4 py-4'}>{children}</div>
    </section>
  );
}

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps): ReactNode {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-slate-600">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Key/value row used for dense metadata blocks. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="label-micro w-48 shrink-0">{label}</dt>
      <dd className="min-w-0 text-sm text-slate-800">{children}</dd>
    </div>
  );
}
