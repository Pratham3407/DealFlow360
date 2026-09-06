import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatBp, formatPaise, rupeesToPaise, toApiError, type ApiError } from '../api.js';
import { useAuth } from '../auth-context.js';
import { useApiQuery } from '../useApiQuery.js';
import {
  CANCELLATION_LABEL, DAY_COUNT_LABEL, INTERVAL_LABEL,
  PRORATION_LABEL, REFUND_LABEL, modeLabel,
} from '../plan-labels.js';
import { type Quotation } from '../types.js';
import { ErrorNotice, Empty, Loading } from '../components/States.js';

/**
 * Billing is per-order — invoices and subscriptions hang off a confirmed
 * quotation at `/api/orders/:id/billing`, so this is master/detail with the
 * selection held in the query string.
 *
 * Billing and fulfillment are siblings downstream of `CONFIRMED`, not a sequence.
 * An order is invoiceable the moment the customer accepts it; nothing waits on the
 * warehouse. The order table says so explicitly, because the sidebar ordering
 * otherwise implies fulfillment has to come first.
 */
export function BillingPage() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('order');

  const confirmed = useApiQuery<{ data: Quotation[] }>('/api/quotations?status=CONFIRMED&limit=50');
  const inFulfillment = useApiQuery<{ data: Quotation[] }>('/api/quotations?status=FULFILLMENT&limit=50');
  const completed = useApiQuery<{ data: Quotation[] }>('/api/quotations?status=COMPLETED&limit=50');

  const orders = [
    ...(confirmed.data?.data ?? []),
    ...(inFulfillment.data?.data ?? []),
    ...(completed.data?.data ?? []),
  ];
  const loading = confirmed.loading || inFulfillment.loading || completed.loading;
  const error = confirmed.error ?? inFulfillment.error ?? completed.error;

  function select(id: string) {
    const next = new URLSearchParams(params);
    next.set('order', id);
    setParams(next);
  }

  return (
    <div>
      <h2>Billing</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Billable once the customer accepts. Does not wait on fulfillment.
      </p>

      {error && <ErrorNotice error={error} />}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Billable Orders</h3>
        <table>
          <thead>
            <tr>
              <th>Quote #</th><th>Where it is</th>
              <th className="num">One-time</th><th className="num">Recurring</th><th className="num">Grand Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} style={o.id === selectedId ? { background: 'var(--accent-soft)', boxShadow: 'inset 3px 0 0 var(--accent)' } : undefined}>
                <td><Link to={`/quotations/${o.id}`}>{o.quoteNumber}</Link></td>
                <td>
                  <span className={`badge ${o.status.toLowerCase()}`}>{o.status}</span>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                    {o.status === 'CONFIRMED'
                      ? 'Accepted — billable now, fulfillment not required'
                      : o.status === 'FULFILLMENT'
                        ? 'Shipping in progress — still billable'
                        : 'Closed'}
                  </div>
                </td>
                <td className="num">{formatPaise(o.oneTimeGrandTotalPaise)}</td>
                <td className="num">{formatPaise(o.recurringGrandTotalPaise)}</td>
                <td className="num">{formatPaise(o.grandTotalPaise)}</td>
                <td>
                  <button className={o.id === selectedId ? '' : 'btn secondary'} onClick={() => select(o.id)}>
                    {o.id === selectedId ? 'Viewing' : 'Open billing'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.length === 0 && !loading && (
          <div className="muted">
            No billable orders yet. A quotation becomes billable once the customer accepts it in the portal.
          </div>
        )}
        {loading && <Loading />}
      </div>

      {selectedId && <OrderBilling quotationId={selectedId} />}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Subscription Plans</h3>
        <SubscriptionPlans />
      </div>
    </div>
  );
}

interface InvoiceLine {
  id: string; description: string; quantity: number;
  unitPricePaise: number; discountBp: number;
  amountPaise?: number; totalPaise?: number;
}

interface Payment {
  id: string; amountPaise: number; method: string; reference: string | null;
  status: string; paidAt: string | null;
}

interface CreditNote {
  id: string; creditNoteNumber?: string; amountPaise: number; reason: string; createdAt: string;
}

interface Invoice {
  id: string; invoiceNumber: string; type: string; status: string;
  subtotalPaise: number; discountPaise: number; taxPaise: number; amountPaise: number;
  amountPaidPaise: number; creditedPaise: number;
  issueDate: string | null; dueDate: string | null;
  periodStart: string | null; periodEnd: string | null;
  lines: InvoiceLine[]; payments: Payment[]; creditNotes: CreditNote[];
  customerId: string;
}

interface Schedule {
  id: string; sequence: number; periodStart: string; periodEnd: string;
  amountPaise: number; taxAmountPaise: number; totalPaise: number;
  quantity: number; status: string; invoiceId: string | null;
}

interface Subscription {
  id: string; subscriptionNumber: string; quantity: number; status: string;
  plan?: { id: string; name: string; interval: string; prorationMode?: string; cancellationMode?: string; refundMode?: string };
  schedules: Schedule[];
}

interface BillingData { invoices: Invoice[]; subscriptions: Subscription[] }

/** Anyone commercial may issue an invoice; only Finance moves money. */
const CAN_GENERATE = ['SALES_REP', 'SALES_MANAGER', 'FINANCE_OPERATIONS', 'ADMIN'];
const CAN_TAKE_MONEY = ['FINANCE_OPERATIONS', 'ADMIN'];

function OrderBilling({ quotationId }: { quotationId: string }) {
  const { session } = useAuth();
  const { data, loading, error: loadError, refetch } = useApiQuery<BillingData>(`/api/orders/${quotationId}/billing`);

  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<Invoice | null>(null);
  const [creditFor, setCreditFor] = useState<Invoice | null>(null);

  const canGenerate = CAN_GENERATE.includes(session?.role ?? '');
  const canTakeMoney = CAN_TAKE_MONEY.includes(session?.role ?? '');

  async function act(label: string, path: string, body?: unknown) {
    setBusy(label);
    setError(null);
    try {
      await api(path, { method: 'POST', body: body ?? {} });
      setPayFor(null);
      setCreditFor(null);
      refetch();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="card"><Loading label="Loading billing…" /></div>;
  if (loadError) return <ErrorNotice error={loadError} />;

  const invoices = data?.invoices ?? [];
  const subscriptions = data?.subscriptions ?? [];

  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Order Billing</h3>
        {canGenerate && (
          <button disabled={busy !== null} onClick={() => act('gen', `/api/orders/${quotationId}/billing/generate`)}>
            {busy === 'gen' ? 'Generating…' : invoices.length ? 'Generate missing items' : 'Generate invoice'}
          </button>
        )}
      </div>

      {error && <ErrorNotice error={error} />}

      {invoices.length === 0 && subscriptions.length === 0 && (
        <div className="notice">
          <strong>Nothing billed yet.</strong>{' '}
          Generating issues the one-time invoice and opens a subscription with its schedule for any
          recurring lines. A confirmed order is billable straight away — you do not need to wait for
          fulfillment, which runs alongside billing rather than before it.
        </div>
      )}

      {invoices.map(inv => {
        const outstanding = inv.amountPaise - inv.amountPaidPaise - inv.creditedPaise;
        return (
          <div key={inv.id} className="panel">
            <div className="row between">
              <div>
                <strong className="mono">{inv.invoiceNumber}</strong>{' '}
                <span className={`badge ${inv.status === 'PAID' ? 'approved' : inv.status === 'DRAFT' ? 'draft' : 'pending'}`}>{inv.status}</span>{' '}
                <span className="muted">{inv.type}</span>
              </div>
              {canTakeMoney && (
                <div className="row" style={{ gap: 8 }}>
                  {outstanding > 0 && <button onClick={() => setPayFor(inv)}>Record payment</button>}
                  {inv.amountPaidPaise > inv.creditedPaise && (
                    <button className="btn secondary" onClick={() => setCreditFor(inv)}>Credit note</button>
                  )}
                </div>
              )}
              {!canTakeMoney && outstanding > 0 && (
                <span className="muted" style={{ fontSize: 12 }}>
                  Finance records payments and credit notes.
                </span>
              )}
            </div>

            <div className="grid grid-3" style={{ margin: '12px 0' }}>
              <div><div className="kpi-label">Amount</div><div>{formatPaise(inv.amountPaise)}</div></div>
              <div><div className="kpi-label">Paid</div><div>{formatPaise(inv.amountPaidPaise)}</div></div>
              <div><div className="kpi-label">Credited</div><div>{formatPaise(inv.creditedPaise)}</div></div>
              <div>
                <div className="kpi-label">Outstanding</div>
                <div style={{ color: outstanding > 0 ? 'var(--warning)' : 'var(--success)' }}>{formatPaise(outstanding)}</div>
              </div>
              <div><div className="kpi-label">Issued</div><div className="mono">{inv.issueDate ? new Date(inv.issueDate).toLocaleDateString() : '—'}</div></div>
              <div><div className="kpi-label">Due</div><div className="mono">{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}</div></div>
            </div>

            <table>
              <thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Disc</th><th className="num">Total</th></tr></thead>
              <tbody>
                {inv.lines.map(l => (
                  <tr key={l.id}>
                    <td>{l.description}</td>
                    <td className="num">{l.quantity}</td>
                    <td className="num">{formatPaise(l.unitPricePaise)}</td>
                    <td className="num muted">{formatBp(l.discountBp)}</td>
                    <td className="num">{formatPaise(l.amountPaise ?? l.totalPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {inv.payments.length > 0 && (
              <>
                <h4 style={{ marginBottom: 4 }}>Payments</h4>
                <table>
                  <thead><tr><th>Paid</th><th className="num">Amount</th><th>Method</th><th>Reference</th><th>Status</th></tr></thead>
                  <tbody>
                    {inv.payments.map(p => (
                      <tr key={p.id}>
                        <td className="muted mono">{p.paidAt ? new Date(p.paidAt).toLocaleString() : '—'}</td>
                        <td className="num">{formatPaise(p.amountPaise)}</td>
                        <td>{p.method}</td>
                        <td className="muted mono">{p.reference ?? '—'}</td>
                        <td><span className={`badge ${p.status === 'COMPLETED' ? 'approved' : 'pending'}`}>{p.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {inv.creditNotes.length > 0 && (
              <>
                <h4 style={{ marginBottom: 4 }}>Credit Notes</h4>
                <table>
                  <thead><tr><th>Issued</th><th className="num">Amount</th><th>Reason</th></tr></thead>
                  <tbody>
                    {inv.creditNotes.map(c => (
                      <tr key={c.id}>
                        <td className="muted mono">{new Date(c.createdAt).toLocaleDateString()}</td>
                        <td className="num">{formatPaise(c.amountPaise)}</td>
                        <td className="muted">{c.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        );
      })}

      {subscriptions.map(sub => (
        <SubscriptionCard key={sub.id} sub={sub} busy={busy} onAct={act} />
      ))}

      {payFor && (
        <PaymentForm
          invoice={payFor}
          busy={busy}
          onSubmit={(body) => act('pay', '/api/payments', body)}
          onCancel={() => setPayFor(null)}
        />
      )}

      {creditFor && (
        <CreditNoteForm
          invoice={creditFor}
          busy={busy}
          onSubmit={(body) => act('credit', '/api/credit-notes', body)}
          onCancel={() => setCreditFor(null)}
        />
      )}
    </div>
  );
}

type ActFn = (label: string, path: string, body?: unknown) => Promise<void>;

function SubscriptionCard({ sub, busy, onAct }: { sub: Subscription; busy: string | null; onAct: ActFn }) {
  const { session } = useAuth();
  const [showModify, setShowModify] = useState(false);
  const [newQuantity, setNewQuantity] = useState(String(sub.quantity));
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);

  const canModify = ['SALES_REP', 'SALES_MANAGER', 'FINANCE_OPERATIONS', 'ADMIN'].includes(session?.role ?? '');
  const canCancel = ['SALES_MANAGER', 'FINANCE_OPERATIONS', 'ADMIN'].includes(session?.role ?? '');
  const active = sub.status !== 'CANCELLED';

  return (
    <div className={active ? 'panel' : 'panel is-inactive'}>
      <div className="row between">
        <div>
          <strong className="mono">{sub.subscriptionNumber}</strong>{' '}
          <span className={`badge ${active ? 'approved' : 'rejected'}`}>{sub.status}</span>{' '}
          <span className="muted">
            {sub.plan?.name} · {modeLabel(INTERVAL_LABEL, sub.plan?.interval).label} · qty {sub.quantity}
          </span>
          {sub.plan && (
            <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
              Quantity changes: {modeLabel(PRORATION_LABEL, sub.plan.prorationMode).label}
              {' · '}Cancellation: {modeLabel(CANCELLATION_LABEL, sub.plan.cancellationMode).label}
              {' · '}Refunds: {modeLabel(REFUND_LABEL, sub.plan.refundMode).label}
            </div>
          )}
        </div>
        {active && (
          <div className="row" style={{ gap: 8 }}>
            {canModify && <button className="btn secondary" onClick={() => setShowModify(v => !v)}>Change quantity</button>}
            {canCancel && <button className="danger" onClick={() => setShowCancel(v => !v)}>Cancel</button>}
          </div>
        )}
      </div>

      {showModify && (
        <div className="row" style={{ gap: 8, alignItems: 'flex-end', marginTop: 12 }}>
          <div style={{ width: 140 }}>
            <label htmlFor={`sq-${sub.id}`}>New quantity</label>
            <input id={`sq-${sub.id}`} type="number" min="1" value={newQuantity} onChange={e => setNewQuantity(e.target.value)} />
          </div>
          <button disabled={busy !== null}
            onClick={() => onAct(`mod-${sub.id}`, `/api/subscriptions/${sub.id}/modify`, { newQuantity: Number.parseInt(newQuantity, 10) || sub.quantity })}>
            {busy === `mod-${sub.id}` ? 'Applying…' : 'Apply'}
          </button>
          <button className="btn secondary" onClick={() => setShowModify(false)}>Cancel</button>
          <div className="muted" style={{ fontSize: 12 }}>
            {modeLabel(PRORATION_LABEL, sub.plan?.prorationMode).effect}
          </div>
        </div>
      )}

      {showCancel && (
        <div className="row" style={{ gap: 8, alignItems: 'flex-end', marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <label htmlFor={`sc-${sub.id}`}>Reason (optional)</label>
            <input id={`sc-${sub.id}`} value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
          </div>
          <button className="danger" disabled={busy !== null}
            onClick={() => onAct(`can-${sub.id}`, `/api/subscriptions/${sub.id}/cancel`, cancelReason.trim() ? { reason: cancelReason.trim() } : {})}>
            {busy === `can-${sub.id}` ? 'Cancelling…' : 'Confirm cancel'}
          </button>
          <button className="btn secondary" onClick={() => setShowCancel(false)}>Keep</button>
        </div>
      )}
      {showCancel && (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          {modeLabel(CANCELLATION_LABEL, sub.plan?.cancellationMode).effect}
          {' '}
          {modeLabel(REFUND_LABEL, sub.plan?.refundMode).effect}
        </div>
      )}

      <h4 style={{ marginBottom: 4, marginTop: 12 }}>Billing Schedule</h4>
      <table>
        <thead><tr><th className="num">#</th><th>Period</th><th className="num">Qty</th><th className="num">Net</th><th className="num">Tax</th><th className="num">Total</th><th>Status</th></tr></thead>
        <tbody>
          {sub.schedules.map(s => (
            <tr key={s.id}>
              <td className="num">{s.sequence}</td>
              <td className="mono">{new Date(s.periodStart).toLocaleDateString()} → {new Date(s.periodEnd).toLocaleDateString()}</td>
              <td className="num">{s.quantity}</td>
              <td className="num">{formatPaise(s.amountPaise)}</td>
              <td className="num muted">{formatPaise(s.taxAmountPaise)}</td>
              <td className="num">{formatPaise(s.totalPaise)}</td>
              <td><span className={`badge ${s.status === 'INVOICED' ? 'approved' : s.status === 'CANCELLED' ? 'rejected' : 'draft'}`}>{s.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {sub.schedules.length === 0 && <Empty title="No periods scheduled" hint="Generate billing to create the recurring schedule." />}
    </div>
  );
}

function PaymentForm({ invoice, busy, onSubmit, onCancel }: {
  invoice: Invoice; busy: string | null;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const outstanding = invoice.amountPaise - invoice.amountPaidPaise - invoice.creditedPaise;
  const [amount, setAmount] = useState((outstanding / 100).toFixed(2));
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      invoiceId: invoice.id,
      amountPaise: rupeesToPaise(amount),
      method,
    };
    if (reference.trim()) body.reference = reference.trim();
    onSubmit(body);
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--accent)' }}>
      <h4 style={{ marginTop: 0 }}>Record a payment against {invoice.invoiceNumber}</h4>
      <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
        <div style={{ width: 160 }}>
          <label htmlFor="pamt">Amount (₹)</label>
          <input id="pamt" type="number" step="0.01" min="0.01" value={amount} onChange={e => setAmount(e.target.value)} required />
        </div>
        <div style={{ width: 180 }}>
          <label htmlFor="pmethod">Method</label>
          <select id="pmethod" value={method} onChange={e => setMethod(e.target.value)}>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="CARD">Card</option>
            <option value="UPI">UPI</option>
            <option value="CHEQUE">Cheque</option>
            <option value="CASH">Cash</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor="pref">Reference (optional)</label>
          <input id="pref" value={reference} onChange={e => setReference(e.target.value)} />
        </div>
        <button type="submit" disabled={busy !== null}>{busy === 'pay' ? 'Recording…' : 'Record'}</button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
      <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        Outstanding is {formatPaise(outstanding)}. Overpayment is rejected by the server.
      </div>
    </form>
  );
}

function CreditNoteForm({ invoice, busy, onSubmit, onCancel }: {
  invoice: Invoice; busy: string | null;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  /*
   * A credit note returns money, so the cap is what has actually been paid and
   * not already credited — not the outstanding balance. Defaulting to the
   * outstanding amount produced a request the server always rejected.
   */
  const creditable = invoice.amountPaidPaise - invoice.creditedPaise;
  const [amount, setAmount] = useState((creditable / 100).toFixed(2));
  const [reason, setReason] = useState('');

  const requested = rupeesToPaise(amount);
  const overCap = requested > creditable;
  const valid = reason.trim() !== '' && requested > 0 && !overCap;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    onSubmit({
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      amountPaise: requested,
      reason: reason.trim(),
    });
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--accent)' }}>
      <h4 style={{ marginTop: 0 }}>Issue a credit note against {invoice.invoiceNumber}</h4>
      <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
        <div style={{ width: 160 }}>
          <label htmlFor="camt">Amount (₹)</label>
          <input id="camt" type="number" step="0.01" min="0.01" value={amount} onChange={e => setAmount(e.target.value)} required />
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor="creason">Reason</label>
          <input id="creason" value={reason} onChange={e => setReason(e.target.value)} required />
        </div>
        <button type="submit" disabled={busy !== null || !valid}>{busy === 'credit' ? 'Issuing…' : 'Issue'}</button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
      <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        {formatPaise(creditable)} available to credit — a credit note cannot exceed what has been paid.
      </div>
      {overCap && (
        <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>
          That is more than the {formatPaise(creditable)} paid on this invoice.
        </div>
      )}
    </form>
  );
}

interface Plan {
  id: string; name: string; interval: string;
  active: boolean; description?: string | null;
  prorationMode?: string; cancellationMode?: string;
  refundMode?: string; dayCountConvention?: string;
  minTermIntervals?: number;
  eligibleProducts?: Array<{ productId: string; isDefault: boolean }>;
}

/**
 * Plan rules, spelled out.
 *
 * The previous table printed the raw enum in each column — `DAILY_PRORATA`,
 * `END_OF_PERIOD` — which names a mode without saying what it does to a bill, and
 * showed nothing at all for the refund and day-count modes. Each plan is now a
 * block with its rules described in terms of their effect.
 */
function SubscriptionPlans() {
  const { data, loading } = useApiQuery<{ data: Plan[] }>('/api/subscription-plans');
  const products = useApiQuery<{ data: Array<{ id: string; name: string; sku: string }> }>('/api/products');
  const items = data?.data ?? [];

  const productName = (id: string) =>
    products.data?.data.find((p) => p.id === id)?.name ?? id;

  if (loading) return <Loading />;
  if (items.length === 0) return <Empty title="No subscription plans" hint="A recurring product needs a plan before it can be quoted." />;

  return (
    <>


      {items.map((plan) => {
        const proration = modeLabel(PRORATION_LABEL, plan.prorationMode);
        const cancellation = modeLabel(CANCELLATION_LABEL, plan.cancellationMode);
        const refund = modeLabel(REFUND_LABEL, plan.refundMode);
        const dayCount = modeLabel(DAY_COUNT_LABEL, plan.dayCountConvention);
        const interval = modeLabel(INTERVAL_LABEL, plan.interval);

        return (
          <div key={plan.id} className={plan.active ? 'panel' : 'panel is-inactive'}>
            <div className="row between" style={{ marginBottom: 8 }}>
              <div>
                <strong>{plan.name}</strong>{' '}
                <span className={`badge ${plan.active ? 'approved' : 'draft'}`}>
                  {plan.active ? 'ACTIVE' : 'INACTIVE'}
                </span>
                {plan.description && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{plan.description}</div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="kpi-label">Billing cycle</div>
                <div>{interval.label}</div>
              </div>
            </div>

            <div className="kv">
              <div className="kv-key">
                Quantity changes
                <small>{proration.effect}</small>
              </div>
              <div className="kv-val"><strong>{proration.label}</strong></div>

              <div className="kv-key">
                Cancellation
                <small>{cancellation.effect}</small>
              </div>
              <div className="kv-val"><strong>{cancellation.label}</strong></div>

              <div className="kv-key">
                Refunds
                <small>{refund.effect}</small>
              </div>
              <div className="kv-val"><strong>{refund.label}</strong></div>

              <div className="kv-key">
                Proration basis
                <small>{dayCount.effect}</small>
              </div>
              <div className="kv-val"><strong>{dayCount.label}</strong></div>

              <div className="kv-key">
                Minimum term
                <small>
                  {plan.minTermIntervals && plan.minTermIntervals > 0
                    ? 'Cancellation before this many periods is not permitted.'
                    : 'The customer may cancel at any time, subject to the rule above.'}
                </small>
              </div>
              <div className="kv-val">
                <strong>
                  {plan.minTermIntervals && plan.minTermIntervals > 0
                    ? `${plan.minTermIntervals} ${interval.label.toLowerCase()} period${plan.minTermIntervals === 1 ? '' : 's'}`
                    : 'None'}
                </strong>
              </div>

              <div className="kv-key">
                Eligible products
                <small>Only these products can be quoted onto this plan.</small>
              </div>
              <div className="kv-val">
                {plan.eligibleProducts && plan.eligibleProducts.length > 0
                  ? plan.eligibleProducts.map((p) => productName(p.productId)).join(', ')
                  : <span className="muted">None linked yet</span>}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}