import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatPaise, formatBp } from '../api.js';
import { useApiQuery } from '../useApiQuery.js';
import { type Quotation, type QuotationStatus } from '../types.js';

const STATUS_FILTERS: QuotationStatus[] = [
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED',
  'SENT', 'UNDER_NEGOTIATION', 'CONFIRMED', 'FULFILLMENT', 'COMPLETED',
];

const PAGE_SIZE = 25;

export function QuotationsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const page = Math.max(1, parseInt(params.get('page') || '1', 10));

  const path = useMemo(() => {
    const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
    if (status) qs.set('status', status);
    return `/api/quotations?${qs}`;
  }, [status, page]);

  const { data, loading, error } = useApiQuery<{ data: Quotation[] }>(path);
  const items = data?.data ?? [];

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }

  return (
    <div>
      <div className="row between" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Quotations</h2>
        <Link to="/quotations/new" className="btn" style={{ textDecoration: 'none' }}>+ New Quotation</Link>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 12 }}>
          <select value={status} onChange={e => update('status', e.target.value)} style={{ width: 240 }}>
            <option value="">All statuses</option>
            {STATUS_FILTERS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="error">{error.code}: {error.message}</div>}

      <div className="card">
        <table>
          <thead><tr><th>#</th><th>Status</th><th>Ver</th><th>Grand Total</th><th>Margin</th><th>Risk</th><th>Approval</th><th>Created</th></tr></thead>
          <tbody>
            {items.map(q => (
              <tr key={q.id}>
                <td><Link to={`/quotations/${q.id}`}>{q.quoteNumber}</Link></td>
                <td><span className={`badge ${q.status.toLowerCase()}`}>{q.status}</span></td>
                <td>{q.version}</td>
                <td>{formatPaise(q.grandTotalPaise)}</td>
                <td>{formatBp(q.marginBp)}</td>
                <td>{formatBp(q.riskScoreBp)}</td>
                <td className="muted">{q.requiredApprovalLevel}</td>
                <td className="muted mono">{new Date(q.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && !loading && <div className="muted">No quotations found.</div>}
        {loading && <div className="muted">Loading…</div>}
        <div className="row between" style={{ marginTop: 12 }}>
          <div className="muted">Showing {items.length} · page {page}</div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn secondary" disabled={page <= 1} onClick={() => update('page', String(page - 1))}>Prev</button>
            <button className="btn secondary" disabled={items.length < PAGE_SIZE} onClick={() => update('page', String(page + 1))}>Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}