// @vitest-environment jsdom

/**
 * Mounts the whole application once per route.
 *
 * A blank page is a module- or render-time throw, and every other gate in this
 * repo misses it: typecheck sees valid types, the build only bundles, and the nav
 * tests exercise a pure function. This actually renders each screen and fails on
 * the first exception, so a crash cannot reach the browser unnoticed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../src/App.js';
import { AppErrorBoundary } from '../src/components/AppErrorBoundary.js';
import { ThemeProvider, applyStoredTheme } from '../src/theme.js';

const ROUTES = [
  '/login', '/register', '/portal/enter',
  '/', '/dashboard', '/quotations', '/pipeline', '/quotations/new', '/approvals',
  '/fulfillment', '/billing', '/customers', '/catalog',
  '/deal-health', '/reports', '/governance', '/users', '/settings',
];

const ADMIN_SESSION = {
  token: 'test-token',
  userId: '00000000-0000-0000-0000-000000000001',
  role: 'ADMIN',
  email: 'admin@dealflow.local',
  name: 'Admin User',
  customerId: null,
};

const CUSTOMER_SESSION = {
  ...ADMIN_SESSION,
  role: 'CUSTOMER',
  email: 'buyer@acme.local',
  name: 'Riya Sharma',
  customerId: '00000000-0000-0000-0000-000000000009',
};

/** An empty but well-shaped payload for every endpoint the screens call. */
const EMPTY_PAYLOAD = {
  data: [],
  quote: null,
  fulfillment: null,
  invoices: [],
  subscriptions: [],
  events: [],
  approval: null,
  user: null,
};

let root: Root | null = null;
let container: HTMLElement;
let consoleErrors: string[] = [];

beforeEach(() => {
  // React only permits act() when the environment opts in.
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');

  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root')!;

  // jsdom has no matchMedia; the theme module asks it for the OS preference.
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: () => ({
        matches: false,
        media: '',
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
  }

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(EMPTY_PAYLOAD), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })),
  );

  consoleErrors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '));
  });
});

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = null;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mountAt(path: string, session: object) {
  window.localStorage.setItem('dealflow.session', JSON.stringify(session));
  window.history.replaceState({}, '', path);
  applyStoredTheme();

  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(AppErrorBoundary, null, createElement(ThemeProvider, null, createElement(App))),
    );
  });
}

/** React logs a render throw through console.error; anything else is noise. */
function fatalErrors(): string[] {
  return consoleErrors.filter(
    (e) => !e.includes('not wrapped in act') && !e.startsWith('Warning:'),
  );
}

describe('workspace routes mount', () => {
  for (const route of ROUTES) {
    it(`renders ${route}`, async () => {
      await mountAt(route, ADMIN_SESSION);
      expect(container.innerHTML.length, `${route} rendered nothing`).toBeGreaterThan(0);
      expect(fatalErrors(), `error while rendering ${route}`).toEqual([]);
    });
  }
});

describe('portal routes mount', () => {
  it('renders /portal/quotations', async () => {
    await mountAt('/portal/quotations', CUSTOMER_SESSION);
    expect(container.innerHTML.length).toBeGreaterThan(0);
    expect(fatalErrors()).toEqual([]);
  });
});

describe('unauthenticated entry', () => {
  it('renders the sign-in screen with no session', async () => {
    window.history.replaceState({}, '', '/login');
    applyStoredTheme();
    root = createRoot(container);
    await act(async () => {
      root!.render(createElement(ThemeProvider, null, createElement(App)));
    });
    expect(container.textContent).toContain('Sign in');
    expect(fatalErrors()).toEqual([]);
  });
});

describe('error boundary', () => {
  it('shows a message instead of a blank document when a screen throws', async () => {
    function Exploding(): never {
      throw new Error('deliberate test failure');
    }

    root = createRoot(container);
    await act(async () => {
      root!.render(createElement(AppErrorBoundary, null, createElement(Exploding)));
    });

    // The whole point: something is still on screen, and it names the failure.
    expect(container.textContent).toContain('Something broke');
    expect(container.textContent).toContain('deliberate test failure');
    // The boundary reports through console.error on purpose.
    expect(consoleErrors.some((e) => e.includes('Unhandled render error'))).toBe(true);
  });
});

describe('theme switch', () => {
  async function mountToggle() {
    const { ThemeToggle } = await import('../src/components/ThemeToggle.js');
    root = createRoot(container);
    await act(async () => {
      root!.render(createElement(ThemeProvider, null, createElement(ThemeToggle)));
    });
    return Array.from(container.querySelectorAll('button'));
  }

  it('offers light and dark only', async () => {
    const buttons = await mountToggle();
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Light theme', 'Dark theme']);
  });

  it('marks the resolved theme active even before a choice is stored', async () => {
    // Nothing in localStorage means the stored choice is 'system'; the control must
    // still show which theme is actually in effect.
    const buttons = await mountToggle();
    const pressed = buttons.filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    expect(pressed[0]!.getAttribute('aria-label')).toBe('Light theme');
  });

  it('switches the document theme when clicked', async () => {
    const buttons = await mountToggle();
    await act(async () => {
      buttons[1]!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('dealflow.theme')).toBe('dark');
  });
});

describe('theme', () => {
  it('paints light onto <html> by default', () => {
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('honours a stored dark preference', () => {
    window.localStorage.setItem('dealflow.theme', 'dark');
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('falls back to light when the stored value is nonsense', () => {
    window.localStorage.setItem('dealflow.theme', 'chartreuse');
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
