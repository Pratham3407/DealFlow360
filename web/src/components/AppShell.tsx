import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { LogOut, Menu, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { ROLE_LABELS } from '../lib/types';
import { visibleSections } from './navigation';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';

function NavItems({ onNavigate }: { onNavigate?: () => void }): ReactNode {
  const { can } = useAuth();
  const sections = visibleSections(can);

  return (
    <nav aria-label="Workspace" className="space-y-6 px-3 py-4">
      {sections.map((section) => (
        <div key={section.label}>
          <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {section.label}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors',
                      isActive
                        ? 'bg-sidebar-hover font-semibold text-white'
                        : 'text-slate-300 hover:bg-sidebar-hover hover:text-white',
                    )
                  }
                >
                  <span className="truncate">{item.label}</span>
                  {item.status === 'planned' ? (
                    <span
                      title="Not implemented yet"
                      className="shrink-0 rounded border border-slate-600 px-1 text-[10px] font-semibold uppercase text-slate-400"
                    >
                      soon
                    </span>
                  ) : null}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * Internal workspace chrome: persistent sidebar on large screens, a drawer
 * below that. The customer portal deliberately does not reuse this shell - it is
 * a separate, narrower experience (docs/PRD.md 15).
 */
export function AppShell(): ReactNode {
  const { profile, logout, isLoggingOut } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function handleSignOut(): Promise<void> {
    await logout();
    void navigate('/login', { replace: true });
  }

  return (
    <div className="flex h-full">
      {/* Persistent sidebar, large screens up. */}
      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar lg:flex">
        <div className="flex h-14 items-center border-b border-white/10 px-4">
          <span className="text-sm font-semibold tracking-tight text-white">DealFlow360</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NavItems />
        </div>
      </aside>

      {/* Drawer, below large screens. */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-slate-900/50"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-sidebar shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
              <span className="text-sm font-semibold text-white">DealFlow360</span>
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setDrawerOpen(false)}
                className="rounded p-1 text-slate-300 hover:bg-sidebar-hover hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <NavItems onNavigate={() => setDrawerOpen(false)} />
            </div>
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-hairline bg-surface px-4">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setDrawerOpen(true)}
            className="rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
          >
            <Menu className="size-5" />
          </button>

          <span className="text-sm font-semibold text-slate-900 lg:hidden">DealFlow360</span>

          <div className="ml-auto flex items-center gap-3">
            {profile ? (
              <div className="hidden text-right sm:block">
                <p className="text-[13px] font-medium leading-tight text-slate-900">
                  {profile.name}
                </p>
                <p className="text-[11px] leading-tight text-slate-500">{profile.email}</p>
              </div>
            ) : null}
            {profile ? <Badge tone="accent">{ROLE_LABELS[profile.role]}</Badge> : null}
            <Button
              size="sm"
              variant="ghost"
              icon={<LogOut className="size-3.5" />}
              loading={isLoggingOut}
              onClick={() => void handleSignOut()}
            >
              Sign out
            </Button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
