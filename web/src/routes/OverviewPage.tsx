import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ROLE_LABELS } from '../lib/types';
import { INTERNAL_NAV } from '../components/navigation';
import { Badge } from '../components/ui/Badge';
import { ErrorState, Spinner } from '../components/ui/Feedback';
import { DetailRow, PageHeader, Panel } from '../components/ui/Panel';

interface HealthResponse {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  time: string;
}

function PlatformStatus(): ReactNode {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: () => api<HealthResponse>('/health'),
    refetchInterval: 30_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="py-2">
        <Spinner label="Checking services" />
      </div>
    );
  }

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <dl className="divide-y divide-hairline">
      <DetailRow label="API">
        <Badge tone={data?.status === 'ok' ? 'positive' : 'critical'}>
          {data?.status === 'ok' ? 'operational' : 'degraded'}
        </Badge>
      </DetailRow>
      <DetailRow label="Database">
        <Badge tone={data?.database === 'up' ? 'positive' : 'critical'}>
          {data?.database === 'up' ? 'connected' : 'unreachable'}
        </Badge>
      </DetailRow>
      <DetailRow label="Checked at">
        <span className="tabular text-slate-600">
          {data ? new Date(data.time).toLocaleTimeString() : '-'}
        </span>
      </DetailRow>
    </dl>
  );
}

/**
 * Overview.
 *
 * Shows only facts the backend actually supplies - the resolved session, service
 * health, and which modules exist. No invented KPIs: fabricated metrics are
 * explicitly out of bounds (AGENTS.md 27), and real ones arrive with the
 * quotation and reporting slices.
 */
export function OverviewPage(): ReactNode {
  const { profile } = useAuth();

  const modules = INTERNAL_NAV.flatMap((section) =>
    section.items.map((item) => ({ ...item, section: section.label })),
  ).filter((item) => item.to !== '/overview');

  const ready = modules.filter((item) => item.status === 'ready').length;

  return (
    <>
      <PageHeader
        title={`Welcome, ${profile?.name.split(' ')[0] ?? 'there'}`}
        description="Foundation slice: authentication, role-based access and the audit trail are live. Quotation, risk, approval, fulfillment and billing modules follow."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Your session"
          description="Resolved server-side from the session cookie on every request."
        >
          <dl className="divide-y divide-hairline">
            <DetailRow label="Name">{profile?.name}</DetailRow>
            <DetailRow label="Email">{profile?.email}</DetailRow>
            <DetailRow label="Role">
              {profile ? <Badge tone="accent">{ROLE_LABELS[profile.role]}</Badge> : null}
            </DetailRow>
            <DetailRow label="Capabilities">
              <span className="tabular">{profile?.capabilities.length ?? 0} granted</span>
            </DetailRow>
          </dl>
        </Panel>

        <Panel title="Platform status" description="Live check of the API and its database.">
          <PlatformStatus />
        </Panel>
      </div>

      <Panel
        title="Modules"
        description={`${ready} of ${modules.length} implemented. Items marked "soon" are not built yet.`}
        flush
      >
        <ul className="divide-y divide-hairline">
          {modules.map((item) => (
            <li key={item.to} className="flex items-center justify-between gap-4 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-slate-800">{item.label}</p>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">{item.section}</p>
              </div>
              <Badge tone={item.status === 'ready' ? 'positive' : 'neutral'}>
                {item.status === 'ready' ? 'live' : 'planned'}
              </Badge>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Granted capabilities" description="What the server permits this session to do.">
        {profile && profile.capabilities.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {profile.capabilities.map((capability) => (
              <li key={capability}>
                <code className="rounded border border-hairline bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                  {capability}
                </code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-slate-500">No capabilities granted.</p>
        )}
      </Panel>
    </>
  );
}
