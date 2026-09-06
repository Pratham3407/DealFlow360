import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth-context.js';
import { navFor, isReadOnly } from '../nav.js';
import { ThemeToggle } from '../components/ThemeToggle.js';

const ROLE_LABEL: Record<string, string> = {
  SALES_REP: 'Sales Rep',
  SALES_MANAGER: 'Sales Manager',
  FINANCE_OPERATIONS: 'Finance Operations',
  ADMIN: 'Admin',
};

export function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { session, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [reloading, setReloading] = useState(false);
  const [reloadNotice, setReloadNotice] = useState<string | null>(null);

  // Only the areas this role can actually use — see nav.ts for the rationale.
  const items = navFor(session?.role);
  const canAccessBackend = session?.role === 'ADMIN' || session?.role === 'SALES_MANAGER';

  function handleReloadData() {
    setReloading(true);
    setReloadNotice('Refreshed pricing, stock, and approval data');
    window.dispatchEvent(new CustomEvent('dealflow:reload-data'));
    setTimeout(() => {
      setReloading(false);
    }, 500);
    setTimeout(() => {
      setReloadNotice(null);
    }, 2800);
  }

  function handleCloseWorkspace() {
    logout();
    navigate('/login', { replace: true });
  }

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
          <button className="btn secondary" style={{ marginTop: 8, width: '100%' }} onClick={handleCloseWorkspace}>
            Close Workspace
          </button>
        </div>
      </aside>
      <main className="content">
        <header className="workspace-top-bar">
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="badge approved">{ROLE_LABEL[session?.role ?? ''] ?? session?.role}</span>
            <span className="muted" style={{ fontSize: 13 }}>Sales Operations Platform</span>
            {reloadNotice && (
              <span className="badge" style={{ background: 'var(--ok-bg)', color: 'var(--ok-fg)', border: '1px solid var(--ok-line)' }}>
                ✓ {reloadNotice}
              </span>
            )}
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn secondary"
              style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={handleReloadData}
              disabled={reloading}
              title="Refreshes pricing, stock, and approval data from backend"
            >
              {reloading ? '↻ Reloading…' : '↻ Reload Data'}
            </button>
            {canAccessBackend && (
              <Link
                to="/settings"
                className="btn secondary"
                style={{ fontSize: 12, padding: '4px 10px', textDecoration: 'none' }}
                title="Opens configuration and settings screen"
              >
                ⚙ Go to Back-end
              </Link>
            )}
            <button
              type="button"
              className="btn secondary"
              style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={handleCloseWorkspace}
              title="Ends current working session view"
            >
              ⏻ Close Workspace
            </button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}