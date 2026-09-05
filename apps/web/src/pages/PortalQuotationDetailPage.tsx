import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatPaise, formatBp, percentToBp, toApiError, type ApiError } from '../api.js';
import { useApiQuery } from '../useApiQuery.js';
import { type Quotation, type QuotationLine } from '../types.js';
import { ErrorNotice, Empty, Loading } from '../components/States.js';

/** The portal payload strips cost/margin, so it is a narrower shape than Quotation. */
type PortalLine = Pick<QuotationLine,
  'id' | 'productName' | 'productSku' | 'quantity' |
  'listUnitPricePaise' | 'unitPricePaise' | 'discountBp' | 'lineTotalPaise' | 'lineType'
> & { categoryName: string; netAmountPaise: number; taxAmountPaise: number };

interface PortalNegotiation {
  id: string;
  requestType: 'QUESTION' | 'DISCOUNT_COUNTER' | 'QUANTITY_CHANGE' | 'LINE_REMOVAL';
  status: string;
  proposedDiscountBp: number | null;
  proposedQuantity: number | null;
  lineId: string | null;
  comment: string | null;
  createdAt: string;
}

type PortalQuote = Quotation & { lines: PortalLine[]; negotiations: PortalNegotiation[] };

/** States where the customer may accept or counter. */
const ACTABLE = ['SENT', 'UNDER_NEGOTIATION'];

/**
 * Why the customer cannot act, in their language.
 *
 * Rendering nothing when a quote is not actionable made the portal look like it
 * had no accept or negotiate feature at all — most visibly on a DRAFT quotation,
 * which is the state the demo data starts in.
 */
const BLOCKED_REASON: Record<string, string> = {
  DRAFT: 'This quotation is still being prepared by your account manager. You will be able to review and accept it once it is sent to you.',
  PENDING_APPROVAL: 'Your request is with our internal reviewers. We will update this quotation as soon as they have signed off — no action is needed from you right now.',
  APPROVED: 'This quotation has cleared internal review and is about to be sent to you formally.',
  REVISION_REQUIRED: 'Your account manager is reworking the terms and will send an updated version.',
  REJECTED: 'This quotation has been withdrawn and is no longer available to accept.',
  CONFIRMED: 'You have accepted these terms. We are preparing your order — nothing further is needed.',
  FULFILLMENT: 'Your order is being allocated and shipped.',
  COMPLETED: 'This order is complete.',
};

export function PortalQuotationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error: loadError, refetch } = useApiQuery<{ quote: PortalQuote }>(
    id ? `/api/portal/quotations/${id}` : null,
  );

  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCounter, setShowCounter] = useState(false);

  async function act(label: string, path: string, body?: unknown) {
    setBusy(label);
    setError(null);
    try {
      await api(path, { method: 'POST', body: body ?? {} });
      setShowCounter(false);
      refetch();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(null);
    }
  }

  if (loadError) return <ErrorNotice error={loadError} />;
  if (loading || !data) return <Loading />;

  const q = data.quote;
  const lines = q.lines ?? [];
  const negotiations = q.negotiations ?? [];
  const canAct = ACTABLE.includes(q.status);
  const openRequest = negotiations.find((n) => n.status === 'SUBMITTED');

  return (
    <div>
      <Link to="/portal/quotations" className="muted">← Back to my quotations</Link>

      <div className="row between" style={{ marginTop: 8, marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: '4px 0' }}>{q.quoteNumber}</h2>
          <div className="muted">
            Version {q.version}
            {q.sentAt && ` · received ${new Date(q.sentAt).toLocaleDateString()}`}
            {q.validUntil && ` · valid until ${new Date(q.validUntil).toLocaleDateString()}`}
          </div>
        </div>
        {canAct && (
          <div className="row" style={{ gap: 8 }}>
            <button className="btn secondary" disabled={busy !== null} onClick={() => setShowCounter((v) => !v)}>
              {showCounter ? 'Close request form' : 'Request a change'}
            </button>
            <button disabled={busy !== null} onClick={() => act('accept', `/api/portal/quotations/${q.id}/confirm`)}>
              {busy === 'accept' ? 'Accepting…' : 'Accept quotation'}
            </button>
          </div>
        )}
      </div>

      {error && <ErrorNotice error={error} />}

      {canAct ? (
        <div className="notice ok">
          <strong>This quotation is ready for your decision.</strong>{' '}
          Accept it to confirm the terms below, or request a change if you would like a different price,
          quantity, or have a question.
          {openRequest && ' Your previous request is still with your account manager.'}
        </div>
      ) : (
        <div className={q.status === 'CONFIRMED' || q.status === 'COMPLETED' ? 'notice ok' : q.status === 'REJECTED' ? 'notice warn' : 'notice'}>
          {BLOCKED_REASON[q.status] ?? `This quotation is currently ${q.status.replace(/_/g, ' ').toLowerCase()}.`}
        </div>
      )}

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="card"><div className="kpi-label">Subtotal</div><div className="kpi">{formatPaise(q.subtotalPaise)}</div></div>
        <div className="card"><div className="kpi-label">Discount</div><div className="kpi">{formatPaise(q.discountTotalPaise)}</div></div>
        <div className="card"><div className="kpi-label">Tax</div><div className="kpi">{formatPaise(q.taxTotalPaise)}</div></div>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="card"><div className="kpi-label">One-time</div><div className="kpi">{formatPaise(q.oneTimeGrandTotalPaise)}</div></div>
        <div className="card"><div className="kpi-label">Recurring</div><div className="kpi">{formatPaise(q.recurringGrandTotalPaise)}</div></div>
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <div className="kpi-label">Grand Total</div><div className="kpi">{formatPaise(q.grandTotalPaise)}</div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Items</h3>
        <table>
          <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">List</th><th className="num">Your price</th><th className="num">Discount</th><th>Type</th><th className="num">Line total</th></tr></thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.id}>
                <td>{l.productName} <span className="muted mono">{l.productSku}</span></td>
                <td className="num">{l.quantity}</td>
                <td className="num muted">{formatPaise(l.listUnitPricePaise)}</td>
                <td className="num">{formatPaise(l.unitPricePaise)}</td>
                <td className="num">{formatBp(l.discountBp)}</td>
                <td className="muted">{l.lineType === 'RECURRING' ? 'Recurring' : 'One-time'}</td>
                <td className="num">{formatPaise(l.lineTotalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {lines.length === 0 && <Empty title="No items on this quotation" />}
      </div>

      {showCounter && canAct && (
        <CounterOfferForm
          quote={q}
          lines={lines}
          busy={busy}
          onSubmit={(body) => act('counter', `/api/portal/quotations/${q.id}/negotiations`, body)}
          onCancel={() => setShowCounter(false)}
        />
      )}

      {negotiations.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>My Requests</h3>
          <table>
            <thead><tr><th>Submitted</th><th>Type</th><th>Proposed</th><th>Status</th><th>Comment</th></tr></thead>
            <tbody>
              {negotiations.map(n => (
                <tr key={n.id}>
                  <td className="muted mono">{new Date(n.createdAt).toLocaleString()}</td>
                  <td>{n.requestType.replace(/_/g, ' ')}</td>
                  <td>
                    {n.proposedDiscountBp !== null ? formatBp(n.proposedDiscountBp)
                      : n.proposedQuantity !== null ? `qty ${n.proposedQuantity}`
                      : '—'}
                  </td>
                  <td><span className={`badge ${n.status === 'APPLIED' ? 'approved' : n.status === 'REJECTED' ? 'rejected' : 'pending'}`}>{n.status}</span></td>
                  <td className="muted">{n.comment ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {q.notes && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Notes</h3>
          <p className="muted">{q.notes}</p>
        </div>
      )}
    </div>
  );
}

type RequestType = 'QUESTION' | 'DISCOUNT_COUNTER' | 'QUANTITY_CHANGE' | 'LINE_REMOVAL';

const NEEDS_LINE: RequestType[] = ['DISCOUNT_COUNTER', 'QUANTITY_CHANGE', 'LINE_REMOVAL'];

function CounterOfferForm({ quote, lines, busy, onSubmit, onCancel }: {
  quote: PortalQuote;
  lines: PortalLine[];
  busy: string | null;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [requestType, setRequestType] = useState<RequestType>('DISCOUNT_COUNTER');
  const [lineId, setLineId] = useState(lines[0]?.id ?? '');
  const [discount, setDiscount] = useState('');
  const [quantity, setQuantity] = useState('');
  const [comment, setComment] = useState('');

  const needsLine = NEEDS_LINE.includes(requestType);
  const selectedLine = lines.find(l => l.id === lineId);

  const valid =
    (!needsLine || lineId !== '') &&
    (requestType !== 'DISCOUNT_COUNTER' || discount.trim() !== '') &&
    (requestType !== 'QUANTITY_CHANGE' || quantity.trim() !== '');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    // The version is sent so the server can reject a counter written against
    // terms the customer is no longer looking at.
    const body: Record<string, unknown> = { requestType, version: quote.version };
    if (needsLine) body.lineId = lineId;
    if (requestType === 'DISCOUNT_COUNTER') body.proposedDiscountBp = percentToBp(discount);
    if (requestType === 'QUANTITY_CHANGE') body.proposedQuantity = Number.parseInt(quantity, 10);
    if (comment.trim()) body.comment = comment.trim();
    onSubmit(body);
  }

  return (
    <form className="card" onSubmit={submit} style={{ borderColor: 'var(--accent)' }}>
      <h3 style={{ marginTop: 0 }}>Request a change</h3>
      <div className="col">
        <div>
          <label htmlFor="rtype">What would you like to request?</label>
          <select id="rtype" value={requestType} onChange={e => setRequestType(e.target.value as RequestType)}>
            <option value="DISCOUNT_COUNTER">A better price on a line</option>
            <option value="QUANTITY_CHANGE">A different quantity</option>
            <option value="LINE_REMOVAL">Remove a line</option>
            <option value="QUESTION">Ask a question</option>
          </select>
        </div>

        {needsLine && (
          <div>
            <label htmlFor="rline">Which item?</label>
            <select id="rline" value={lineId} onChange={e => setLineId(e.target.value)} required>
              <option value="">Select an item…</option>
              {lines.map(l => (
                <option key={l.id} value={l.id}>{l.productName} — qty {l.quantity} at {formatBp(l.discountBp)} off</option>
              ))}
            </select>
          </div>
        )}

        {requestType === 'DISCOUNT_COUNTER' && (
          <div>
            <label htmlFor="rdisc">Requested discount %</label>
            <input id="rdisc" type="number" step="0.01" min="0.01" max="100" value={discount}
              onChange={e => setDiscount(e.target.value)} required />
            {selectedLine && (
              <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                Currently {formatBp(selectedLine.discountBp)}.
              </div>
            )}
          </div>
        )}

        {requestType === 'QUANTITY_CHANGE' && (
          <div>
            <label htmlFor="rqty">Requested quantity</label>
            <input id="rqty" type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} required />
            {selectedLine && (
              <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                Currently {selectedLine.quantity}.
              </div>
            )}
          </div>
        )}

        <div>
          <label htmlFor="rcomment">Comment <span className="muted">(optional)</span></label>
          <textarea id="rcomment" rows={3} value={comment} onChange={e => setComment(e.target.value)} />
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button type="submit" disabled={busy !== null || !valid}>
            {busy === 'counter' ? 'Submitting…' : 'Submit request'}
          </button>
          <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          Submitting puts the quotation under negotiation. Your account manager reviews the request.
        </div>
      </div>
    </form>
  );
}