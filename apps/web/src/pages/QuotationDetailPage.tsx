import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatPaise, formatBp, percentToBp, toApiError, type ApiError } from '../api.js';
import { useAuth } from '../auth-context.js';
import { useApiQuery } from '../useApiQuery.js';
import { ErrorNotice, Empty, Loading } from '../components/States.js';
import {
  type Quotation, type QuotationLine, type ApprovalInstance,
  type Customer, type AuditEntry, type Product,
} from '../types.js';

type QuoteDetail = Quotation & {
  lines: QuotationLine[];
  customer: Customer | null;
  salesRep: { id: string; name: string; email: string } | null;
  approvals: ApprovalInstance[];
  negotiations: NegotiationRequest[];
};

interface NegotiationRequest {
  id: string;
  quotationVersion: number;
  requestType: 'QUESTION' | 'DISCOUNT_COUNTER' | 'QUANTITY_CHANGE' | 'LINE_REMOVAL';
  status: string;
  lineId: string | null;
  proposedDiscountBp: number | null;
  proposedQuantity: number | null;
  comment: string | null;
  resultingVersion: number | null;
  createdAt: string;
}

interface Recommendation {
  productId: string; productName: string; productSku: string; categoryName: string;
  unitPricePaise: number; marginBp: number; marginPaise: number;
  score: number; promotion?: string | null;
}

/** Statuses where the rep may still change lines and discounts. */
const EDITABLE: Quotation['status'][] = ['DRAFT', 'REVISION_REQUIRED'];
const AUTHOR_ROLES = ['SALES_REP', 'SALES_MANAGER', 'ADMIN'];

export function QuotationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  const quote = useApiQuery<{ quote: QuoteDetail }>(id ? `/api/quotations/${id}` : null);
  const audit = useApiQuery<{ data: AuditEntry[] }>(id ? `/api/quotations/${id}/audit?limit=30` : null);
  const recs = useApiQuery<{ data: Recommendation[] }>(id ? `/api/quotations/${id}/recommendations` : null);

  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function reload() {
    quote.refetch();
    audit.refetch();
    recs.refetch();
  }

  async function act(label: string, path: string, method: 'POST' | 'PATCH' | 'DELETE' = 'POST', body?: unknown) {
    if (!id) return;
    setBusy(label);
    setError(null);
    try {
      await api(path, { method, body });
      reload();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(null);
    }
  }

  if (quote.error) return <ErrorNotice error={quote.error} />;
  if (quote.loading || !quote.data) return <Loading />;

  const q = quote.data.quote;
  const lines = q.lines ?? [];
  const approvals = q.approvals ?? [];
  const negotiations = q.negotiations ?? [];
  const canEdit = EDITABLE.includes(q.status) && AUTHOR_ROLES.includes(session?.role ?? '');
  const canAuthor = AUTHOR_ROLES.includes(session?.role ?? '');
  const openRequests = negotiations.filter(n => n.status === 'SUBMITTED');

  return (
    <div>
      <Link to="/quotations" className="muted">← Back to quotations</Link>

      <div className="row between" style={{ marginTop: 8, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: '4px 0' }}>
            {q.quoteNumber} <span className={`badge ${q.status.toLowerCase()}`}>{q.status}</span>
          </h2>
          <div className="muted">{q.customer?.name ?? '—'} · v{q.version} · rep {q.salesRep?.name ?? '—'}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {canEdit && (
            <button className="btn secondary" disabled={busy !== null} onClick={() => act('recalc', `/api/quotations/${q.id}/recalculate`)}>
              {busy === 'recalc' ? 'Recalculating…' : 'Recalculate'}
            </button>
          )}
          {canEdit && (
            <button disabled={busy !== null || lines.length === 0} title={lines.length === 0 ? 'Add at least one line first' : undefined}
              onClick={() => act('confirm', `/api/quotations/${q.id}/confirm`)}>
              {busy === 'confirm' ? 'Submitting…' : 'Submit for approval'}
            </button>
          )}
          {q.status === 'APPROVED' && canAuthor && (
            <button disabled={busy !== null} onClick={() => act('send', `/api/quotations/${q.id}/send`)}>
              {busy === 'send' ? 'Sending…' : 'Send to customer'}
            </button>
          )}
        </div>
      </div>

      {error && <ErrorNotice error={error} />}

      {q.status === 'PENDING_APPROVAL' && (
        <div className="card" style={{ borderColor: 'var(--warning)' }}>
          <strong>Awaiting approval.</strong>{' '}
          <span className="muted">Reviewers act from the <Link to="/approvals">Approvals queue</Link>. Lines are locked until a decision is made.</span>
        </div>
      )}

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="card"><div className="kpi-label">Subtotal</div><div className="kpi">{formatPaise(q.subtotalPaise)}</div></div>
        <div className="card"><div className="kpi-label">Discount</div><div className="kpi">{formatPaise(q.discountTotalPaise)}</div></div>
        <div className="card"><div className="kpi-label">Tax</div><div className="kpi">{formatPaise(q.taxTotalPaise)}</div></div>
        <div className="card"><div className="kpi-label">Grand Total</div><div className="kpi">{formatPaise(q.grandTotalPaise)}</div></div>
        <div className="card"><div className="kpi-label">Margin</div><div className="kpi">{formatBp(q.marginBp)}</div><div className="muted">{formatPaise(q.marginPaise)}</div></div>
        <div className="card"><div className="kpi-label">Risk / Approval</div><div className="kpi">{formatBp(q.riskScoreBp)}</div><div className="muted">{q.requiredApprovalLevel}</div></div>
      </div>

      {canEdit && <OrderDiscountCard quote={q} busy={busy} onSave={bp => act('discount', `/api/quotations/${q.id}`, 'PATCH', { orderDiscountBp: bp })} />}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Lines ({lines.length})</h3>
        <table>
          <thead>
            <tr>
              <th>Product</th><th className="num">Qty</th><th className="num">List</th>
              <th className="num">Unit</th><th className="num">Disc</th>
              <th className="num">Ceiling</th><th className="num">Line total</th>{canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {lines.map(l => (
              <LineRow key={l.id} line={l} quoteId={q.id} canEdit={canEdit} busy={busy} onAct={act} />
            ))}
          </tbody>
        </table>
        {lines.length === 0 && <Empty title="No lines yet" hint="Add a product below and pricing, ceilings and risk are recalculated straight away." />}
      </div>

      {canEdit && <AddLineCard quoteId={q.id} busy={busy} onAct={act} />}

      {canEdit && recs.data && recs.data.data.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Recommended add-ons</h3>
          <table>
            <thead><tr><th>Product</th><th>Category</th><th className="num">Unit price</th><th className="num">Margin</th><th>Promotion</th><th /></tr></thead>
            <tbody>
              {recs.data.data.map(r => (
                <tr key={r.productId}>
                  <td>{r.productName} <span className="muted mono">{r.productSku}</span></td>
                  <td className="muted">{r.categoryName}</td>
                  <td className="num">{formatPaise(r.unitPricePaise)}</td>
                  <td className="num">{formatBp(r.marginBp)}</td>
                  <td className="muted">{r.promotion ?? '—'}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <button disabled={busy !== null}
                        onClick={() => act(`rec-add-${r.productId}`, `/api/quotations/${q.id}/recommendations/${r.productId}/add`, 'POST', { quantity: 1 })}>
                        Add
                      </button>
                      <button className="btn secondary" disabled={busy !== null}
                        onClick={() => act(`rec-dis-${r.productId}`, `/api/quotations/${q.id}/recommendations/${r.productId}/dismiss`, 'POST', {})}>
                        Dismiss
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {negotiations.length > 0 && (
        <div className="card" style={openRequests.length > 0 ? { borderColor: 'var(--accent)' } : undefined}>
          <h3 style={{ marginTop: 0 }}>
            Customer Requests
            {openRequests.length > 0 && <span className="muted" style={{ fontWeight: 400 }}> · {openRequests.length} awaiting your action</span>}
          </h3>
          <table>
            <thead>
              <tr>
                <th>Submitted</th><th>Type</th><th>Line</th><th className="num">Proposed</th>
                <th className="num">Ver</th><th>Status</th><th>Comment</th>{canAuthor && <th />}
              </tr>
            </thead>
            <tbody>
              {negotiations.map(n => {
                const line = lines.find(l => l.id === n.lineId);
                const stale = n.quotationVersion !== q.version;
                return (
                  <tr key={n.id}>
                    <td className="muted mono">{new Date(n.createdAt).toLocaleString()}</td>
                    <td>{n.requestType.replace(/_/g, ' ')}</td>
                    <td className="muted">{line ? line.productName : n.lineId ? '(removed line)' : '—'}</td>
                    <td>
                      {n.proposedDiscountBp !== null ? formatBp(n.proposedDiscountBp)
                        : n.proposedQuantity !== null ? `qty ${n.proposedQuantity}`
                        : '—'}
                    </td>
                    <td className="muted">v{n.quotationVersion}</td>
                    <td>
                      <span className={`badge ${n.status === 'APPLIED' ? 'approved' : n.status === 'REJECTED' ? 'rejected' : n.status === 'SUBMITTED' ? 'pending' : 'draft'}`}>
                        {n.status}
                      </span>
                      {n.resultingVersion !== null && <span className="muted"> → v{n.resultingVersion}</span>}
                    </td>
                    <td className="muted">{n.comment ?? '—'}</td>
                    {canAuthor && (
                      <td>
                        {n.status === 'SUBMITTED' && (
                          <button
                            disabled={busy !== null || stale}
                            title={stale ? `Request targets v${n.quotationVersion}; quote is at v${q.version}` : 'Apply to a new version and re-score risk'}
                            onClick={() => act(`neg-${n.id}`, `/api/quotations/${q.id}/negotiations/${n.id}/apply`)}
                          >
                            {busy === `neg-${n.id}` ? 'Applying…' : 'Apply'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {openRequests.length > 0 && (
            <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              Applying writes the customer's terms onto the line, bumps the version and re-runs the risk engine.
              If the new risk crosses a threshold the approval chain re-enters automatically.
            </div>
          )}
        </div>
      )}

      {approvals.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Approval Chain</h3>
          <table>
            <thead><tr><th className="num">Seq</th><th>Level</th><th>Status</th><th className="num">Ver</th><th className="num">Risk</th><th>Reason</th><th>Acted</th></tr></thead>
            <tbody>
              {approvals.map(a => (
                <tr key={a.id}>
                  <td className="num">{a.sequence}</td>
                  <td>{a.level}</td>
                  <td><span className={`badge ${badgeFor(a.status)}`}>{a.status}</span></td>
                  <td className="muted">v{a.quotationVersion}</td>
                  <td className="num muted">{formatBp(a.riskScoreBp)}</td>
                  <td className="muted">{a.reason ?? '—'}</td>
                  <td className="muted mono">{a.actedAt ? new Date(a.actedAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(audit.data?.data.length ?? 0) > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Audit Trail</h3>
          <table>
            <thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Reason</th></tr></thead>
            <tbody>
              {(audit.data?.data ?? []).map(a => (
                <tr key={a.id}>
                  <td className="muted mono">{new Date(a.createdAt).toLocaleString()}</td>
                  <td>{a.action}</td>
                  <td className="muted">{a.actorLabel ?? a.actorRole ?? '—'}</td>
                  <td className="muted">{a.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function badgeFor(status: string): string {
  if (status === 'APPROVED') return 'approved';
  if (status === 'REJECTED') return 'rejected';
  if (status === 'PENDING') return 'pending';
  if (status === 'REVISION_REQUIRED') return 'revision';
  return 'draft';
}

type ActFn = (label: string, path: string, method?: 'POST' | 'PATCH' | 'DELETE', body?: unknown) => Promise<void>;

function OrderDiscountCard({ quote, busy, onSave }: { quote: Quotation; busy: string | null; onSave: (bp: number) => void }) {
  const [value, setValue] = useState((quote.orderDiscountBp / 100).toString());
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Order-level discount</h3>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <div style={{ width: 160 }}>
          <label htmlFor="odisc">Percent</label>
          <input id="odisc" type="number" step="0.01" min="0" max="100" value={value} onChange={e => setValue(e.target.value)} />
        </div>
        <button disabled={busy !== null} onClick={() => onSave(percentToBp(value))}>
          {busy === 'discount' ? 'Applying…' : 'Apply'}
        </button>
        <div className="muted" style={{ fontSize: 12 }}>Currently {formatBp(quote.orderDiscountBp)} · applying bumps the version and re-scores risk.</div>
      </div>
    </div>
  );
}

function LineRow({ line, quoteId, canEdit, busy, onAct }: {
  line: QuotationLine; quoteId: string; canEdit: boolean; busy: string | null; onAct: ActFn;
}) {
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(line.quantity));
  const [disc, setDisc] = useState((line.discountBp / 100).toString());

  const saveLabel = `line-${line.id}`;

  async function save() {
    await onAct(saveLabel, `/api/quotations/${quoteId}/lines/${line.id}`, 'PATCH', {
      quantity: Number.parseInt(qty, 10) || line.quantity,
      discountBp: percentToBp(disc),
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <tr>
        <td>{line.productName} <span className="muted mono">{line.productSku}</span></td>
        <td className="num"><input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} style={{ width: 70 }} /></td>
        <td className="num muted">{formatPaise(line.listUnitPricePaise)}</td>
        <td className="num">{formatPaise(line.unitPricePaise)}</td>
        <td className="num"><input type="number" step="0.01" min="0" max="100" value={disc} onChange={e => setDisc(e.target.value)} style={{ width: 80 }} /></td>
        <td className="num muted">{formatBp(line.effectiveCeilingBp)}</td>
        <td className="num">{formatPaise(line.lineTotalPaise)}</td>
        <td>
          <div className="row" style={{ gap: 4 }}>
            <button disabled={busy !== null} onClick={save}>{busy === saveLabel ? 'Saving…' : 'Save'}</button>
            <button className="btn secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{line.productName} <span className="muted mono">{line.productSku}</span></td>
      <td className="num">{line.quantity}</td>
      <td className="num muted">{formatPaise(line.listUnitPricePaise)}</td>
      <td className="num">{formatPaise(line.unitPricePaise)}</td>
      <td
        className="num"
        style={{ color: line.violationBp > 0 ? 'var(--danger)' : undefined, fontWeight: line.violationBp > 0 ? 620 : undefined }}
        title={line.violationBp > 0 ? `${formatBp(line.violationBp)} over the ceiling` : undefined}
      >
        {formatBp(line.discountBp)}
      </td>
      <td className="num muted">{formatBp(line.effectiveCeilingBp)}</td>
      <td className="num">{formatPaise(line.lineTotalPaise)}</td>
      {canEdit && (
        <td>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn secondary" onClick={() => setEditing(true)}>Edit</button>
            <button className="danger" disabled={busy !== null}
              onClick={() => onAct(`del-${line.id}`, `/api/quotations/${quoteId}/lines/${line.id}`, 'DELETE')}>
              Remove
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

function AddLineCard({ quoteId, busy, onAct }: { quoteId: string; busy: string | null; onAct: ActFn }) {
  const { data } = useApiQuery<{ data: Product[] }>('/api/products');
  const products = (data?.data ?? []).filter(p => p.active !== false);

  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [discount, setDiscount] = useState('');

  const selected = products.find(p => p.id === productId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!productId) return;
    const body: Record<string, unknown> = {
      productId,
      quantity: Number.parseInt(quantity, 10) || 1,
    };
    if (discount.trim()) body.discountBp = percentToBp(discount);
    await onAct('add-line', `/api/quotations/${quoteId}/lines`, 'POST', body);
    setProductId('');
    setQuantity('1');
    setDiscount('');
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3 style={{ marginTop: 0 }}>Add a line</h3>
      <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label htmlFor="product">Product</label>
          <select id="product" value={productId} onChange={e => setProductId(e.target.value)} required>
            <option value="">Select a product…</option>
            {products.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku}) — {formatPaise(p.basePricePaise)}
              </option>
            ))}
          </select>
        </div>
        <div style={{ width: 100 }}>
          <label htmlFor="qty">Qty</label>
          <input id="qty" type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} required />
        </div>
        <div style={{ width: 130 }}>
          <label htmlFor="disc">Discount %</label>
          <input id="disc" type="number" step="0.01" min="0" max="100" placeholder="0" value={discount} onChange={e => setDiscount(e.target.value)} />
        </div>
        <button type="submit" disabled={busy !== null || !productId}>
          {busy === 'add-line' ? 'Adding…' : 'Add line'}
        </button>
      </div>
      {selected && (
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          {selected.category?.name} · {selected.unit} · tax {formatBp(selected.taxBp)} · {selected.billingType === 'RECURRING' ? 'recurring' : 'one-time'}
          {' '}· leave discount blank to use the tier ceiling default.
        </div>
      )}
    </form>
  );
}