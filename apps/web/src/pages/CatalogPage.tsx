import { useMemo, useState, type FormEvent } from 'react';
import { api, formatBp, formatPaise, percentToBp, rupeesToPaise, toApiError, type ApiError } from '../api.js';
import { useAuth } from '../auth-context.js';
import { useApiQuery } from '../useApiQuery.js';
import { type Product } from '../types.js';
import { ErrorNotice, Empty, Loading } from '../components/States.js';

interface Category {
  id: string; name: string; description: string | null;
  defaultMarginBp: number; active: boolean;
}

/** Roles the API accepts on product and category writes. */
const CONFIG_ADMINS = ['ADMIN', 'SALES_MANAGER'];

export function CatalogPage() {
  const { session } = useAuth();
  const products = useApiQuery<{ data: Product[] }>('/api/products');
  const categories = useApiQuery<{ data: Category[] }>('/api/categories');

  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pane, setPane] = useState<'none' | 'product' | 'category'>('none');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const canEdit = CONFIG_ADMINS.includes(session?.role ?? '');
  const catList = categories.data?.data ?? [];

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (products.data?.data ?? [])
      .filter((p) => (showInactive ? true : p.active !== false))
      .filter((p) =>
        term === ''
          ? true
          : p.name.toLowerCase().includes(term) ||
            p.sku.toLowerCase().includes(term) ||
            (p.category?.name ?? '').toLowerCase().includes(term),
      )
      .sort((a, b) => (a.category?.name ?? '').localeCompare(b.category?.name ?? '') || a.name.localeCompare(b.name));
  }, [products.data, search, showInactive]);

  async function save(label: string, path: string, method: 'POST' | 'PATCH', body: unknown, after?: () => void) {
    setBusy(label);
    setError(null);
    try {
      await api(path, { method, body });
      products.refetch();
      categories.refetch();
      after?.();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="row between" style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>Catalogue</h2>
        {canEdit && (
          <div className="row" style={{ gap: 8 }}>
            <button className={pane === 'category' ? '' : 'btn secondary'} onClick={() => setPane(pane === 'category' ? 'none' : 'category')}>
              + New category
            </button>
            <button className={pane === 'product' ? '' : 'btn secondary'} onClick={() => setPane(pane === 'product' ? 'none' : 'product')}>
              + New product
            </button>
          </div>
        )}
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {canEdit
          ? 'Products and categories available to quote. A category carries the default margin used when a product has no explicit cost.'
          : 'Read-only. An Admin or Sales Manager can add and edit catalogue items.'}
      </p>

      {error && <ErrorNotice error={error} />}

      {pane === 'category' && canEdit && (
        <NewCategoryForm
          busy={busy}
          onSubmit={(body) => save('new-category', '/api/categories', 'POST', body, () => setPane('none'))}
          onCancel={() => setPane('none')}
        />
      )}

      {pane === 'product' && canEdit && (
        <NewProductForm
          categories={catList}
          busy={busy}
          onSubmit={(body) => save('new-product', '/api/products', 'POST', body, () => setPane('none'))}
          onCancel={() => setPane('none')}
          onNeedCategory={() => setPane('category')}
        />
      )}

      <div className="card">
        <div className="row" style={{ gap: 12 }}>
          <input
            placeholder="Search by name, SKU or category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn secondary" onClick={() => setShowInactive((v) => !v)}>
            {showInactive ? 'Hide inactive' : 'Show inactive'}
          </button>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>SKU</th><th>Product</th><th>Category</th><th>Unit</th>
              <th className="num">Price</th><th className="num">Cost</th><th className="num">Tax</th>
              <th>Billing</th><th>Stock</th>{canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <ProductRow
                key={p.id}
                product={p}
                canEdit={canEdit}
                busy={busy}
                onSave={(body) => save(`p-${p.id}`, `/api/products/${p.id}`, 'PATCH', body)}
              />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !products.loading && (
          <div className="muted">
            {search ? 'No products match that search.' : 'No products yet.'}
            {canEdit && !search && ' Use “+ New product” to add the first one.'}
          </div>
        )}
        {products.loading && <Loading />}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Categories</h3>
        <table>
          <thead><tr><th>Category</th><th className="num">Default margin</th><th>Products</th><th>Description</th></tr></thead>
          <tbody>
            {catList.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="num">{formatBp(c.defaultMarginBp)}</td>
                <td className="num">{(products.data?.data ?? []).filter((p) => p.categoryId === c.id).length}</td>
                <td className="muted">{c.description ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {catList.length === 0 && !categories.loading && <Empty title="No categories yet" hint="A product must belong to a category, so create one first." />}
      </div>
    </div>
  );
}

function ProductRow({ product, canEdit, busy, onSave }: {
  product: Product;
  canEdit: boolean;
  busy: string | null;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState((product.basePricePaise / 100).toFixed(2));
  const [cost, setCost] = useState(product.unitCostPaise === null ? '' : (product.unitCostPaise / 100).toFixed(2));
  const [tax, setTax] = useState((product.taxBp / 100).toString());

  const inactive = product.active === false;

  if (editing) {
    return (
      <tr>
        <td className="mono">{product.sku}</td>
        <td>{product.name}</td>
        <td className="muted">{product.category?.name}</td>
        <td className="muted">{product.unit}</td>
        <td><input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 110 }} /></td>
        <td><input type="number" step="0.01" min="0" placeholder="auto" value={cost} onChange={(e) => setCost(e.target.value)} style={{ width: 100 }} /></td>
        <td><input type="number" step="0.01" min="0" max="100" value={tax} onChange={(e) => setTax(e.target.value)} style={{ width: 80 }} /></td>
        <td className="muted">{product.billingType === 'RECURRING' ? 'Recurring' : 'One-time'}</td>
        <td className="muted">{product.stockTracked ? 'Tracked' : '—'}</td>
        <td>
          <div className="row" style={{ gap: 4 }}>
            <button
              disabled={busy !== null}
              onClick={() => {
                const body: Record<string, unknown> = {
                  basePricePaise: rupeesToPaise(price),
                  taxBp: percentToBp(tax),
                };
                // Blank cost means "fall back to the category margin", which the
                // API models as null rather than as an omitted field.
                body.unitCostPaise = cost.trim() === '' ? null : rupeesToPaise(cost);
                onSave(body);
                setEditing(false);
              }}
            >
              Save
            </button>
            <button className="btn secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr style={inactive ? { opacity: 0.55 } : undefined}>
      <td className="mono">{product.sku}</td>
      <td>
        {product.name}
        {inactive && <span className="badge draft" style={{ marginLeft: 6 }}>INACTIVE</span>}
      </td>
      <td className="muted">{product.category?.name ?? product.categoryId}</td>
      <td className="muted">{product.unit}</td>
      <td className="num">{formatPaise(product.basePricePaise)}</td>
      <td className="num muted">{product.unitCostPaise === null ? 'auto' : formatPaise(product.unitCostPaise)}</td>
      <td className="num muted">{formatBp(product.taxBp)}</td>
      <td className="muted">{product.billingType === 'RECURRING' ? 'Recurring' : 'One-time'}</td>
      <td className="muted">{product.stockTracked ? 'Tracked' : '—'}</td>
      {canEdit && (
        <td>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn secondary" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn secondary" disabled={busy !== null} onClick={() => onSave({ active: inactive })}>
              {inactive ? 'Activate' : 'Retire'}
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

function NewProductForm({ categories, busy, onSubmit, onCancel, onNeedCategory }: {
  categories: Category[];
  busy: string | null;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
  onNeedCategory: () => void;
}) {
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [unit, setUnit] = useState('unit');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [tax, setTax] = useState('18');
  const [billingType, setBillingType] = useState<'ONE_TIME' | 'RECURRING'>('ONE_TIME');
  const [stockTracked, setStockTracked] = useState(true);
  const [description, setDescription] = useState('');

  const category = categories.find((c) => c.id === categoryId);
  const valid = sku.trim() !== '' && name.trim() !== '' && categoryId !== '' && price.trim() !== '';

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const body: Record<string, unknown> = {
      sku: sku.trim(),
      name: name.trim(),
      categoryId,
      unit: unit.trim() || 'unit',
      basePricePaise: rupeesToPaise(price),
      taxBp: percentToBp(tax),
      billingType,
      stockTracked,
      active: true,
    };
    if (description.trim()) body.description = description.trim();
    if (cost.trim()) body.unitCostPaise = rupeesToPaise(cost);
    onSubmit(body);
  }

  if (categories.length === 0) {
    return (
      <div className="card" style={{ borderColor: 'var(--accent)' }}>
        <h3 style={{ marginTop: 0 }}>New product</h3>
        <div className="notice warn">
          A product must belong to a category, and none exist yet. Create a category first.
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button onClick={onNeedCategory}>Create a category</button>
          <button className="btn secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={submit} style={{ borderColor: 'var(--accent)' }}>
      <h3 style={{ marginTop: 0 }}>New product</h3>
      <div className="grid grid-3">
        <div>
          <label htmlFor="np-sku">SKU</label>
          <input id="np-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="HW-LAPTOP-PRO" required />
        </div>
        <div>
          <label htmlFor="np-name">Name</label>
          <input id="np-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enterprise Laptop Pro" required />
        </div>
        <div>
          <label htmlFor="np-cat">Category</label>
          <select id="np-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
            <option value="">Select a category…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="np-price">List price (₹)</label>
          <input id="np-price" type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="np-cost">Unit cost (₹)</label>
          <input id="np-cost" type="number" step="0.01" min="0" placeholder="leave blank to derive" value={cost} onChange={(e) => setCost(e.target.value)} />
          <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
            {cost.trim()
              ? 'Margin is measured against this cost.'
              : category
                ? `Derived from the ${category.name} default margin of ${formatBp(category.defaultMarginBp)}.`
                : 'Derived from the category default margin.'}
          </div>
        </div>
        <div>
          <label htmlFor="np-tax">Tax %</label>
          <input id="np-tax" type="number" step="0.01" min="0" max="100" value={tax} onChange={(e) => setTax(e.target.value)} />
        </div>
        <div>
          <label htmlFor="np-unit">Unit of measure</label>
          <input id="np-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="unit / licence / hour" />
        </div>
        <div>
          <label htmlFor="np-billing">Billing</label>
          <select id="np-billing" value={billingType} onChange={(e) => setBillingType(e.target.value as 'ONE_TIME' | 'RECURRING')}>
            <option value="ONE_TIME">One-time</option>
            <option value="RECURRING">Recurring (subscription)</option>
          </select>
          <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
            {billingType === 'RECURRING'
              ? 'Billed on a schedule; needs a subscription plan to be quotable.'
              : 'Invoiced once when the order is billed.'}
          </div>
        </div>
        <div>
          <label htmlFor="np-stock">Stock</label>
          <select id="np-stock" value={stockTracked ? 'yes' : 'no'} onChange={(e) => setStockTracked(e.target.value === 'yes')}>
            <option value="yes">Track inventory</option>
            <option value="no">Do not track</option>
          </select>
          <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
            {stockTracked
              ? 'Allocated across warehouses; can go on backorder.'
              : 'Services and licences normally do not need stock.'}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label htmlFor="np-desc">Description (optional)</label>
        <textarea id="np-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button type="submit" disabled={busy !== null || !valid}>
          {busy === 'new-product' ? 'Creating…' : 'Create product'}
        </button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
      {stockTracked && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          A stock-tracked product starts with no inventory. Add stock per warehouse from the Fulfillment page
          before quoting it, or allocation will put the whole line on backorder.
        </div>
      )}
    </form>
  );
}

function NewCategoryForm({ busy, onSubmit, onCancel }: {
  busy: string | null;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [margin, setMargin] = useState('30');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const body: Record<string, unknown> = { name: name.trim(), defaultMarginBp: percentToBp(margin), active: true };
    if (description.trim()) body.description = description.trim();
    onSubmit(body);
  }

  return (
    <form className="card" onSubmit={submit} style={{ borderColor: 'var(--accent)' }}>
      <h3 style={{ marginTop: 0 }}>New category</h3>
      <div className="grid grid-2">
        <div>
          <label htmlFor="nc-name">Name</label>
          <input id="nc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Hardware" required />
        </div>
        <div>
          <label htmlFor="nc-margin">Default margin %</label>
          <input id="nc-margin" type="number" step="0.01" min="0" max="100" value={margin} onChange={(e) => setMargin(e.target.value)} />
          <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
            Used to derive cost for products in this category that have no explicit unit cost.
          </div>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label htmlFor="nc-desc">Description (optional)</label>
        <input id="nc-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button type="submit" disabled={busy !== null || !name.trim()}>
          {busy === 'new-category' ? 'Creating…' : 'Create category'}
        </button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Discount ceilings are set per category on the Governance page. A new category falls back to the
        tier default until you add a rule for it.
      </div>
    </form>
  );
}