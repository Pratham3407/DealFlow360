import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Alert } from '../components/ui/Feedback';
import { Button } from '../components/ui/Button';
import { DetailRow, Panel } from '../components/ui/Panel';

/**
 * Customer portal shell and landing page.
 *
 * Deliberately not the internal AppShell: the portal is a genuinely separate,
 * restricted experience, not the workspace with a different label
 * (docs/PRD.md 15, AGENTS.md 12). It carries no internal navigation, and the
 * server withholds margin, risk configuration and approval notes from customer
 * sessions regardless of what this page asks for.
 */
export function PortalHomePage(): ReactNode {
  const { profile, logout, isLoggingOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut(): Promise<void> {
    await logout();
    void navigate('/portal/login', { replace: true });
  }

  return (
    <div className="min-h-full bg-canvas">
      <header className="border-b border-hairline bg-surface">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-3 px-4 sm:px-6">
          <span className="text-sm font-semibold tracking-tight text-slate-900">DealFlow360</span>
          <span className="text-[13px] text-slate-400">|</span>
          <span className="text-[13px] text-slate-600">Customer portal</span>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-[13px] text-slate-600 sm:inline">
              {profile?.customerName}
            </span>
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
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Your quotations</h1>
          <p className="mt-1 text-sm text-slate-600">
            Review quotations, ask line-level questions, propose changes and confirm final terms.
          </p>
        </div>

        <Panel>
          <Alert tone="info" title="Quotations are not available yet">
            Quotation delivery and negotiation arrive with a later slice. Your account and its
            isolation are already in place: this portal can only ever show data belonging to{' '}
            <strong>{profile?.customerName}</strong>.
          </Alert>
        </Panel>

        <Panel title="Your account">
          <dl className="divide-y divide-hairline">
            <DetailRow label="Contact">{profile?.name}</DetailRow>
            <DetailRow label="Email">{profile?.email}</DetailRow>
            <DetailRow label="Organisation">{profile?.customerName}</DetailRow>
          </dl>
        </Panel>
      </main>
    </div>
  );
}
