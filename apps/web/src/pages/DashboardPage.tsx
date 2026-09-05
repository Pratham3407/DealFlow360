import { Link } from 'react-router-dom';
import { formatBp, formatPaise } from '../api.js';
import { useApiQuery } from '../useApiQuery.js';
import { type Quotation, type DealHealthEvent, type ApprovalInstance } from '../types.js';

/**
 * There is no dedicated KPI endpoint, so the dashboard derives its numbers from
 * the quotation list plus the approval and health feeds.
 */
export function DashboardPage() {
  const all = useApiQuery<{ data: Quotation[] }>('/api/quotations?limit=200');
  const approvals = useApiQuery<{ data: ApprovalInstance[] }>('/api/approvals');
  const health = useApiQuery<{ data: DealHealthEvent[] }>('/api/deal-health');

  const quotes = all.data?.data ?? [];
  const pending = approvals.data?.data ?? [];
  const events = health.data?.data ?? [];

  const OPEN: Quotation['status'][] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'UNDER_NEGOTIATION', 'REVISION_REQUIRED'];
  const open = quotes.filter(q => OPEN.includes(q.status));
  const pipeline = open.reduce((sum, q) => sum + q.grandTotalPaise, 0);
  const avgMargin = quotes.length ? Math.round(quotes.reduce((s, q) => s + q.marginBp, 0) / quotes.length) : 0;
  const won = quotes.filter(q => q.status === 'CONFIRMED' || q.status === 'COMPLETED' || q.status === 'FULFILLMENT');
  const openHealth = events.filter(e => !e.resolvedAt);

  const recent = [...quotes].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 8);

  return (
    <div>
      <h2>Dashboard</h2>

      <div className="grid grid-3" style={{ marginBottom: 24 }}>
        <div className="card"><div className="kpi-label">Total Quotations</div><div className="kpi">{quotes.length}</div></div>
        <div className="card"><div className="kpi-label">Open Deals</div><div className="kpi">{open.length}</div></div>
        <div className="card"><div className="kpi-label">Open Pipeline</div><div className="kpi">{formatPaise(pipeline)}</div></div>
        <div className="card"><div className="kpi-label">Pending Approvals</div><div className="kpi">{pending.length}</div></div>
        <div className="card"><div className="kpi-label">Avg Margin</div><div className="kpi">{formatBp(avgMargin)}</div></div>
        <div className="card"><div className="kpi-label">Open Health Alerts</div><div className="kpi" style={{ color: openHealth.length ? 'var(--warning)' : undefined }}>{openHealth.length}</div></div>
      </div>

      <div className="card">
        <div className="row between" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Recent Activity</h3>
          <Link to="/quotations">View all</Link>
        </div>
        <table>
          <thead><tr><th>#</th><th>Status</th><th>Grand Total</th><th>Margin</th><th>Risk</th><th>Updated</th></tr></thead>
          <tbody>
            {recent.map(q => (
              <tr key={q.id}>
                <td><Link to={`/quotations/${q.id}`}>{q.quoteNumber}</Link></td>
                <td><span className={`badge ${q.status.toLowerCase()}`}>{q.status}</span></td>
                <td>{formatPaise(q.grandTotalPaise)}</td>
                <td>{formatBp(q.marginBp)}</td>
                <td>{formatBp(q.riskScoreBp)}</td>
                <td className="muted mono">{new Date(q.updatedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {recent.length === 0 && !all.loading && <div className="muted">No quotations yet.</div>}
        {all.loading && <div className="muted">Loading…</div>}
      </div>

      {openHealth.length > 0 && (
        <div className="card">
          <div className="row between" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Needs Attention</h3>
            <Link to="/deal-health">All alerts</Link>
          </div>
          <table>
            <thead><tr><th>Severity</th><th>Type</th><th>Title</th></tr></thead>
            <tbody>
              {openHealth.slice(0, 5).map(e => (
                <tr key={e.id}>
                  <td><span className={`badge ${e.severity === 'HIGH' ? 'rejected' : e.severity === 'MEDIUM' ? 'revision' : 'draft'}`}>{e.severity}</span></td>
                  <td>{e.type}</td>
                  <td className="muted">{e.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="kpi-label">Won (confirmed / fulfilling / completed)</div>
        <div className="kpi">{won.length} · {formatPaise(won.reduce((s, q) => s + q.grandTotalPaise, 0))}</div>
      </div>
    </div>
  );
}