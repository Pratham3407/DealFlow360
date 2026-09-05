import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-700 text-white border-brand-700 hover:bg-brand-800 hover:border-brand-800 disabled:bg-brand-700/50 disabled:border-transparent',
  secondary:
    'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 hover:border-slate-400 disabled:text-slate-400',
  ghost:
    'bg-transparent text-slate-600 border-transparent hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-400',
  danger:
    'bg-white text-red-700 border-red-300 hover:bg-red-50 hover:border-red-400 disabled:text-red-300',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9.5 px-4 text-sm',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Renders a busy state and blocks interaction. */
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps): ReactNode {
  return (
    <button
      type={type}
      // aria-busy tells assistive technology the control is working, which a
      // spinner alone does not.
      aria-busy={loading || undefined}
      disabled={disabled ?? loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-md border font-medium',
        'transition-colors disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
