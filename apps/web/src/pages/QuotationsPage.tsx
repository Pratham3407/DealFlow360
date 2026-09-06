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

interface KanbanStage {
  id: string;
  label: string;
  statuses: QuotationStatus[];
  badgeClass: string;
}

const KANBAN_STAGES: KanbanStage[] = [
  { id: 'draft', label: 'Draft', statuses: ['DRAFT', 'REVISION_REQUIRED'], badgeClass: 'draft' },
  { id: 'approval', label: 'Pending Approval', statuses: ['PENDING_APPROVAL'], badgeClass: 'pending' },
  { id: 'sent', label: 'Approved & Sent', statuses: ['APPROVED', 'SENT'], badgeClass: 'approved' },
  { id: 'negotiation', label: 'Under Negotiation', statuses: ['UNDER_NEGOTIATION'], badgeClass: 'revision' },
  { id: 'confirmed', label: 'Confirmed (Won)', statuses: ['CONFIRMED'], badgeClass: 'sent' },
  { id: 'fulfillment', label: 'Fulfillment & Closed', statuses: ['FULFILLMENT', 'COMPLETED', 'REJECTED'], badgeClass: 'draft' },
];

const PAGE_SIZE = 25;
const COLUMNS = 8;

export function QuotationsPage({ initialView = 'list' }: { initialView?: 'list' | 'pipeline' }) {
  const [params, setParams] = useSearchParams();
  const currentView = (params.get('view') as 'list' | 'pipeline') || initialView;
  const status = params.get('status') || '';
  const page = Math.max(1, parseInt(params.get('page') || '1', 10));

  const path = useMemo(() => {
    const limit = currentView === 'pipeline' ? '150' : String(PAGE_SIZE);
    const offset = currentView === 'pipeline' ? '0' : String((page - 1) * PAGE_SIZE);
    const qs = new URLSearchParams({ limit, offset });
    if (status) qs.set('status', status);
    return `/api/quotations?${qs}`;
  }, [status, page, currentView]);

  const { data, loading, error, refetch } = useApiQuery<{ data: Quotation[] }>(path);
  const items = data?.data ?? [];

  function setView(view: 'list' | 'pipeline') {
    const next = new URLSearchParams(params);
    next.set('view', view);
    if (view === 'pipeline') next.delete('page');
    setParams(next);
  }

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }

  const filtered = status !== '';

  return (
    <div>
      <div className="row between" style={{ marginBottom: 18, alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>{currentView === 'pipeline' ? 'Deal Pipeline' : 'Quotations'}</h2>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            {currentView === 'pipeline'
              ? 'Kanban deal stages from draft and approvals to negotiation and closed deals.'
              : 'Active, draft and negotiated quotations.'}
          </div>
        </div>
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <div className="view-toggle" role="group" aria-label="Display mode">
            <button
              type="button"
              className={currentView === 'list' ? 'active' : ''}
              onClick={() => setView('list')}
            >
              ≡ List
            </button>
            <button
              type="button"
              className={currentView === 'pipeline' ? 'active' : ''}
              onClick={() => setView('pipeline')}
            >
              ☷ Pipeline
            </button>
          </div>
          <Link to="/quotations/new" className="btn" style={{ textDecoration: 'none' }}>
            + New quotation
          </Link>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div style={{ minWidth: 220 }}>
            <label htmlFor="q-status">Filter by Status</label>
            <select id="q-status" value={status} onChange={(e) => update('status', e.target.value)}>
              <option value="">All statuses</option>
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          {filtered && (
            <button
              type="button"
              className="btn secondary"
              onClick={() => update('status', '')}
            >
              Clear filter
            </button>
          )}
          <div style={{ flex: 1 }} />
          <div className="muted" style={{ fontSize: 12 }}>
            {items.length} quotation{items.length === 1 ? '' : 's'} {currentView === 'list' ? `· page ${page}` : 'in pipeline'}
          </div>
        </div>
      </div>

      {error && <ErrorNotice error={error} />}

      {currentView === 'pipeline' ? (
        <div className="kanban-board">
          {KANBAN_STAGES.map((stage) => {
            const stageQuotes = items.filter((q) => stage.statuses.includes(q.status));
            const stageTotal = stageQuotes.reduce((sum, q) => sum + q.grandTotalPaise, 0);

            return (
              <div className="kanban-column" key={stage.id}>
                <div className="kanban-col-header">
                  <div className="kanban-col-title">
                    <span>{stage.label}</span>
                    <span className="kanban-col-count">{stageQuotes.length}</span>
                  </div>
                  <div className="kanban-col-total">{formatPaise(stageTotal)}</div>
                </div>

                <div className="kanban-cards-list">
                  {stageQuotes.map((q) => (
                    <Link
                      key={q.id}
                      to={`/quotations/${q.id}`}
                      className="kanban-card"
                      title={`Open quotation builder for ${q.quoteNumber}`}
                    >
                      <div className="kanban-card-head">
                        <div className="kanban-card-customer">
                          {q.customer?.name ?? 'Customer'}
                        </div>
                        <span className={`badge ${stage.badgeClass}`} style={{ fontSize: 10 }}>
                          {q.status.replace(/_/g, ' ')}
                        </span>
                      </div>

                      <div className="kanban-card-number">
                        {q.quoteNumber} <span className="muted">· v{q.version}</span>
                      </div>

                      <div className="kanban-card-amount">
                        {formatPaise(q.grandTotalPaise)}
                      </div>

                      <div className="row between" style={{ fontSize: 11 }}>
                        <span className="muted">Margin: <strong>{formatBp(q.marginBp)}</strong></span>
                        <span
                          style={{
                            color: q.riskScoreBp >= 2500 ? 'var(--danger)' : q.riskScoreBp >= 500 ? 'var(--warning)' : 'var(--muted)',
                            fontWeight: q.riskScoreBp >= 500 ? 600 : 400,
                          }}
                        >
                          Risk: {formatBp(q.riskScoreBp)}
                        </span>
                      </div>

                      <div className="kanban-card-footer">
                        <span>{q.customer?.code ?? 'B2B'}</span>
                        <span className="mono">{new Date(q.createdAt).toLocaleDateString()}</span>
                      </div>
                    </Link>
                  ))}

                  {!loading && stageQuotes.length === 0 && (
                    <div className="muted" style={{ fontSize: 12, padding: '16px 8px', textAlign: 'center' }}>
                      No deals in this stage
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Quote</th><th>Customer</th><th>Status</th><th className="num">Ver</th>
                <th className="num">Grand total</th><th className="num">Margin</th>
                <th className="num">Risk</th><th>Approval</th><th>Created</th>
              </tr>
            </thead>
            <tbody>
              {loading && <SkeletonRows columns={COLUMNS + 1} rows={6} />}
              {!loading && items.map((q) => (
                <tr key={q.id}>
                  <td><Link to={`/quotations/${q.id}`}>{q.quoteNumber}</Link></td>
                  <td><strong>{q.customer?.name ?? '—'}</strong></td>
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
            <div className="row between" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-soft)' }}>
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
      )}
    </div>
  );
}