import { useState, type FormEvent } from 'react';
import { api, formatBp, percentToBp, toApiError, type ApiError } from '../api.js';
import { useAuth } from '../auth-context.js';
import { useApiQuery } from '../useApiQuery.js';
import { type Product } from '../types.js';
import { ErrorNotice, Empty, Loading } from '../components/States.js';

/**
 * Governance configuration.
 *
 * These three tables are the inputs the engines read: discount rules set the
 * ceilings every violation is measured against, and pairings plus promotions are
 * what the recommendation engine ranks. They are grouped on one page because
 * changing one without seeing the others is how ceilings drift out of step.
 */
type Tab = 'discounts' | 'pairings' | 'promotions';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'discounts', label: 'Discount Rules' },
  { key: 'pairings', label: 'Product Pairings' },
  { key: 'promotions', label: 'Promotions' },
];

const CONFIG_ADMINS = ['ADMIN', 'SALES_MANAGER'];

export function GovernancePage() {
  const [tab, setTab] = useState<Tab>('discounts');

  return (
    <div>
      <h2>Governance</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Discount ceilings and recommendation inputs.
      </p>
      <div className="tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={t.key === tab}
            className={t.key === tab ? 'is-active' : ''}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'discounts' && <DiscountRules />}
      {tab === 'pairings' && <Pairings />}
      {tab === 'promotions' && <Promotions />}
    </div>
  );
}

interface Tier { id: string; name: string; defaultDiscountCeilingBp: number }
interface Category { id: string; name: string }

interface DiscountRule {
  id: string; name: string;
  customerTierId: string | null; categoryId: string | null;
  maxDiscountBp: number; priority: number; active: boolean;
}

function DiscountRules() {
  const { session } = useAuth();
  const rules = useApiQuery<{ data: DiscountRule[] }>('/api/discount-rules');
  const tiers = useApiQuery<{ data: Tier[] }>('/api/tiers');
  const categories = useApiQuery<{ data: Category[] }>('/api/categories');

  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const canEdit = CONFIG_ADMINS.includes(session?.role ?? '');
  const tierName = (id: string | null) => (id ? tiers.data?.data.find(t => t.id === id)?.name ?? id : 'Any tier');
  const catName = (id: string | null) => (id ? categories.data?.data.find(c => c.id === id)?.name ?? id : 'Any category');

  async function save(label: string, path: string, method: 'POST' | 'PATCH', body: unknown) {
    setBusy(label);
    setError(null);
    try {
      await api(path, { method, body });
      setShowNew(false);
      rules.refetch();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(null);
    }
  }

  const items = [...(rules.data?.data ?? [])].sort((a, b) => b.priority - a.priority);

  return (
    <>
      {error && <ErrorNotice error={error} />}

      <div className="card">
        <div className="row between" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Discount Ceilings</h3>
          {canEdit && <button onClick={() => setShowNew(v => !v)}>+ New rule</button>}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
          Most specific match wins. Priced lines keep their ceiling until recalculated.
        </p>
        <table>
          <thead><tr><th className="num">Priority</th><th>Name</th><th>Tier</th><th>Category</th><th className="num">Max discount</th><th>Active</th>{canEdit && <th />}</tr></thead>
          <tbody>
            {items.map(r => (
              <DiscountRuleRow key={r.id} rule={r} canEdit={canEdit} busy={busy}
                tierName={tierName(r.customerTierId)} catName={catName(r.categoryId)}
                onSave={(body) => save(`r-${r.id}`, `/api/discount-rules/${r.id}`, 'PATCH', body)} />
            ))}
          </tbody>
        </table>
        {items.length === 0 && !rules.loading && <Empty title="No discount rules" hint="Without a rule, each customer falls back to their tier default ceiling." />}
        {rules.loading && <Loading />}
      </div>

      {showNew && canEdit && (
        <NewDiscountRuleForm
          tiers={tiers.data?.data ?? []}
          categories={categories.data?.data ?? []}
          busy={busy}
          onSubmit={(body) => save('new-rule', '/api/discount-rules', 'POST', body)}
          onCancel={() => setShowNew(false)}
        />
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Tier Defaults</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>Fallback ceiling when no rule above matches.</p>
        <table>
          <thead><tr><th>Tier</th><th className="num">Default ceiling</th></tr></thead>
          <tbody>
            {(tiers.data?.data ?? []).map(t => (
              <tr key={t.id}><td>{t.name}</td><td className="num">{formatBp(t.defaultDiscountCeilingBp)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DiscountRuleRow({ rule, canEdit, busy, tierName, catName, onSave }: {
  rule: DiscountRule; canEdit: boolean; busy: string | null;
  tierName: string; catName: string;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [maxDiscount, setMaxDiscount] = useState((rule.maxDiscountBp / 100).toString());
  const [priority, setPriority] = useState(String(rule.priority));

  if (editing) {
    return (
      <tr>
        <td><input type="number" value={priority} onChange={e => setPriority(e.target.value)} style={{ width: 70 }} /></td>
        <td>{rule.name}</td>
        <td className="muted">{tierName}</td>
        <td className="muted">{catName}</td>
        <td><input type="number" step="0.01" min="0" max="100" value={maxDiscount} onChange={e => setMaxDiscount(e.target.value)} style={{ width: 90 }} /></td>
        <td><span className={`badge ${rule.active ? 'approved' : 'draft'}`}>{rule.active ? 'ON' : 'OFF'}</span></td>
        <td>
          <div className="row" style={{ gap: 4 }}>
            <button disabled={busy !== null}
              onClick={() => { onSave({ maxDiscountBp: percentToBp(maxDiscount), priority: Number.parseInt(priority, 10) || 0 }); setEditing(false); }}>
              {busy === `r-${rule.id}` ? 'Saving…' : 'Save'}
            </button>
            <button className="btn secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="muted">{rule.priority}</td>
      <td>{rule.name}</td>
      <td className="muted">{tierName}</td>
      <td className="muted">{catName}</td>
      <td><strong>{formatBp(rule.maxDiscountBp)}</strong></td>
      <td><span className={`badge ${rule.active ? 'approved' : 'draft'}`}>{rule.active ? 'ON' : 'OFF'}</span></td>
      {canEdit && (
        <td>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn secondary" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn secondary" disabled={busy !== null} onClick={() => onSave({ active: !rule.active })}>
              {rule.active ? 'Disable' : 'Enable'}
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

function NewDiscountRuleForm({ tiers, categories, busy, onSubmit, onCancel }: {
  tiers: Tier[]; categories: Category[]; busy: string | null;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [tierId, setTierId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [maxDiscount, setMaxDiscount] = useState('');
  const [priority, setPriority] = useState('10');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !maxDiscount.trim()) return;
    onSubmit({
      name: name.trim(),
      customerTierId: tierId || null,
      categoryId: categoryId || null,
      maxDiscountBp: percentToBp(maxDiscount),
      priority: Number.parseInt(priority, 10) || 0,
      active: true,
    });
  }

  return (
    <form className="card" onSubmit={submit} style={{ borderColor: 'var(--accent)' }}>
      <h3 style={{ marginTop: 0 }}>New discount rule</h3>
      <div className="grid grid-2">
        <div>
          <label htmlFor="drname">Name</label>
          <input id="drname" value={name} onChange={e => setName(e.target.value)} placeholder="Gold · Hardware" required />
        </div>
        <div>
          <label htmlFor="drmax">Max discount %</label>
          <input id="drmax" type="number" step="0.01" min="0" max="100" value={maxDiscount} onChange={e => setMaxDiscount(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="drtier">Customer tier</label>
          <select id="drtier" value={tierId} onChange={e => setTierId(e.target.value)}>
            <option value="">Any tier</option>
            {tiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="drcat">Category</label>
          <select id="drcat" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            <option value="">Any category</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="drprio">Priority</label>
          <input id="drprio" type="number" value={priority} onChange={e => setPriority(e.target.value)} />
        </div>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button type="submit" disabled={busy !== null}>{busy === 'new-rule' ? 'Creating…' : 'Create rule'}</button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Higher priority wins. A rule naming both a tier and a category is the most specific.
      </div>
    </form>
  );
}

interface Pairing { productId: string; recommendedProductId: string; weight: number }

function Pairings() {
  const { session } = useAuth();
  const pairings = useApiQuery<{ data: Pairing[] }>('/api/pairings');
  const products = useApiQuery<{ data: Product[] }>('/api/products');

  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [productId, setProductId] = useState('');
  const [recommendedProductId, setRecommendedProductId] = useState('');
  const [weight, setWeight] = useState('10');

  const canEdit = CONFIG_ADMINS.includes(session?.role ?? '');
  const list = products.data?.data ?? [];
  const name = (id: string) => list.find(p => p.id === id)?.name ?? id;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!productId || !recommendedProductId || productId === recommendedProductId) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/pairings', {
        method: 'POST',
        body: { productId, recommendedProductId, weight: Number.parseInt(weight, 10) || 1 },
      });
      setProductId('');
      setRecommendedProductId('');
      pairings.refetch();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  }

  const items = [...(pairings.data?.data ?? [])].sort((a, b) => b.weight - a.weight);

  return (
    <>
      {error && <ErrorNotice error={error} />}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Product Pairings</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
          Weight ranks competing suggestions.
        </p>
        <table>
          <thead><tr><th>Anchor product</th><th>Recommends</th><th className="num">Weight</th></tr></thead>
          <tbody>
            {items.map(p => (
              <tr key={`${p.productId}-${p.recommendedProductId}`}>
                <td>{name(p.productId)}</td>
                <td>{name(p.recommendedProductId)}</td>
                <td>{p.weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && !pairings.loading && <Empty title="No pairings configured" hint="The recommendation engine reads these, so it has nothing to suggest yet." />}
        {pairings.loading && <Loading />}
      </div>

      {canEdit && (
        <form className="card" onSubmit={submit}>
          <h3 style={{ marginTop: 0 }}>Add a pairing</h3>
          <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="panchor">When the quote contains</label>
              <select id="panchor" value={productId} onChange={e => setProductId(e.target.value)} required>
                <option value="">Select a product…</option>
                {list.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="prec">Recommend</label>
              <select id="prec" value={recommendedProductId} onChange={e => setRecommendedProductId(e.target.value)} required>
                <option value="">Select a product…</option>
                {list.filter(p => p.id !== productId).map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
              </select>
            </div>
            <div style={{ width: 110 }}>
              <label htmlFor="pw">Weight</label>
              <input id="pw" type="number" min="1" value={weight} onChange={e => setWeight(e.target.value)} />
            </div>
            <button type="submit" disabled={busy || !productId || !recommendedProductId}>
              {busy ? 'Adding…' : 'Add pairing'}
            </button>
          </div>
        </form>
      )}
    </>
  );
}

interface Promotion {
  id: string; label: string; productId: string; priority: number;
  startsAt: string | null; endsAt: string | null; active: boolean;
}

function Promotions() {
  const { session } = useAuth();
  const promos = useApiQuery<{ data: Promotion[] }>('/api/promotions');
  const products = useApiQuery<{ data: Product[] }>('/api/products');

  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [productId, setProductId] = useState('');
  const [priority, setPriority] = useState('10');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');

  const canEdit = CONFIG_ADMINS.includes(session?.role ?? '');
  const list = products.data?.data ?? [];
  const name = (id: string) => list.find(p => p.id === id)?.name ?? id;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!label.trim() || !productId) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        label: label.trim(),
        productId,
        priority: Number.parseInt(priority, 10) || 0,
        active: true,
      };
      if (startsAt) body.startsAt = new Date(startsAt).toISOString();
      if (endsAt) body.endsAt = new Date(endsAt).toISOString();
      await api('/api/promotions', { method: 'POST', body });
      setLabel('');
      setProductId('');
      setStartsAt('');
      setEndsAt('');
      promos.refetch();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  }

  const items = [...(promos.data?.data ?? [])].sort((a, b) => b.priority - a.priority);

  return (
    <>
      {error && <ErrorNotice error={error} />}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Promotions</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
          Shown alongside a recommendation; highest priority wins.
        </p>
        <table>
          <thead><tr><th className="num">Priority</th><th>Label</th><th>Product</th><th>Runs</th><th>Active</th></tr></thead>
          <tbody>
            {items.map(p => (
              <tr key={p.id}>
                <td className="muted">{p.priority}</td>
                <td>{p.label}</td>
                <td>{name(p.productId)}</td>
                <td className="muted mono">
                  {p.startsAt ? new Date(p.startsAt).toLocaleDateString() : 'always'}
                  {' → '}
                  {p.endsAt ? new Date(p.endsAt).toLocaleDateString() : 'always'}
                </td>
                <td><span className={`badge ${p.active ? 'approved' : 'draft'}`}>{p.active ? 'ON' : 'OFF'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && !promos.loading && <Empty title="No promotions configured" hint="A promotion adds a label alongside a recommended product." />}
        {promos.loading && <Loading />}
      </div>

      {canEdit && (
        <form className="card" onSubmit={submit}>
          <h3 style={{ marginTop: 0 }}>Add a promotion</h3>
          <div className="grid grid-2">
            <div>
              <label htmlFor="plabel">Label</label>
              <input id="plabel" value={label} onChange={e => setLabel(e.target.value)} placeholder="Q3 attach offer — 5% off" required />
            </div>
            <div>
              <label htmlFor="pprod">Product</label>
              <select id="pprod" value={productId} onChange={e => setProductId(e.target.value)} required>
                <option value="">Select a product…</option>
                {list.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="pstart">Starts (optional)</label>
              <input id="pstart" type="date" value={startsAt} onChange={e => setStartsAt(e.target.value)} />
            </div>
            <div>
              <label htmlFor="pend">Ends (optional)</label>
              <input id="pend" type="date" value={endsAt} onChange={e => setEndsAt(e.target.value)} />
            </div>
            <div>
              <label htmlFor="pprio">Priority</label>
              <input id="pprio" type="number" value={priority} onChange={e => setPriority(e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button type="submit" disabled={busy || !label.trim() || !productId}>{busy ? 'Adding…' : 'Add promotion'}</button>
          </div>
        </form>
      )}
    </>
  );
}