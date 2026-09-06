import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatBp, formatPaise, rupeesToPaise, toApiError, type ApiError } from '../api.js';
import { useAuth } from '../auth-context.js';
import { useApiQuery } from '../useApiQuery.js';
import { type Quotation } from '../types.js';
import { ErrorNotice, Empty, Loading } from '../components/States.js';

/**
 * Fulfillment is per-order: there is no list endpoint, plans hang off a confirmed
 * quotation at `/api/orders/:id/fulfillment`. So the page is master/detail — pick
 * an order on the left, work its plan on the right, with the selection held in
 * the query string so a plan is linkable.
 */
export function FulfillmentPage() {
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
      <h2>Fulfillment</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Warehouse allocation. Runs alongside billing, not before it.
      </p>

      {error && <ErrorNotice error={error} />}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Orders</h3>
        <table>
          <thead><tr><th>Quote</th><th>Status</th><th className="num">Grand total</th><th>Promised</th><th>Confirmed</th><th /></tr></thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id} style={o.id === selectedId ? { background: 'var(--accent-soft)', boxShadow: 'inset 3px 0 0 var(--accent)' } : undefined}>
                <td><Link to={`/quotations/${o.id}`}>{o.quoteNumber}</Link></td>
                <td><span className={`badge ${o.status.toLowerCase()}`}>{o.status}</span></td>
                <td className="num">{formatPaise(o.grandTotalPaise)}</td>
                <td className="muted mono">{o.promisedDeliveryDate ? new Date(o.promisedDeliveryDate).toLocaleDateString() : '—'}</td>
                <td className="muted mono">{o.confirmedAt ? new Date(o.confirmedAt).toLocaleDateString() : '—'}</td>
                <td>
                  <button className={o.id === selectedId ? '' : 'btn secondary'} onClick={() => select(o.id)}>
                    {o.id === selectedId ? 'Viewing' : 'Open plan'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.length === 0 && !loading && <Empty title="No confirmed orders" hint="A customer has to accept a quotation before it can be allocated." />}
        {loading && <Loading />}
      </div>

      {selectedId && <FulfillmentPlan quotationId={selectedId} />}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Inventory</h3>
        <InventoryTable />
      </div>
    </div>
  );
}

interface Allocation {
  id: string; quotationLineId: string; productId: string; warehouseId: string;
  quantity: number; shipmentCostPaise: number; reserved: boolean; shippedAt: string | null;
  warehouse?: { id: string; name: string; code?: string };
  line?: { id: string; productName: string; productSku: string; quantity: number };
}

interface Backorder {
  id: string; quotationLineId: string; productId: string; quantity: number;
  status: string; availableWarehouseId: string | null; resolvedAt: string | null;
  availableWarehouse?: { id: string; name: string } | null;
}

interface FulfillmentPlanData {
  id: string; quotationId: string; status: string;
  plannedShipmentCount: number; plannedShippingCostPaise: number;
  isOverridden: boolean; acceptedAt: string | null;
  projectedDeliveryDate: string | null; notes: string | null;
  allocations: Allocation[];
  backorders: Backorder[];
  quotation?: Quotation;
}

const PLANNERS = ['SALES_REP', 'SALES_MANAGER', 'FINANCE_OPERATIONS', 'ADMIN'];
const ACCEPTERS = ['SALES_MANAGER', 'FINANCE_OPERATIONS', 'ADMIN'];

function FulfillmentPlan({ quotationId }: { quotationId: string }) {
  const { session } = useAuth();
  const { data, loading, error: loadError, refetch } = useApiQuery<{ fulfillment: FulfillmentPlanData | null }>(
    `/api/orders/${quotationId}/fulfillment`,
  );
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showOverride, setShowOverride] = useState(false);

  async function act(label: string, path: string, body?: unknown) {
    setBusy(label);
    setError(null);
    try {
      await api(path, { method: 'POST', body: body ?? {} });
      setShowOverride(false);
      refetch();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="card"><Loading label="Loading allocation plan…" /></div>;
  if (loadError) return <ErrorNotice error={loadError} />;

  const plan = data?.fulfillment ?? null;
  const canPlan = PLANNERS.includes(session?.role ?? '');
  const canAccept = ACCEPTERS.includes(session?.role ?? '');

  if (!plan) {
    return (
      <div className="card" style={{ borderColor: 'var(--accent)' }}>
        <h3 style={{ marginTop: 0 }}>No plan yet</h3>
        <p className="muted">
          Splits each line across warehouses by available stock, minimising shipments.
        </p>
        {error && <ErrorNotice error={error} />}
        {canPlan && (
          <button disabled={busy !== null} onClick={() => act('recalc', `/api/orders/${quotationId}/fulfillment/recalculate`)}>
            {busy === 'recalc' ? 'Planning…' : 'Generate allocation plan'}
          </button>
        )}
      </div>
    );
  }

  const openBackorders = plan.backorders.filter(b => b.status !== 'FULFILLED' && b.status !== 'CANCELLED');
  const canRecalc = canPlan && (plan.status === 'NOT_STARTED' || plan.status === 'ALLOCATING') && !plan.isOverridden;

  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>
          Allocation Plan <span className="badge draft">{plan.status}</span>
          {plan.isOverridden && <span className="badge revision" style={{ marginLeft: 6 }}>OVERRIDDEN</span>}
        </h3>
        <div className="row" style={{ gap: 8 }}>
          {canRecalc && (
            <button className="btn secondary" disabled={busy !== null}
              onClick={() => act('recalc', `/api/orders/${quotationId}/fulfillment/recalculate`)}>
              {busy === 'recalc' ? 'Recalculating…' : 'Recalculate'}
            </button>
          )}
          {canAccept && plan.status === 'ALLOCATING' && (
            <>
              <button className="btn secondary" onClick={() => setShowOverride(v => !v)}>Override split</button>
              <button disabled={busy !== null} onClick={() => act('accept', `/api/orders/${quotationId}/fulfillment/accept`)}>
                {busy === 'accept' ? 'Accepting…' : 'Accept plan & reserve stock'}
              </button>
            </>
          )}
        </div>
      </div>

      {error && <ErrorNotice error={error} />}

      <div className="grid grid-3" style={{ marginBottom: 12 }}>
        <div><div className="kpi-label">Shipments</div><div className="kpi">{plan.plannedShipmentCount}</div></div>
        <div><div className="kpi-label">Shipping Cost</div><div className="kpi">{formatPaise(plan.plannedShippingCostPaise)}</div></div>
        <div>
          <div className="kpi-label">Projected Delivery</div>
          <div className="kpi">{plan.projectedDeliveryDate ? new Date(plan.projectedDeliveryDate).toLocaleDateString() : '—'}</div>
        </div>
      </div>

      <h4>Allocations</h4>
      <table>
        <thead><tr><th>Line</th><th>Warehouse</th><th className="num">Qty</th><th className="num">Shipment cost</th><th>Reserved</th><th>Shipped</th></tr></thead>
        <tbody>
          {plan.allocations.map(a => (
            <tr key={a.id}>
              <td>{a.line?.productName ?? a.productId} <span className="muted mono">{a.line?.productSku}</span></td>
              <td>{a.warehouse?.name ?? a.warehouseId}</td>
              <td className="num">{a.quantity}</td>
              <td className="num muted">{formatPaise(a.shipmentCostPaise)}</td>
              <td><span className={`badge ${a.reserved ? 'approved' : 'draft'}`}>{a.reserved ? 'YES' : 'NO'}</span></td>
              <td className="muted mono">{a.shippedAt ? new Date(a.shippedAt).toLocaleDateString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {plan.allocations.length === 0 && <Empty title="Nothing allocated" hint="No warehouse had stock for these lines, so everything went to backorder." />}

      {plan.backorders.length > 0 && (
        <>
          <h4 style={{ marginTop: 20 }}>
            Backorders
            {openBackorders.length > 0 && <span className="muted" style={{ fontWeight: 400 }}> · {openBackorders.length} open</span>}
          </h4>
          <table>
            <thead><tr><th>Product</th><th className="num">Qty short</th><th>Status</th><th>Stock found at</th><th>Resolved</th><th /></tr></thead>
            <tbody>
              {plan.backorders.map(b => {
                const line = plan.allocations.find(a => a.quotationLineId === b.quotationLineId)?.line;
                return (
                  <tr key={b.id}>
                    <td>{line?.productName ?? b.productId}</td>
                    <td style={{ color: 'var(--warning)' }}>{b.quantity}</td>
                    <td><span className={`badge ${b.status === 'FULFILLED' ? 'approved' : b.status === 'STOCK_AVAILABLE' ? 'sent' : 'pending'}`}>{b.status}</span></td>
                    <td className="muted">{b.availableWarehouse?.name ?? '—'}</td>
                    <td className="muted mono">{b.resolvedAt ? new Date(b.resolvedAt).toLocaleDateString() : '—'}</td>
                    <td>
                      {canAccept && b.status === 'STOCK_AVAILABLE' && (
                        <button disabled={busy !== null} onClick={() => act(`bo-${b.id}`, `/api/backorders/${b.id}/consolidate`)}>
                          {busy === `bo-${b.id}` ? 'Consolidating…' : 'Consolidate'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            A backorder becomes consolidatable once stock is restocked into a warehouse.
          </div>
        </>
      )}

      {showOverride && (
        <OverrideForm
          plan={plan}
          quotationId={quotationId}
          busy={busy}
          onSubmit={(splits) => act('override', `/api/orders/${quotationId}/fulfillment/override`, { splits })}
          onCancel={() => setShowOverride(false)}
        />
      )}
    </div>
  );
}

interface Warehouse { id: string; name: string; code: string }

function OverrideForm({ plan, busy, onSubmit, onCancel }: {
  plan: FulfillmentPlanData;
  quotationId: string;
  busy: string | null;
  onSubmit: (splits: Array<{ quotationLineId: string; warehouseId: string; quantity: number }>) => void;
  onCancel: () => void;
}) {
  const { data: whData } = useApiQuery<{ data: Warehouse[] }>('/api/warehouses');
  const warehouses = whData?.data ?? [];

  // Seed the editor from the current plan so an override is a tweak, not a re-entry.
  const [rows, setRows] = useState(
    plan.allocations.map(a => ({
      quotationLineId: a.quotationLineId,
      warehouseId: a.warehouseId,
      quantity: String(a.quantity),
      label: a.line?.productName ?? a.productId,
    })),
  );

  function update(index: number, patch: Partial<(typeof rows)[number]>) {
    setRows(prev => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    const first = plan.allocations[0];
    if (!first) return;
    setRows(prev => [...prev, {
      quotationLineId: first.quotationLineId,
      warehouseId: warehouses[0]?.id ?? first.warehouseId,
      quantity: '1',
      label: first.line?.productName ?? first.productId,
    }]);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const splits = rows
      .map(r => ({
        quotationLineId: r.quotationLineId,
        warehouseId: r.warehouseId,
        quantity: Number.parseInt(r.quantity, 10) || 0,
      }))
      .filter(s => s.quantity > 0);
    if (splits.length === 0) return;
    onSubmit(splits);
  }

  const lineOptions = Array.from(
    new Map(plan.allocations.map(a => [a.quotationLineId, a.line?.productName ?? a.productId])).entries(),
  );

  return (
    <form onSubmit={submit} style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
      <h4 style={{ marginTop: 0 }}>Override the split</h4>
      <p className="muted" style={{ fontSize: 12 }}>
        Replaces the engine's recommendation entirely. The server still validates each warehouse has the stock.
      </p>
      <table>
        <thead><tr><th>Line</th><th>Warehouse</th><th className="num">Qty</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <select value={r.quotationLineId} onChange={e => update(i, { quotationLineId: e.target.value })}>
                  {lineOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </td>
              <td>
                <select value={r.warehouseId} onChange={e => update(i, { warehouseId: e.target.value })}>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </td>
              <td><input type="number" min="1" value={r.quantity} onChange={e => update(i, { quantity: e.target.value })} style={{ width: 80 }} /></td>
              <td>
                <button type="button" className="btn secondary" onClick={() => setRows(prev => prev.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button type="submit" disabled={busy !== null}>{busy === 'override' ? 'Saving…' : 'Save override'}</button>
        <button type="button" className="btn secondary" onClick={addRow}>+ Add split</button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

interface InventoryRow {
  id: string; productId: string; warehouseId: string;
  availableQuantity: number; reservedQuantity: number; reorderPoint: number; reorderQuantity: number;
  product?: { name: string; sku: string };
  warehouse?: { name: string; code?: string };
}

interface WarehouseRef { id: string; name: string; code: string }

interface ProductRef { id: string; name: string; sku: string; stockTracked: boolean }

/**
 * Inventory, grouped by warehouse.
 *
 * A single flat table mixed every warehouse together and put five bare integer
 * columns side by side, so it was impossible to see at a glance where a product
 * was short. Each warehouse now gets its own block with a totals line, quantities
 * are right-aligned with tabular figures, and the available-versus-reorder
 * relationship is drawn as a bar rather than left to the reader to compare.
 */
function InventoryTable() {
  const { session } = useAuth();
  const { data, loading, refetch } = useApiQuery<{ data: InventoryRow[] }>('/api/inventory');
  const warehouses = useApiQuery<{ data: WarehouseRef[] }>('/api/warehouses');
  const products = useApiQuery<{ data: ProductRef[] }>('/api/products');

  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [restockFor, setRestockFor] = useState<InventoryRow | null>(null);
  const [qty, setQty] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showAddWh, setShowAddWh] = useState(false);

  const canRestock = ['FINANCE_OPERATIONS', 'ADMIN'].includes(session?.role ?? '');
  const canSetStock = session?.role === 'ADMIN';
  const canAddWarehouse = session?.role === 'ADMIN';

  const items = data?.data ?? [];

  /** Group by warehouse so each block reads as one physical location. */
  const groups = useMemo(() => {
    const byWarehouse = new Map<string, { name: string; rows: InventoryRow[] }>();
    for (const row of items) {
      const existing = byWarehouse.get(row.warehouseId);
      if (existing) existing.rows.push(row);
      else byWarehouse.set(row.warehouseId, { name: row.warehouse?.name ?? row.warehouseId, rows: [row] });
    }
    return [...byWarehouse.entries()]
      .map(([id, g]) => ({
        id,
        name: g.name,
        rows: g.rows.slice().sort((a, b) => (a.product?.name ?? '').localeCompare(b.product?.name ?? '')),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  /** Stock-tracked products with no row anywhere — silently at zero. */
  const missing = useMemo(() => {
    const withStock = new Set(items.map((i) => i.productId));
    return (products.data?.data ?? []).filter((p) => p.stockTracked && !withStock.has(p.id));
  }, [items, products.data]);

  async function run(label: string, path: string, body: unknown, after?: () => void) {
    setBusy(label);
    setError(null);
    try {
      await api(path, { method: 'POST', body });
      refetch();
      after?.();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Loading />;

  return (
    <>
      {error && <ErrorNotice error={error} />}

      {missing.length > 0 && (
        <div className="notice warn">
          {missing.length} stock-tracked product{missing.length === 1 ? '' : 's'} have no inventory record anywhere
          ({missing.map((p) => p.name).join(', ')}). Quoting them puts the whole line on backorder.
          {canSetStock && ' Use “Set opening stock” to fix that.'}
        </div>
      )}

      <div className="row between" style={{ marginBottom: 12 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {items.length} product/warehouse combination{items.length === 1 ? '' : 's'} across{' '}
          {groups.length} warehouse{groups.length === 1 ? '' : 's'}
        </span>
        {canSetStock && (
          <div className="row" style={{ gap: 8 }}>
            <button className={showAddWh ? '' : 'btn secondary'} onClick={() => { setShowAddWh((v) => !v); setShowAdd(false); }}>
              + New warehouse
            </button>
            <button className={showAdd ? '' : 'btn secondary'} onClick={() => { setShowAdd((v) => !v); setShowAddWh(false); }}>
              Set opening stock
            </button>
          </div>
        )}
      </div>

      {showAddWh && canAddWarehouse && (
        <NewWarehouseForm
          busy={busy}
          onSubmit={(body) => run('new-warehouse', '/api/warehouses', body, () => { setShowAddWh(false); warehouses.refetch(); })}
          onCancel={() => setShowAddWh(false)}
        />
      )}

      {showAdd && canSetStock && (
        <SetStockForm
          warehouses={warehouses.data?.data ?? []}
          products={products.data?.data ?? []}
          busy={busy}
          onSubmit={(body) => run('set-stock', '/api/inventory', body, () => setShowAdd(false))}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {groups.length === 0 && <Empty title="No inventory records" hint="Set opening stock per warehouse before quoting a stock-tracked product." />}

      {groups.map((group) => {
        const totalAvailable = group.rows.reduce((s, r) => s + r.availableQuantity, 0);
        const totalReserved = group.rows.reduce((s, r) => s + r.reservedQuantity, 0);
        const lowCount = group.rows.filter((r) => r.availableQuantity <= r.reorderPoint).length;

        return (
          <div key={group.id} style={{ marginBottom: 24 }}>
            <div className="row between" style={{ marginBottom: 6 }}>
              <div className="section-title" style={{ margin: 0 }}>{group.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {totalAvailable} available · {totalReserved} reserved
                {lowCount > 0 && <span style={{ color: 'var(--warning)' }}> · {lowCount} needing reorder</span>}
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th style={{ width: '34%' }}>Product</th>
                  <th className="num" style={{ width: 92 }}>Available</th>
                  <th className="num" style={{ width: 92 }}>Reserved</th>
                  <th className="num" style={{ width: 92 }}>Reorder at</th>
                  <th style={{ width: '22%' }}>Level</th>
                  {canRestock && <th style={{ width: 110 }} />}
                </tr>
              </thead>
              <tbody>
                {group.rows.map((r) => {
                  const out = r.availableQuantity === 0;
                  const low = !out && r.availableQuantity <= r.reorderPoint;
                  // Scale against a full shelf: reorder point plus reorder quantity
                  // is the level replenishment brings stock back up to.
                  const ceiling = Math.max(r.reorderPoint + r.reorderQuantity, r.availableQuantity, 1);
                  const fill = Math.min(100, Math.round((r.availableQuantity / ceiling) * 100));

                  return (
                    <tr key={r.id}>
                      <td>
                        {r.product?.name ?? r.productId}
                        <div className="muted mono" style={{ fontSize: 11 }}>{r.product?.sku}</div>
                      </td>
                      <td
                        className="num"
                        style={{
                          color: out ? 'var(--danger)' : low ? 'var(--warning)' : undefined,
                          fontWeight: out || low ? 600 : 400,
                        }}
                      >
                        {r.availableQuantity}
                      </td>
                      <td className="num muted">{r.reservedQuantity}</td>
                      <td className="num muted">{r.reorderPoint}</td>
                      <td>
                        <div className={`stock-bar ${out ? 'out' : low ? 'low' : ''}`} title={`${r.availableQuantity} of ${ceiling}`}>
                          <span style={{ width: `${fill}%` }} />
                        </div>
                        <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
                          {out ? 'Out of stock' : low ? 'Reorder due' : 'Healthy'}
                        </div>
                      </td>
                      {canRestock && (
                        <td>
                          <button
                            className="btn secondary"
                            onClick={() => { setRestockFor(r); setQty(String(r.reorderQuantity || 10)); }}
                          >
                            Restock
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {restockFor && (
        <div style={{ marginTop: 8, paddingTop: 16, borderTop: '1px solid var(--accent)' }}>
          <h4 style={{ marginTop: 0 }}>
            Restock {restockFor.product?.name} at {restockFor.warehouse?.name}
          </h4>
          <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <div style={{ width: 150 }}>
              <label htmlFor="rsq">Quantity to add</label>
              <input id="rsq" type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <button
              disabled={busy !== null || !qty}
              onClick={() =>
                run(
                  restockFor.id,
                  `/api/stock/${restockFor.productId}/restock`,
                  { warehouseId: restockFor.warehouseId, quantity: Number.parseInt(qty, 10) || 0 },
                  () => { setRestockFor(null); setQty(''); },
                )
              }
            >
              {busy === restockFor.id ? 'Restocking…' : 'Add stock'}
            </button>
            <button className="btn secondary" onClick={() => setRestockFor(null)}>Cancel</button>
          </div>
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            Takes it from {restockFor.availableQuantity} to{' '}
            {restockFor.availableQuantity + (Number.parseInt(qty, 10) || 0)}. Any open backorder for this
            product becomes consolidatable.
          </div>
        </div>
      )}
    </>
  );
}

function SetStockForm({ warehouses, products, busy, onSubmit, onCancel }: {
  warehouses: WarehouseRef[];
  products: ProductRef[];
  busy: string | null;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [productId, setProductId] = useState('');
  const [available, setAvailable] = useState('');
  const [reorderPoint, setReorderPoint] = useState('5');
  const [reorderQuantity, setReorderQuantity] = useState('25');

  const tracked = products.filter((p) => p.stockTracked);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!warehouseId || !productId || available.trim() === '') return;
    onSubmit({
      warehouseId,
      productId,
      availableQuantity: Number.parseInt(available, 10) || 0,
      reorderPoint: Number.parseInt(reorderPoint, 10) || 0,
      reorderQuantity: Number.parseInt(reorderQuantity, 10) || 0,
    });
  }

  return (
    <form onSubmit={submit} style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--accent)' }}>
      <h4 style={{ marginTop: 0 }}>Set opening stock</h4>
      <div className="grid grid-3">
        <div>
          <label htmlFor="ss-wh">Warehouse</label>
          <select id="ss-wh" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ss-prod">Product</label>
          <select id="ss-prod" value={productId} onChange={(e) => setProductId(e.target.value)} required>
            <option value="">Select a product…</option>
            {tracked.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ss-avail">Available quantity</label>
          <input id="ss-avail" type="number" min="0" value={available} onChange={(e) => setAvailable(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="ss-rp">Reorder point</label>
          <input id="ss-rp" type="number" min="0" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} />
        </div>
        <div>
          <label htmlFor="ss-rq">Reorder quantity</label>
          <input id="ss-rq" type="number" min="0" value={reorderQuantity} onChange={(e) => setReorderQuantity(e.target.value)} />
        </div>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button type="submit" disabled={busy !== null || !productId || available.trim() === ''}>
          {busy === 'set-stock' ? 'Saving…' : 'Set stock'}
        </button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        This replaces the available quantity for that product and warehouse. Use Restock to add to it instead.
      </div>
    </form>
  );
}

function NewWarehouseForm({ busy, onSubmit, onCancel }: {
  busy: string | null;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [shippingWeight, setShippingWeight] = useState('100');
  const [baseShipmentCost, setBaseShipmentCost] = useState('500');
  const [leadTimeDays, setLeadTimeDays] = useState('3');
  const [priority, setPriority] = useState('50');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    onSubmit({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      location: location.trim() || undefined,
      shippingWeightBp: Math.round((parseFloat(shippingWeight) || 100) * 100),
      baseShipmentCostPaise: rupeesToPaise(baseShipmentCost),
      leadTimeDays: parseInt(leadTimeDays, 10) || 2,
      priority: parseInt(priority, 10) || 50,
      active: true,
    });
  }

  return (
    <form onSubmit={submit} style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--accent)' }}>
      <h4 style={{ marginTop: 0 }}>Add new warehouse (Admin only)</h4>
      <div className="grid grid-3">
        <div>
          <label htmlFor="wh-code">Warehouse Code</label>
          <input id="wh-code" placeholder="e.g. WEST" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
        </div>
        <div>
          <label htmlFor="wh-name">Warehouse Name</label>
          <input id="wh-name" placeholder="e.g. West Depot" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="wh-loc">Location</label>
          <input id="wh-loc" placeholder="e.g. Pune, Maharashtra" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div>
          <label htmlFor="wh-weight">Shipping Weight % <span className="muted">(100 = neutral)</span></label>
          <input id="wh-weight" type="number" min="1" step="1" value={shippingWeight} onChange={(e) => setShippingWeight(e.target.value)} />
        </div>
        <div>
          <label htmlFor="wh-cost">Base Shipment Cost (₹)</label>
          <input id="wh-cost" type="number" min="0" step="0.01" value={baseShipmentCost} onChange={(e) => setBaseShipmentCost(e.target.value)} />
        </div>
        <div>
          <label htmlFor="wh-lead">Lead Time (days)</label>
          <input id="wh-lead" type="number" min="0" value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} />
        </div>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button type="submit" disabled={busy !== null || !code.trim() || !name.trim()}>
          {busy === 'new-warehouse' ? 'Creating…' : 'Create warehouse'}
        </button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

