import clsx from 'clsx';
import type { ReactNode } from 'react';

/**
 * Thin table primitives.
 *
 * Tabular data belongs in a real table (AGENTS.md 27), which also gives screen
 * readers row and column semantics for free. These wrappers only supply the
 * house style - callers keep full control of the markup.
 */
export function Table({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

export function Thead({ children }: { children: ReactNode }): ReactNode {
  return <thead className="border-b border-hairline bg-slate-50/80">{children}</thead>;
}

export function Th({
  children,
  align = 'left',
  className,
}: {
  children?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}): ReactNode {
  return (
    <th
      scope="col"
      className={clsx(
        'label-micro whitespace-nowrap px-4 py-2.5',
        align === 'right' && 'text-right',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Tbody({ children }: { children: ReactNode }): ReactNode {
  return <tbody className="divide-y divide-hairline">{children}</tbody>;
}

export function Tr({ children }: { children: ReactNode }): ReactNode {
  return <tr className="hover:bg-slate-50/70">{children}</tr>;
}

export function Td({
  children,
  align = 'left',
  className,
}: {
  children?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}): ReactNode {
  return (
    <td
      className={clsx('px-4 py-2.5 text-slate-700', align === 'right' && 'text-right', className)}
    >
      {children}
    </td>
  );
}
