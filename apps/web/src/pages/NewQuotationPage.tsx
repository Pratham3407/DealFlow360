import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatBp, percentToBp, toApiError, type ApiError } from '../api.js';
import { useApiQuery } from '../useApiQuery.js';
import { type Customer, type Quotation } from '../types.js';
import { ErrorNotice } from '../components/States.js';

/**
 * Step one of building a quote: pick the customer and the header terms. Lines
 * are added on the detail page, because every line insert re-runs pricing and
 * the risk engine server-side and the result has to be shown as it happens.
 */
export function NewQuotationPage() {
  const navigate = useNavigate();
  const { data: customerData, loading: loadingCustomers } = useApiQuery<{ data: Customer[] }>('/api/customers');
  const customers = customerData?.data ?? [];

  const [customerId, setCustomerId] = useState('');
  const [notes, setNotes] = useState('');
  const [promisedDeliveryDate, setPromisedDeliveryDate] = useState('');
  const [orderDiscount, setOrderDiscount] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = customers.find(c => c.id === customerId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!customerId) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { customerId };
      if (notes.trim()) body.notes = notes.trim();
      if (promisedDeliveryDate) body.promisedDeliveryDate = new Date(promisedDeliveryDate).toISOString();
      if (orderDiscount.trim()) body.orderDiscountBp = percentToBp(orderDiscount);

      const res = await api<{ quote: Quotation }>('/api/quotations', { method: 'POST', body });
      navigate(`/quotations/${res.quote.id}`, { replace: true });
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Link to="/quotations" className="muted">← Back to quotations</Link>
      <h2 style={{ marginTop: 10 }}>New quotation</h2>

      {error && <ErrorNotice error={error} />}

      <form className="card" onSubmit={submit} style={{ maxWidth: 640 }}>
        <div className="col">
          <div>
            <label htmlFor="customer">Customer</label>
            <select id="customer" value={customerId} onChange={e => setCustomerId(e.target.value)} required>
              <option value="">
                {loadingCustomers ? 'Loading customers…' : 'Select a customer…'}
              </option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
              ))}
            </select>
            {selected?.tier && (
              <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                Tier {selected.tier.name} · default discount ceiling {formatBp(selected.tier.defaultDiscountCeilingBp)}
              </div>
            )}
          </div>

          <div>
            <label htmlFor="promised">Promised delivery date <span className="muted">(optional)</span></label>
            <input id="promised" type="date" value={promisedDeliveryDate} onChange={e => setPromisedDeliveryDate(e.target.value)} />
          </div>

          <div>
            <label htmlFor="orderDiscount">Order-level discount % <span className="muted">(optional)</span></label>
            <input id="orderDiscount" type="number" step="0.01" min="0" max="100" placeholder="0" value={orderDiscount} onChange={e => setOrderDiscount(e.target.value)} />
            <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
              Applies on top of per-line discounts and feeds the risk score.
            </div>
          </div>

          <div>
            <label htmlFor="notes">Notes <span className="muted">(optional)</span></label>
            <textarea id="notes" rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <div className="row" style={{ gap: 8 }}>
            <button type="submit" disabled={busy || !customerId}>{busy ? 'Creating…' : 'Create draft'}</button>
            <Link to="/quotations" className="btn secondary" style={{ textDecoration: 'none' }}>Cancel</Link>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            The draft is created empty — you add products on the next screen.
          </div>
        </div>
      </form>
    </div>
  );
}