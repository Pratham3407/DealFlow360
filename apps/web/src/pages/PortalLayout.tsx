import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth-context.js';
import type { ReactNode } from 'react';

export function PortalLayout({ children }: { children: ReactNode }) {
  const { session, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Customer Portal</h1>
        <nav>
          <Link to="/portal/quotations" className={location.pathname === '/portal/quotations' ? 'active' : ''}>
            My Quotations
          </Link>
        </nav>
        <div className="who">
          <div className="muted">{session?.name} · {session?.role}</div>
          <div className="muted">{session?.email}</div>
          <button className="btn secondary" style={{ marginTop: 8, width: '100%' }} onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="content">
        {children}
      </main>
    </div>
  );
}