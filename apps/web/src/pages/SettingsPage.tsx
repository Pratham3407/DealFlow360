import { useMemo, useState } from 'react';
import { api, formatBp, toApiError, type ApiError } from '../api.js';
import { useAuth } from '../auth-context.js';
import { useApiQuery } from '../useApiQuery.js';
import { ErrorNotice, Loading } from '../components/States.js';

interface Setting {
  key: string; value: string; valueType: string;
  group: string; description?: string | null; updatedAt: string;
}

interface Tier {
  id: string; name: string; rank: number;
  defaultDiscountCeilingBp: number; description?: string | null;
}

interface ApprovalRule {
  id: string; name: string; minRiskBp: number; maxRiskBp: number | null;
  requiredLevel: string; priority: number; active: boolean;
}

/**
 * Presentation metadata for the settings table.
 *
 * The raw rows are dotted keys with basis-point integers — `riskWeights.severityWeightBp = 6000`
 * tells an operator nothing about what it does or what a sensible value is. Each
 * key gets a plain-language name, the unit it is really expressed in, and a note
 * on what moving it changes. Anything not listed still renders, using the key and
 * the database description, so a new setting is never hidden.
 */
interface SettingMeta {
  label: string;
  /** How the stored integer should be read. */
  unit: 'percent' | 'days' | 'multiplier' | 'count' | 'raw';
  meaning: string;
}

const SETTING_META: Record<string, SettingMeta> = {
  'riskWeights.severityWeightBp': {
    label: 'Severity weight',
    unit: 'percent',
    meaning: 'How much the single worst ceiling breach drives the risk score. Raise it to make one deep exception escalate on its own.',
  },
  'riskWeights.breadthWeightBp': {
    label: 'Breadth weight',
    unit: 'percent',
    meaning: 'How much the number of breaching lines matters. Raise it to punish many small exceptions rather than one large one.',
  },
  'riskWeights.exposureWeightBp': {
    label: 'Exposure weight',
    unit: 'percent',
    meaning: 'How much the value at risk matters — a breach on a large line scores higher than the same breach on a small one.',
  },
  'riskWeights.orderWeightBp': {
    label: 'Order-discount weight',
    unit: 'percent',
    meaning: 'How much an order-level discount counts, even when every individual line is inside its ceiling.',
  },
  'dealHealth.stalledAfterDays': {
    label: 'Stalled after',
    unit: 'days',
    meaning: 'Days without commercial activity before a live deal is flagged as stalled.',
  },
  'dealHealth.anomalyVsHistoricalMultiplierBp': {
    label: 'Discount anomaly threshold',
    unit: 'multiplier',
    meaning: "How far above a rep's own historical average a discount must sit before it is treated as an anomaly. 1.5× means fifty percent above their norm.",
  },
  'dealHealth.deliverySlippageDays': {
    label: 'Delivery slippage tolerance',
    unit: 'days',
    meaning: 'Days the projected delivery may trail the promised date before the deal is flagged.',
  },
  'billing.scheduleHorizon': {
    label: 'Billing periods generated',
    unit: 'count',
    meaning: 'How many future periods are written per subscription when billing is generated.',
  },
};

const GROUP_LABEL: Record<string, string> = {
  risk: 'Risk scoring',
  dealHealth: 'Deal health monitoring',
  billing: 'Billing',
};

const GROUP_INTRO: Record<string, string> = {
  risk: 'Four weights decide how a quotation\u2019s exceptions combine into one risk score. The score is then matched against the approval bands below.',
  dealHealth: 'Thresholds the background sweep uses to decide when a live deal has stopped behaving.',
  billing: 'How far ahead recurring billing is scheduled.',
};

/** Turn the stored integer into the unit an operator actually thinks in. */
function displayValue(meta: SettingMeta | undefined, raw: string): string {
  const n = Number(raw);
  if (meta === undefined || !Number.isFinite(n)) return raw;
  switch (meta.unit) {
    case 'percent': return `${(n / 100).toFixed(n % 100 === 0 ? 0 : 2)}%`;
    case 'multiplier': return `${(n / 10_000).toFixed(2)}×`;
    case 'days': return `${n} day${n === 1 ? '' : 's'}`;
    case 'count': return `${n}`;
    default: return raw;
  }
}

/** The editable form of the value, in the same unit shown to the operator. */
function editValue(meta: SettingMeta | undefined, raw: string): string {
  const n = Number(raw);
  if (meta === undefined || !Number.isFinite(n)) return raw;
  if (meta.unit === 'percent') return String(n / 100);
  if (meta.unit === 'multiplier') return String(n / 10_000);
  return String(n);
}

/** Convert an edited value back into the integer the API stores. */
function storeValue(meta: SettingMeta | undefined, input: string): string {
  const n = Number.parseFloat(input);
  if (meta === undefined || !Number.isFinite(n)) return input;
  if (meta.unit === 'percent') return String(Math.round(n * 100));
  if (meta.unit === 'multiplier') return String(Math.round(n * 10_000));
  return String(Math.round(n));
}

function unitSuffix(meta: SettingMeta | undefined): string {
  switch (meta?.unit) {
    case 'percent': return '%';
    case 'multiplier': return '×';
    case 'days': return 'days';
    default: return '';
  }
}

export function SettingsPage() {
  const { session } = useAuth();
  const settings = useApiQuery<{ data: Setting[] }>('/api/settings');
  const tiers = useApiQuery<{ data: Tier[] }>('/api/tiers');
  const rules = useApiQuery<{ data: ApprovalRule[] }>('/api/approval-rules');

  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const canEdit = session?.role === 'ADMIN';

  const grouped = useMemo(() => {
    const rows = settings.data?.data ?? [];
    const byGroup = new Map<string, Setting[]>();
    for (const row of rows) {
      const list = byGroup.get(row.group) ?? [];
      list.push(row);
      byGroup.set(row.group, list);
    }
    // Known groups first in a deliberate order, then anything new.
    const order = ['risk', 'dealHealth', 'billing'];
    return [...byGroup.entries()].sort(
      (a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99),
    );
  }, [settings.data]);

  async function save(key: string, value: string, valueType: string) {
    setBusy(key);
    setError(null);
    try {
      await api(`/api/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: { value, valueType } });
      settings.refetch();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(null);
    }
  }

  const sortedRules = [...(rules.data?.data ?? [])].sort((a, b) => a.minRiskBp - b.minRiskBp);

  return (
    <div>
      <h2>Settings</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {canEdit
          ? 'Engine calibration. Changing a value affects future recalculations; quotations keep the numbers they were last scored against until they are recalculated.'
          : 'Read-only. Only an Admin can change engine calibration.'}
      </p>

      {error && <ErrorNotice error={error} />}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Your account</h3>
        <div className="kv">
          <div className="kv-key">Name</div>
          <div className="kv-val">{session?.name}</div>
          <div className="kv-key">Email</div>
          <div className="kv-val mono">{session?.email}</div>
          <div className="kv-key">Role</div>
          <div className="kv-val">{session?.role}</div>
        </div>
      </div>

      {grouped.map(([group, rows]) => (
        <div className="card" key={group}>
          <h3 style={{ marginTop: 0 }}>{GROUP_LABEL[group] ?? group}</h3>
          {GROUP_INTRO[group] && (
            <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>{GROUP_INTRO[group]}</p>
          )}
          <div className="kv">
            {rows.map((row) => (
              <SettingRow
                key={row.key}
                setting={row}
                canEdit={canEdit}
                busy={busy}
                onSave={(value) => save(row.key, value, row.valueType)}
              />
            ))}
          </div>
        </div>
      ))}

      {settings.loading && <div className="card"><Loading label="Loading settings…" /></div>}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Approval bands</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
          Where a quotation&rsquo;s risk score lands decides who must sign it off. Edit these on the
          Governance page.
        </p>
        {rules.loading ? (
          <Loading />
        ) : (
          <table>
            <thead>
              <tr><th>Risk score</th><th>Requires</th><th>Rule</th><th>Active</th></tr>
            </thead>
            <tbody>
              {sortedRules.map((r) => (
                <tr key={r.id}>
                  <td className="mono">
                    {formatBp(r.minRiskBp)} {r.maxRiskBp === null ? 'and above' : `to ${formatBp(r.maxRiskBp)}`}
                  </td>
                  <td>
                    {r.requiredLevel === 'NONE'
                      ? 'No approval — auto-approved'
                      : r.requiredLevel === 'MANAGER'
                        ? 'Sales Manager'
                        : 'Sales Manager, then Finance'}
                  </td>
                  <td className="muted">{r.name}</td>
                  <td><span className={`badge ${r.active ? 'approved' : 'draft'}`}>{r.active ? 'ON' : 'OFF'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Customer tiers</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
          The fallback discount ceiling for a customer when no category-specific rule matches.
        </p>
        {tiers.loading ? (
          <Loading />
        ) : (
          <table>
            <thead><tr><th>Tier</th><th className="num">Rank</th><th className="num">Default ceiling</th><th>Notes</th></tr></thead>
            <tbody>
              {[...(tiers.data?.data ?? [])].sort((a, b) => a.rank - b.rank).map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="num muted">{t.rank}</td>
                  <td className="num">{formatBp(t.defaultDiscountCeilingBp)}</td>
                  <td className="muted">{t.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SettingRow({ setting, canEdit, busy, onSave }: {
  setting: Setting;
  canEdit: boolean;
  busy: string | null;
  onSave: (value: string) => void;
}) {
  const meta = SETTING_META[setting.key];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => editValue(meta, setting.value));

  const saving = busy === setting.key;

  return (
    <>
      <div className="kv-key">
        {meta?.label ?? setting.key}
        <small>{meta?.meaning ?? setting.description ?? setting.key}</small>
        {meta && <small className="mono">{setting.key}</small>}
      </div>
      <div className="kv-val">
        {editing ? (
          <>
            <input
              type="number"
              step="any"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{ width: 110 }}
              autoFocus
            />
            <span className="muted">{unitSuffix(meta)}</span>
            <button
              disabled={saving}
              onClick={() => { onSave(storeValue(meta, draft)); setEditing(false); }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              className="btn secondary"
              onClick={() => { setDraft(editValue(meta, setting.value)); setEditing(false); }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <strong>{displayValue(meta, setting.value)}</strong>
            <span className="muted mono" style={{ fontSize: 11 }}>stored as {setting.value}</span>
            {canEdit && (
              <button className="btn secondary" onClick={() => setEditing(true)}>Edit</button>
            )}
          </>
        )}
      </div>
    </>
  );
}