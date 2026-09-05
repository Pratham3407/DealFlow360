/**
 * Theme: light, dark, or follow the operating system.
 *
 * The choice is written to `data-theme` on `<html>` rather than swapping a
 * stylesheet, so every token flips at once and nothing flashes. The preference is
 * persisted; "system" stays live, tracking the OS if it changes while the tab is
 * open.
 *
 * `applyStoredTheme` runs from `main.tsx` before React mounts so the first paint
 * is already in the right theme — otherwise a dark-mode user gets a white flash.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'dealflow.theme';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

export function readStoredChoice(): ThemeChoice {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

function resolve(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return choice;
}

function paint(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  // Keep native form controls and scrollbars in step with the page.
  root.style.colorScheme = theme;
}

/** Called before React mounts, so the first frame is already correct. */
export function applyStoredTheme(): void {
  try {
    paint(resolve(readStoredChoice()));
  } catch {
    paint('light');
  }
}

interface ThemeContextValue {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice: (next: ThemeChoice) => void;
}

const Context = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => readStoredChoice());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(readStoredChoice()));

  const setChoice = useCallback((next: ThemeChoice) => {
    localStorage.setItem(STORAGE_KEY, next);
    setChoiceState(next);
    const r = resolve(next);
    setResolved(r);
    paint(r);
  }, []);

  // Only while following the system: react to the OS switching under us.
  useEffect(() => {
    if (choice !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const r: ResolvedTheme = mq.matches ? 'dark' : 'light';
      setResolved(r);
      paint(r);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [choice]);

  return (
    <Context.Provider value={{ choice, resolved, setChoice }}>{children}</Context.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
