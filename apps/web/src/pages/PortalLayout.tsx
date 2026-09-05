import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth-context.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import type { ReactNode } from 'react';

export function PortalLayout({ children }: { children: ReactNode }) {
  const { session, logout } = useAuth();
  const location = useLocation();

  const active = location.pathname.startsWith('/portal/quotations');

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Customer Portal</h1>
        <nav>
          <Link to="/portal/quotations" className={active ? 'active' : ''}>
            My quotations
          </Link>
        </nav>
        <div className="who">
          <div>{session?.name}</div>
          <div className="muted">{session?.email}</div>
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