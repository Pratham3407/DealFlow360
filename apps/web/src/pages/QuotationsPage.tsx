import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatPaise, formatBp } from '../api.js';
import { useApiQuery } from '../useApiQuery.js';
import { Empty, ErrorNotice, SkeletonRows } from '../components/States.js';
import { type Quotation, type QuotationStatus } from '../types.js';

const STATUS_FILTERS: QuotationStatus[] = [
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED',
  'SENT', 'UNDER_NEGOTIATION', 'CONFIRMED', 'FULFILLMENT', 'COMPLETED',
];

const PAGE_SIZE = 25;
const COLUMNS = 8;

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

  const filtered = status !== '';

  return (
    <div>
      <div className="row between" style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0 }}>Quotations</h2>
        <Link to="/quotations/new" className="btn" style={{ textDecoration: 'none' }}>
          New quotation
        </Link>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 10 }}>
          <div style={{ minWidth: 220 }}>
            <label htmlFor="q-status">Status</label>
            <select id="q-status" value={status} onChange={(e) => update('status', e.target.value)}>
              <option value="">All statuses</option>
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          {filtered && (
            <button
              className="btn secondary"
              style={{ alignSelf: 'flex-end' }}
              onClick={() => update('status', '')}
            >
              Clear filter
            </button>
          )}
          <div style={{ flex: 1 }} />
          <div className="muted" style={{ fontSize: 12, alignSelf: 'flex-end' }}>
            Showing {items.length} · page {page}
          </div>
        </div>
      </div>

      {error && <ErrorNotice error={error} />}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Quote</th><th>Status</th><th className="num">Ver</th>
              <th className="num">Grand total</th><th className="num">Margin</th>
              <th className="num">Risk</th><th>Approval</th><th>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && <SkeletonRows columns={COLUMNS} rows={6} />}
            {!loading && items.map((q) => (
              <tr key={q.id}>
                <td><Link to={`/quotations/${q.id}`}>{q.quoteNumber}</Link></td>
                <td><span className={`badge ${q.status.toLowerCase()}`}>{q.status.replace(/_/g, ' ')}</span></td>
                <td className="num muted">v{q.version}</td>
                <td className="num">{formatPaise(q.grandTotalPaise)}</td>
                <td className="num">{formatBp(q.marginBp)}</td>
                <td
                  className="num"
                  style={{ color: q.riskScoreBp >= 2500 ? 'var(--danger)' : q.riskScoreBp >= 500 ? 'var(--warning)' : undefined }}
                >
                  {formatBp(q.riskScoreBp)}
                </td>
                <td className="muted">
                  {q.requiredApprovalLevel === 'NONE' ? 'Not required'
                    : q.requiredApprovalLevel === 'MANAGER' ? 'Manager'
                    : 'Manager + Finance'}
                </td>
                <td className="muted mono">{new Date(q.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && items.length === 0 && (
          <Empty
            title={filtered ? 'No quotations in that status' : 'No quotations yet'}
            hint={
              filtered
                ? 'Try clearing the filter to see the rest of the book.'
                : 'Create the first quotation to get started.'
            }
            action={
              filtered
                ? <button className="btn secondary" onClick={() => update('status', '')}>Clear filter</button>
                : <Link to="/quotations/new" className="btn" style={{ textDecoration: 'none' }}>New quotation</Link>
            }
          />
        )}

        {(items.length > 0 || page > 1) && (
          <div className="row between" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--slate-100)' }}>
            <div className="muted" style={{ fontSize: 12 }}>Page {page}</div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn secondary" disabled={page <= 1} onClick={() => update('page', String(page - 1))}>
                Previous
              </button>
              <button
                className="btn secondary"
                disabled={items.length < PAGE_SIZE}
                onClick={() => update('page', String(page + 1))}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}