import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatBp, formatPaise, toApiError, type ApiError } from '../api.js';
import { useAuth } from '../auth-context.js';
import { useApiQuery } from '../useApiQuery.js';
import { type ApprovalInstance, type Quotation, type Role } from '../types.js';

type ApprovalRow = ApprovalInstance & { quotation: Quotation | null };

/** Who the API will accept on each rung — mirrors LEVEL_ROLES in approval.service.ts. */
const LEVEL_ROLES: Record<'MANAGER' | 'FINANCE', Role[]> = {
  MANAGER: ['SALES_MANAGER', 'ADMIN'],
  FINANCE: ['FINANCE_OPERATIONS', 'ADMIN'],
};

const LEVEL_LABEL: Record<'MANAGER' | 'FINANCE', string> = {
  MANAGER: 'Sales Manager',
  FINANCE: 'Finance',
};

type StepState = 'done' | 'active' | 'blocked' | 'rejected' | 'returned' | 'superseded';

interface Step {
  rung: ApprovalInstance;
  state: StepState;
  /** True when this user's role is one the API accepts for this rung. */
  mine: boolean;
  /** True when this user can act right now: the step is active and theirs. */
  actionable: boolean;
}

interface Chain {
  quotationId: string;
  quote: Quotation | null;
  attempt: number;
  steps: Step[];
  /** The step the chain is waiting on, if any. */
  activeStep: Step | null;
  settled: boolean;
}

/**
 * Approvals, grouped by quotation rather than by rung.
 *
 * A MANAGER_FINANCE quote raises two rungs, and listing rungs flat showed the
 * same quote twice with an action button on each — so whichever reviewer clicked
 * first appeared to work while the other got a 403 (wrong role for that rung) or
 * a 409 (Finance acting before Manager). Neither error explained itself.
 *
 * The chain is now rendered as an ordered stepper per quote. Exactly one step is
 * active, buttons exist only on the step that is both active and addressed to the
 * signed-in role, and every other step states who it is waiting on. The
 * sequencing rule is the server's; this view makes it visible instead of letting
 * people discover it by hitting an error.
 */
export function ApprovalsPage() {
  const { session } = useAuth();
  // onlyPending=false so resolved rungs are available to render chain history.
  const { data, loading, error: loadError, refetch } = useApiQuery<{ data: ApprovalRow[] }>(
    '/api/approvals?onlyPending=false',
  );

  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<{ rungId: string; action: 'reject' | 'return' } | null>(null);
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState<'mine' | 'open' | 'all'>('mine');

  const role = session?.role;

  const chains = useMemo<Chain[]>(() => {
    const rows = data?.data ?? [];
    const byQuote = new Map<string, ApprovalRow[]>();
    for (const row of rows) {
      const list = byQuote.get(row.quotationId) ?? [];
      list.push(row);
      byQuote.set(row.quotationId, list);
    }

    const built: Chain[] = [];
    for (const [quotationId, rungs] of byQuote) {
      // Only the newest attempt is live; earlier attempts are history.
      const attempt = Math.max(...rungs.map((r) => r.attempt));
      const current = rungs
        .filter((r) => r.attempt === attempt)
        .sort((a, b) => a.sequence - b.sequence);

      const firstPending = current.find((r) => r.status === 'PENDING');

      const steps: Step[] = current.map((rung) => {
        let state: StepState;
        if (rung.status === 'APPROVED') state = 'done';
        else if (rung.status === 'REJECTED') state = 'rejected';
        else if (rung.status === 'REVISION_REQUIRED') state = 'returned';
        else if (rung.status === 'SUPERSEDED') state = 'superseded';
        else state = rung.id === firstPending?.id ? 'active' : 'blocked';

        const mine = role ? LEVEL_ROLES[rung.level].includes(role) : false;
        return { rung, state, mine, actionable: state === 'active' && mine };
      });

      built.push({
        quotationId,
        quote: current[0]?.quotation ?? null,
        attempt,
        steps,
        activeStep: steps.find((s) => s.state === 'active') ?? null,
        settled: !firstPending,
      });
    }

    // Chains needing this user first, then anything still open, then history.
    return built.sort((a, b) => {
      const rank = (c: Chain) => (c.activeStep?.actionable ? 0 : c.activeStep ? 1 : 2);
      return rank(a) - rank(b) || (b.quote?.riskScoreBp ?? 0) - (a.quote?.riskScoreBp ?? 0);
    });
  }, [data, role]);

  const visible = chains.filter((c) => {
    if (scope === 'mine') return c.activeStep?.actionable === true;
    if (scope === 'open') return c.activeStep !== null;
    return true;
  });

  const myCount = chains.filter((c) => c.activeStep?.actionable).length;
  const openCount = chains.filter((c) => c.activeStep).length;

  async function act(rungId: string, action: 'approve' | 'reject' | 'return', body?: unknown) {
    setBusy(`${action}-${rungId}`);
    setError(null);
    try {
      await api(`/api/approvals/${rungId}/${action}`, { method: 'POST', body: body ?? {} });
      setReasonFor(null);
      setReason('');
      refetch();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="row between" style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>Approvals</h2>
        <div className="row" style={{ gap: 8 }}>
          <button className={scope === 'mine' ? '' : 'btn secondary'} onClick={() => setScope('mine')}>
            Needs me ({myCount})
          </button>
          <button className={scope === 'open' ? '' : 'btn secondary'} onClick={() => setScope('open')}>
            All open ({openCount})
          </button>
          <button className={scope === 'all' ? '' : 'btn secondary'} onClick={() => setScope('all')}>
            History ({chains.length})
          </button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Signed in as {role === 'SALES_MANAGER' ? 'Sales Manager' : role === 'FINANCE_OPERATIONS' ? 'Finance' : role}.
        {' '}A high-risk quote needs Sales Manager first, then Finance — in that order.
      </p>

      {loadError && <div className="error">{loadError.code}: {loadError.message}</div>}
      {error && <div className="error">{error.code}: {error.message}</div>}

      {loading && <div className="card muted">Loading…</div>}

      {!loading && visible.length === 0 && (
        <div className="card muted">
          {scope === 'mine'
            ? 'Nothing is waiting on you. Switch to "All open" to see quotes queued behind another reviewer.'
            : scope === 'open'
              ? 'No quotations are awaiting approval.'
              : 'No approvals have been raised yet.'}
        </div>
      )}

      {visible.map((chain) => (
        <ChainCard
          key={chain.quotationId}
          chain={chain}
          role={role}
          busy={busy}
          reasonFor={reasonFor}
          reason={reason}
          setReason={setReason}
          onStartReason={(rungId, action) => { setReasonFor({ rungId, action }); setReason(''); }}
          onCancelReason={() => { setReasonFor(null); setReason(''); }}
          onAct={act}
        />
      ))}
    </div>
  );
}

function ChainCard({ chain, role, busy, reasonFor, reason, setReason, onStartReason, onCancelReason, onAct }: {
  chain: Chain;
  role: Role | undefined;
  busy: string | null;
  reasonFor: { rungId: string; action: 'reject' | 'return' } | null;
  reason: string;
  setReason: (v: string) => void;
  onStartReason: (rungId: string, action: 'reject' | 'return') => void;
  onCancelReason: () => void;
  onAct: (rungId: string, action: 'approve' | 'reject' | 'return', body?: unknown) => void;
}) {
  const q = chain.quote;
  const active = chain.activeStep;

  const banner = (() => {
    if (!active) {
      const stopped = chain.steps.find((s) => s.state === 'rejected' || s.state === 'returned');
      if (stopped?.state === 'rejected') return { cls: 'notice', text: `Rejected by ${LEVEL_LABEL[stopped.rung.level]}. The quotation is closed.` };
      if (stopped?.state === 'returned') return { cls: 'notice warn', text: `Returned for revision by ${LEVEL_LABEL[stopped.rung.level]}. The rep can edit and resubmit.` };
      return { cls: 'notice ok', text: 'Fully approved — every level has signed off.' };
    }
    if (active.actionable) {
      return { cls: 'notice ok', text: `Your decision is needed at the ${LEVEL_LABEL[active.rung.level]} step.` };
    }
    const waitingOn = LEVEL_LABEL[active.rung.level];
    const later = chain.steps.find((s) => s.state === 'blocked' && s.mine);
    return {
      cls: 'notice',
      text: later
        ? `Waiting on ${waitingOn}. Your ${LEVEL_LABEL[later.rung.level]} step unlocks once they approve.`
        : `Waiting on ${waitingOn}. Nothing for you to do on this quotation.`,
    };
  })();

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <div>
          <h3 style={{ margin: 0 }}>
            {q ? <Link to={`/quotations/${chain.quotationId}`}>{q.quoteNumber}</Link> : <span className="mono">{chain.quotationId}</span>}
            {q && <span className={`badge ${q.status.toLowerCase()}`} style={{ marginLeft: 8 }}>{q.status}</span>}
          </h3>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {q?.customer?.name ?? ''} · v{chain.steps[0]?.rung.quotationVersion ?? '?'}
            {chain.attempt > 1 && ` · review round ${chain.attempt}`}
          </div>
        </div>
        {q && (
          <div className="row" style={{ gap: 20 }}>
            <div><div className="kpi-label">Total</div><div>{formatPaise(q.grandTotalPaise)}</div></div>
            <div><div className="kpi-label">Margin</div><div>{formatBp(q.marginBp)}</div></div>
            <div><div className="kpi-label">Risk</div><div>{formatBp(q.riskScoreBp)}</div></div>
          </div>
        )}
      </div>

      <div className={banner.cls}>{banner.text}</div>

      <div className="chain">
        {chain.steps.map((step, i) => (
          <StepCard
            key={step.rung.id}
            step={step}
            index={i}
            total={chain.steps.length}
            role={role}
            busy={busy}
            isReasoning={reasonFor?.rungId === step.rung.id}
            reasonAction={reasonFor?.rungId === step.rung.id ? reasonFor.action : null}
            reason={reason}
            setReason={setReason}
            onStartReason={onStartReason}
            onCancelReason={onCancelReason}
            onAct={onAct}
          />
        ))}
      </div>
    </div>
  );
}

function StepCard({ step, index, total, role, busy, isReasoning, reasonAction, reason, setReason, onStartReason, onCancelReason, onAct }: {
  step: Step;
  index: number;
  total: number;
  role: Role | undefined;
  busy: string | null;
  isReasoning: boolean;
  reasonAction: 'reject' | 'return' | null;
  reason: string;
  setReason: (v: string) => void;
  onStartReason: (rungId: string, action: 'reject' | 'return') => void;
  onCancelReason: () => void;
  onAct: (rungId: string, action: 'approve' | 'reject' | 'return', body?: unknown) => void;
}) {
  const { rung, state, mine, actionable } = step;

  const cls =
    state === 'done' ? 'step done'
    : state === 'active' ? 'step active'
    : state === 'rejected' || state === 'returned' ? 'step stopped'
    : 'step blocked';

  const stateLabel: Record<StepState, string> = {
    done: 'Approved',
    active: 'Awaiting decision',
    blocked: `Locked until step ${index} is approved`,
    rejected: 'Rejected',
    returned: 'Returned for revision',
    superseded: 'No longer required',
  };

  return (
    <div className={cls}>
      <div className="step-head">
        <span className="step-title">
          Step {index + 1} of {total} · {LEVEL_LABEL[rung.level]}
        </span>
        {state === 'active' && (
          <span className={`turn ${actionable ? 'you' : 'other'}`}>
            {actionable ? 'Your turn' : 'Their turn'}
          </span>
        )}
      </div>

      <div className="step-meta">
        <div>{stateLabel[state]}</div>
        {rung.actedAt && <div>Decided {new Date(rung.actedAt).toLocaleString()}</div>}
        {rung.reason && <div>Reason: {rung.reason}</div>}
        {state === 'active' && !mine && (
          <div>Only {LEVEL_ROLES[rung.level].map((r) => (r === 'SALES_MANAGER' ? 'a Sales Manager' : r === 'FINANCE_OPERATIONS' ? 'Finance' : 'an Admin')).join(' or ')} can decide this.</div>
        )}
        {state === 'blocked' && mine && <div>This is yours — it opens after the previous step approves.</div>}
      </div>

      {actionable && !isReasoning && (
        <div className="step-actions">
          <button disabled={busy !== null} onClick={() => onAct(rung.id, 'approve')}>
            {busy === `approve-${rung.id}` ? 'Approving…' : 'Approve'}
          </button>
          <button className="btn secondary" disabled={busy !== null} onClick={() => onStartReason(rung.id, 'return')}>
            Return for revision
          </button>
          <button className="danger" disabled={busy !== null} onClick={() => onStartReason(rung.id, 'reject')}>
            Reject
          </button>
        </div>
      )}

      {isReasoning && reasonAction && (
        <div style={{ marginTop: 10 }}>
          <label htmlFor={`reason-${rung.id}`}>
            {reasonAction === 'reject' ? 'Why are you rejecting?' : 'What needs to change?'}
          </label>
          <textarea
            id={`reason-${rung.id}`}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
          <div className="step-actions">
            <button
              className={reasonAction === 'reject' ? 'danger' : ''}
              disabled={busy !== null || reason.trim().length === 0}
              onClick={() => onAct(rung.id, reasonAction, { reason: reason.trim() })}
            >
              {busy ? 'Submitting…' : reasonAction === 'reject' ? 'Confirm reject' : 'Send back'}
            </button>
            <button className="btn secondary" onClick={onCancelReason}>Cancel</button>
          </div>
          <div className="step-meta" style={{ marginTop: 6 }}>
            Recorded in the audit trail against your name.
          </div>
        </div>
      )}

      {!actionable && state === 'active' && role && (
        <div className="step-actions">
          <button className="btn secondary" disabled title="This step is not addressed to your role">
            Not your step
          </button>
        </div>
      )}
    </div>
  );
}