import { Link } from 'react-router-dom';
import { formatPaise, formatBp } from '../api.js';
import { useApiQuery } from '../useApiQuery.js';
import { useAuth } from '../auth-context.js';
import { canAccess } from '../nav.js';
import { Empty, ErrorNotice, Loading } from '../components/States.js';
import { type Quotation, type DealHealthEvent, type ApprovalInstance } from '../types.js';

interface KpiCard {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'warn' | 'danger';
}

/**
 * There is no dedicated KPI endpoint, so the dashboard derives its numbers from
 * the quotation list plus the approval and health feeds.
 */
export function DashboardPage() {
  const { session } = useAuth();
  const all = useApiQuery<{ data: Quotation[] }>('/api/quotations?limit=200');
  const approvals = useApiQuery<{ data: ApprovalInstance[] }>('/api/approvals');
  const health = useApiQuery<{ data: DealHealthEvent[] }>('/api/deal-health');

  const quotes = all.data?.data ?? [];
  const pending = approvals.data?.data ?? [];
  const events = health.data?.data ?? [];

  const OPEN: Quotation['status'][] = [
    'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'UNDER_NEGOTIATION', 'REVISION_REQUIRED',
  ];
  const open = quotes.filter((q) => OPEN.includes(q.status));
  const pipeline = open.reduce((sum, q) => sum + q.grandTotalPaise, 0);
  const avgMargin = quotes.length
    ? Math.round(quotes.reduce((s, q) => s + q.marginBp, 0) / quotes.length)
    : 0;
  const won = quotes.filter(
    (q) => q.status === 'CONFIRMED' || q.status === 'COMPLETED' || q.status === 'FULFILLMENT',
  );
  const wonValue = won.reduce((s, q) => s + q.grandTotalPaise, 0);
  const openHealth = events.filter((e) => !e.resolvedAt);
  const highSeverity = openHealth.filter((e) => e.severity === 'HIGH').length;

  const recent = [...quotes]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 8);

  const cards: KpiCard[] = [
    { label: 'Open pipeline', value: formatPaise(pipeline), hint: `${open.length} live quotation${open.length === 1 ? '' : 's'}` },
    { label: 'Won', value: formatPaise(wonValue), hint: `${won.length} confirmed or shipping` },
    { label: 'Average margin', value: formatBp(avgMargin), hint: `across ${quotes.length} quotation${quotes.length === 1 ? '' : 's'}` },
    {
      label: 'Awaiting approval',
      value: String(pending.length),
      hint: pending.length ? 'reviewer decision outstanding' : 'nothing queued',
      tone: pending.length ? 'warn' : 'default',
    },
    {
      label: 'Health alerts',
      value: String(openHealth.length),
      hint: highSeverity ? `${highSeverity} high severity` : 'none high severity',
      tone: highSeverity ? 'danger' : openHealth.length ? 'warn' : 'default',
    },
    { label: 'Total quotations', value: String(quotes.length), hint: 'all time' },
  ];

  const loading = all.loading || approvals.loading || health.loading;
  const error = all.error ?? approvals.error ?? health.error;

  return (
    <div>
      <div className="row between" style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0 }}>Dashboard</h2>
        <Link to="/quotations/new" className="btn" style={{ textDecoration: 'none' }}>
          New quotation
        </Link>
      </div>

      {error && <ErrorNotice error={error} />}

      <div className="grid grid-3" style={{ marginBottom: 20 }}>
        {cards.map((c) => (
          <div className="card" key={c.label}>
            <div className="kpi-label">{c.label}</div>
            <div
              className="kpi"
              style={{
                color:
                  c.tone === 'danger' ? 'var(--danger)'
                  : c.tone === 'warn' ? 'var(--warning)'
                  : undefined,
              }}
            >
              {loading ? <span className="skeleton" style={{ display: 'block', width: '62%', height: 22, marginTop: 6 }} /> : c.value}
            </div>
            {c.hint && !loading && (
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{c.hint}</div>
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <div className="row between" style={{ marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>Recent activity</h3>
{canAccess(session?.role, '/quotations') && (
            <Link to="/quotations">View all quotations →</Link>
          )}
        </div>
        {loading ? (
          <Loading label="Loading quotations…" />
        ) : recent.length === 0 ? (
          <Empty
            title="No quotations yet"
            hint="Create the first one and it will show up here as it moves through approval."
            action={<Link to="/quotations/new" className="btn" style={{ textDecoration: 'none' }}>New quotation</Link>}
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Quote</th><th>Status</th>
                <th className="num">Total</th><th className="num">Margin</th><th className="num">Risk</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((q) => (
                <tr key={q.id}>
                  <td><Link to={`/quotations/${q.id}`}>{q.quoteNumber}</Link></td>
                  <td><span className={`badge ${q.status.toLowerCase()}`}>{q.status.replace(/_/g, ' ')}</span></td>
                  <td className="num">{formatPaise(q.grandTotalPaise)}</td>
                  <td className="num">{formatBp(q.marginBp)}</td>
                  <td className="num">{formatBp(q.riskScoreBp)}</td>
                  <td className="muted mono">{new Date(q.updatedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {openHealth.length > 0 && (
        <div className="card">
          <div className="row between" style={{ marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Needs attention</h3>
            <Link to="/deal-health">All alerts →</Link>
          </div>
          <table>
            <thead><tr><th>Severity</th><th>Type</th><th>What happened</th></tr></thead>
            <tbody>
              {openHealth.slice(0, 5).map((e) => (
                <tr key={e.id}>
                  <td><span className={`badge ${e.severity.toLowerCase()}`}>{e.severity}</span></td>
                  <td>{e.type.replace(/_/g, ' ')}</td>
                  <td className="muted">{e.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}