import { Link } from 'react-router-dom';
import { formatPaise } from '../api.js';
import { useApiQuery } from '../useApiQuery.js';
import { type Quotation, type QuotationStatus } from '../types.js';
import { ErrorNotice, Empty, Loading } from '../components/States.js';

/**
 * What the customer is actually able to do with a quotation in each state.
 *
 * The portal previously showed a bare status badge, so a DRAFT quotation looked
 * identical to one awaiting the customer's signature — and since the action
 * buttons only render on an actionable quote, their absence read as a missing
 * feature rather than as "your account manager has not sent this yet".
 */
const CUSTOMER_VIEW: Record<string, { label: string; hint: string; canAct: boolean }> = {
  DRAFT: { label: 'Being prepared', hint: 'Your account manager is still building this quotation.', canAct: false },
  PENDING_APPROVAL: { label: 'Under internal review', hint: 'Waiting on internal sign-off before it reaches you.', canAct: false },
  APPROVED: { label: 'Being prepared', hint: 'Approved internally and about to be sent to you.', canAct: false },
  REVISION_REQUIRED: { label: 'Being revised', hint: 'Your account manager is reworking the terms.', canAct: false },
  REJECTED: { label: 'Withdrawn', hint: 'This quotation is no longer being offered.', canAct: false },
  SENT: { label: 'Awaiting your decision', hint: 'Review the items, then accept or request a change.', canAct: true },
  UNDER_NEGOTIATION: { label: 'Your request is being reviewed', hint: 'You can still accept the current terms or send another request.', canAct: true },
  CONFIRMED: { label: 'Accepted', hint: 'You accepted these terms. We are preparing your order.', canAct: false },
  FULFILLMENT: { label: 'Being fulfilled', hint: 'Your order is being allocated and shipped.', canAct: false },
  COMPLETED: { label: 'Completed', hint: 'This order is closed.', canAct: false },
};

function viewFor(status: QuotationStatus) {
  return CUSTOMER_VIEW[status] ?? { label: status, hint: '', canAct: false };
}

export function PortalQuotationsPage() {
  const { data, loading, error } = useApiQuery<{ data: Quotation[] }>('/api/portal/quotations');
  const items = data?.data ?? [];

  const awaiting = items.filter((q) => viewFor(q.status).canAct);
  const rest = items.filter((q) => !viewFor(q.status).canAct);

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0 }}>My quotations</h2>
        <p className="muted" style={{ margin: '2px 0 0' }}>
          Everything your account manager has shared with you.
        </p>
      </div>

      {error && <ErrorNotice error={error} />}

      {awaiting.length > 0 && (
        <div className="notice ok">
          {awaiting.length === 1
            ? 'One quotation is waiting for your decision.'
            : `${awaiting.length} quotations are waiting for your decision.`}
          {' '}Open it to accept the terms or ask for a change.
        </div>
      )}

      {awaiting.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Waiting on you</h3>
          <QuoteTable rows={awaiting} highlight />
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>
          {awaiting.length > 0 ? 'Everything else' : 'All quotations'}
        </h3>
        <QuoteTable rows={rest} />
        {rest.length === 0 && !loading && awaiting.length === 0 && (
          <Empty title="Nothing shared with you yet" hint="Your account manager will send a quotation here when it is ready." />
        )}
        {rest.length === 0 && !loading && awaiting.length > 0 && (
          <div className="muted">Nothing else on file.</div>
        )}
        {loading && <Loading />}
      </div>
    </div>
  );
}

function QuoteTable({ rows, highlight = false }: { rows: Quotation[]; highlight?: boolean }) {
  if (rows.length === 0) return null;
  return (
    <table>
      <thead>
        <tr>
          <th>Quote #</th><th>Where it stands</th><th className="num">Total</th>
          <th>Received</th><th />
        </tr>
      </thead>
      <tbody>
        {rows.map((q) => {
          const view = viewFor(q.status);
          return (
            <tr key={q.id}>
              <td><Link to={`/portal/quotations/${q.id}`}>{q.quoteNumber}</Link></td>
              <td>
                <div>{view.label}</div>
                <div className="muted" style={{ fontSize: 11 }}>{view.hint}</div>
              </td>
              <td className="num">{formatPaise(q.grandTotalPaise)}</td>
              <td className="muted mono">
                {q.sentAt ? new Date(q.sentAt).toLocaleDateString() : '—'}
              </td>
              <td>
                <Link
                  to={`/portal/quotations/${q.id}`}
                  className={highlight && view.canAct ? 'btn' : 'btn secondary'}
                  style={{ textDecoration: 'none' }}
                >
                  {view.canAct ? 'Review & accept' : 'View'}
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}