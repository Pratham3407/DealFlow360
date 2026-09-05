/**
 * Theme switch: sun / moon / auto.
 *
 * Three states rather than a binary toggle, because "follow the system" is a real
 * preference and a two-way switch silently loses it.
 */

import type { ReactElement } from 'react';
import { useTheme, type ThemeChoice } from '../theme.js';

const OPTIONS: Array<{ value: ThemeChoice; label: string; icon: ReactElement }> = [
  {
    value: 'light',
    label: 'Light',
    icon: (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="8" cy="8" r="3.1" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
          <path d="M8 1.4v1.7M8 12.9v1.7M1.4 8h1.7M12.9 8h1.7" />
          <path d="M3.3 3.3l1.2 1.2M11.5 11.5l1.2 1.2M12.7 3.3l-1.2 1.2M4.5 11.5l-1.2 1.2" />
        </g>
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          d="M13.2 10.1A5.6 5.6 0 0 1 6 2.85a5.85 5.85 0 1 0 7.2 7.25Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    value: 'system',
    label: 'System',
    icon: (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <rect x="1.8" y="2.6" width="12.4" height="8.4" rx="1.4"
          fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5.6 13.4h4.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
];

export function ThemeToggle() {
  const { choice, setChoice } = useTheme();

  return (
    <div className="theme-switch" role="group" aria-label="Colour theme">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.label}
          aria-label={o.label}
          aria-pressed={choice === o.value}
          className={choice === o.value ? 'is-active' : ''}
          onClick={() => setChoice(o.value)}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
