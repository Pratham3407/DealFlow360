import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatBp, formatPaise, toApiError, type ApiError } from '../api.js';
import { useAuth } from '../auth-context.js';
import { useApiQuery } from '../useApiQuery.js';
import { type DealHealthEvent, type Quotation } from '../types.js';
import { Empty, Loading, ErrorNotice } from '../components/States.js';

type EventRow = DealHealthEvent & {
  nudgeCount: number;
  quotation?: (Quotation & { quoteNumber: string }) | null;
};

/**
 * What each alert type means and what the next move is.
 *
 * The raw feed was a table of enum names and timestamps — accurate but it did not
 * say what a STALLED event *is*, who is expected to act, or what nudging does.
 * The remedy is stated per type so the page reads as a worklist rather than a log.
 */
const ALERT_KINDS = {
  STALLED: {
    title: 'Stalled deal',
    what: 'No commercial movement on this quotation for longer than the configured window.',
    remedy: 'Nudge to record a follow-up, or escalate if the account needs a manager.',
  },
  DISCOUNT_ANOMALY: {
    title: 'Discount anomaly',
    what: 'The quotation is live with one or more lines still priced at or beyond their ceiling.',
    remedy: 'Re-price the line, or escalate so the exception is reviewed deliberately.',
  },
  DELIVERY_SLIPPAGE: {
    title: 'Delivery slippage',
    what: 'The projected delivery date has drifted past what was promised to the customer.',
    remedy: 'Re-plan the allocation, or escalate so the customer can be told early.',
  },
} as const;

type Stage = 'new' | 'nudged' | 'escalated' | 'resolved';

interface Triaged {
  event: EventRow;
  stage: Stage;
  ageDays: number;
}

const STAGE_LABEL: Record<Stage, string> = {
  new: 'Untouched',
  nudged: 'Followed up',
  escalated: 'Escalated',
  resolved: 'Resolved',
};

/** Progression of an alert. Resolution is automatic when the cause disappears. */
function stageOf(e: EventRow): Stage {
  if (e.resolvedAt) return 'resolved';
  if (e.escalatedAt) return 'escalated';
  if (e.nudgedAt) return 'nudged';
  return 'new';
}

function ageInDays(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export function DealHealthPage() {
  const { session } = useAuth();
  const [showResolved, setShowResolved] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'' | keyof typeof ALERT_KINDS>('');

  const { data, loading, error: loadError, refetch } = useApiQuery<{ data: EventRow[] }>(
    `/api/deal-health?openOnly=${!showResolved}`,
  );

  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Short-lived confirmation, so an action that only changes a timestamp is visibly acknowledged. */
  const [flash, setFlash] = useState<{ id: string; text: string } | null>(null);

  const canSweep = ['SALES_MANAGER', 'ADMIN'].includes(session?.role ?? '');
  const canNudge = ['SALES_REP', 'SALES_MANAGER', 'ADMIN'].includes(session?.role ?? '');
  const canEscalate = ['SALES_MANAGER', 'ADMIN'].includes(session?.role ?? '');

  const triaged = useMemo<Triaged[]>(() => {
    const rows = data?.data ?? [];
    return rows
      .map((event) => ({ event, stage: stageOf(event), ageDays: ageInDays(event.createdAt) }))
      .filter((t) => (typeFilter ? t.event.type === typeFilter : true))
      .sort((a, b) => {
        // Unresolved first, then by severity, then oldest — the order you work them.
        const openRank = (t: Triaged) => (t.stage === 'resolved' ? 1 : 0);
        const sevRank = (t: Triaged) => ({ HIGH: 0, MEDIUM: 1, LOW: 2 })[t.event.severity] ?? 3;
        return openRank(a) - openRank(b) || sevRank(a) - sevRank(b) || b.ageDays - a.ageDays;
      });
  }, [data, typeFilter]);

  const open = triaged.filter((t) => t.stage !== 'resolved');
  const counts = {
    high: open.filter((t) => t.event.severity === 'HIGH').length,
    untouched: open.filter((t) => t.stage === 'new').length,
    escalated: open.filter((t) => t.stage === 'escalated').length,
  };

  async function act(label: string, path: string, confirmation?: { id: string; text: string }) {
    setBusy(label);
    setError(null);
    setFlash(null);
    try {
      await api(path, { method: 'POST', body: {} });
      refetch();
      if (confirmation) {
        setFlash(confirmation);
        window.setTimeout(() => setFlash(null), 4000);
      }
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="row between" style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>Deal Health</h2>
        {canSweep && (
          <button disabled={busy !== null} onClick={() => act('sweep', '/api/deal-health/sweep', { id: 'sweep', text: 'Sweep finished — the list below is current.' })}>
            {busy === 'sweep' ? 'Scanning…' : 'Re-scan now'}
          </button>
        )}
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Highest severity first, then oldest.
      </p>

      {loadError && <ErrorNotice error={loadError} />}
      {error && <ErrorNotice error={error} />}
      {flash?.id === 'sweep' && <div className="notice ok">{flash.text}</div>}

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="kpi-label">Open alerts</div>
          <div className="kpi">{open.length}</div>
        </div>
        <div className="card">
          <div className="kpi-label">High severity</div>
          <div className="kpi" style={{ color: counts.high ? 'var(--danger)' : undefined }}>{counts.high}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Not yet actioned</div>
          <div className="kpi" style={{ color: counts.untouched ? 'var(--warning)' : undefined }}>{counts.untouched}</div>
        </div>
      </div>

      <div className="card">
        <div className="row between" style={{ gap: 12 }}>
          <div className="tabs" role="tablist" style={{ marginBottom: 0 }}>
            <button
              role="tab"
              aria-selected={typeFilter === ''}
              className={typeFilter === '' ? 'is-active' : ''}
              onClick={() => setTypeFilter('')}
            >
              All types
            </button>
            {(Object.keys(ALERT_KINDS) as Array<keyof typeof ALERT_KINDS>).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={typeFilter === k}
                className={typeFilter === k ? 'is-active' : ''}
                onClick={() => setTypeFilter(k)}
              >
                {ALERT_KINDS[k].title}
              </button>
            ))}
          </div>
          <button className="btn secondary" onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? 'Hide resolved' : 'Show resolved'}
          </button>
        </div>
      </div>

      {loading && <div className="card"><Loading label="Loading alerts…" /></div>}

      {!loading && triaged.length === 0 && (
        <div className="card">
          <Empty
            title={`No ${typeFilter ? ALERT_KINDS[typeFilter].title.toLowerCase() : 'open'} alerts`}
            hint="Every live deal is behaving as expected."
          />
        </div>
      )}

      {triaged.map(({ event, stage, ageDays }) => {
        const kind = ALERT_KINDS[event.type as keyof typeof ALERT_KINDS];
        const sevClass = event.severity === 'HIGH' ? 'rejected' : event.severity === 'MEDIUM' ? 'revision' : 'draft';
        const resolved = stage === 'resolved';

        return (
          <div key={event.id} className="card" style={resolved ? { opacity: 0.62 } : undefined}>
            <div className="row between" style={{ marginBottom: 6 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15 }}>
                  <span className={`badge ${sevClass}`} style={{ marginRight: 8 }}>{event.severity}</span>
                  {kind?.title ?? event.type}
                  {event.quotation?.quoteNumber && (
                    <>
                      {' — '}
                      <Link to={`/quotations/${event.quotationId}`}>{event.quotation.quoteNumber}</Link>
                    </>
                  )}
                </h3>
                <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                  {STAGE_LABEL[stage]} · raised {ageDays === 0 ? 'today' : `${ageDays} day${ageDays === 1 ? '' : 's'} ago`}
                  {event.nudgeCount > 0 && ` · ${event.nudgeCount} follow-up${event.nudgeCount === 1 ? '' : 's'} logged`}
                  {event.quotation && ` · ${formatPaise(event.quotation.grandTotalPaise)} at ${formatBp(event.quotation.marginBp)} margin`}
                </div>
              </div>
              {!resolved && (
                <div className="row" style={{ gap: 6 }}>
                  {canNudge && (
                    <button
                      className="btn secondary"
                      disabled={busy !== null}
                      title="Record that you have chased this — the alert stays open"
                      onClick={() =>
                        act(
                          `nudge-${event.id}`,
                          `/api/deal-health/${event.id}/nudge`,
                          { id: event.id, text: `Follow-up ${event.nudgeCount + 1} logged just now.` },
                        )
                      }
                    >
                      {busy === `nudge-${event.id}`
                        ? 'Recording…'
                        : event.nudgeCount === 0
                          ? 'Log follow-up'
                          : `Log follow-up #${event.nudgeCount + 1}`}
                    </button>
                  )}
                  {canEscalate && !event.escalatedAt && (
                    <button
                      disabled={busy !== null}
                      title="Hand this to management"
                      onClick={() =>
                        act(
                          `esc-${event.id}`,
                          `/api/deal-health/${event.id}/escalate`,
                          { id: event.id, text: 'Escalated to management.' },
                        )
                      }
                    >
                      {busy === `esc-${event.id}` ? 'Escalating…' : 'Escalate'}
                    </button>
                  )}
                </div>
              )}
            </div>

            {flash?.id === event.id && <div className="notice ok">{flash.text}</div>}

            <div className="notice" style={{ marginBottom: 8 }}>
              <div><strong>{event.title}</strong></div>
              <div className="muted" style={{ marginTop: 2 }}>{event.detail}</div>
            </div>

            <div className="grid grid-2">
              <div>
                <div className="kpi-label">Why this was raised</div>
                <div className="muted" style={{ fontSize: 12 }}>{kind?.what ?? '—'}</div>
              </div>
              <div>
                <div className="kpi-label">{resolved ? 'How it closed' : 'What to do'}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {resolved
                    ? `Cleared automatically on ${new Date(event.resolvedAt!).toLocaleDateString()} — the underlying cause no longer holds.`
                    : kind?.remedy ?? '—'}
                </div>
              </div>
            </div>

            <div className="muted" style={{ fontSize: 11, marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              Raised {new Date(event.createdAt).toLocaleString()}
              {event.nudgedAt && ` · last followed up ${new Date(event.nudgedAt).toLocaleString()} (${event.nudgeCount} total)`}
              {event.escalatedAt && ` · escalated ${new Date(event.escalatedAt).toLocaleString()}`}
              {event.resolvedAt && ` · resolved ${new Date(event.resolvedAt).toLocaleString()}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}