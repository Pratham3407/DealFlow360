import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth-context.js';
import { navFor, isReadOnly } from '../nav.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import type { ReactNode } from 'react';

const ROLE_LABEL: Record<string, string> = {
  SALES_REP: 'Sales Rep',
  SALES_MANAGER: 'Sales Manager',
  FINANCE_OPERATIONS: 'Finance Operations',
  ADMIN: 'Admin',
};

export function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { session, logout } = useAuth();
  const location = useLocation();

  // Only the areas this role can actually use — see nav.ts for the rationale.
  const items = navFor(session?.role);

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>DealFlow360</h1>
        <nav>
          {items.map((item) => {
            const active = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
            const readOnly = isReadOnly(session?.role, item.path);
            return (
              <Link key={item.path} to={item.path} className={active ? 'active' : ''}>
                {item.label}
                {readOnly && <span className="nav-tag">view</span>}
              </Link>
            );
          })}
        </nav>
        <div className="who">
          <div>{session?.name}</div>
          <div className="muted">{ROLE_LABEL[session?.role ?? ''] ?? session?.role}</div>
          <ThemeToggle />
          <button className="btn secondary" style={{ marginTop: 8, width: '100%' }} onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}