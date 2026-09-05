import clsx from 'clsx';
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> {
  label: string;
  /** Field-level validation message. Renders and wires up aria-describedby. */
  error?: string | undefined;
  hint?: string | undefined;
}

/**
 * Labelled text input.
 *
 * The label is always a real <label> bound to the input, and the error is linked
 * with aria-describedby, so the failure is announced rather than only coloured.
 */
export function Field({ label, error, hint, ...input }: FieldProps): ReactNode {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={clsx(
          'block h-9.5 w-full rounded-md border bg-white px-3 text-sm text-slate-900',
          'transition-colors placeholder:text-slate-400',
          'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
          error
            ? 'border-red-400 focus:border-red-500'
            : 'border-slate-300 focus:border-brand-600 hover:border-slate-400',
        )}
        {...input}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
