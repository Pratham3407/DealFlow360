import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatBp, formatPaise, loadSession } from '../api.js';
import { useApiQuery } from '../useApiQuery.js';
import { ErrorNotice, Empty, Loading } from '../components/States.js';

type Tab = 'pipeline' | 'sales' | 'products' | 'approvals' | 'inventory';

const TABS: Array<{ key: Tab; label: string; path: string; exportName: string }> = [
  { key: 'pipeline', label: 'Pipeline', path: '/api/reports/pipeline', exportName: 'quotations' },
  { key: 'sales', label: 'Sales by Rep', path: '/api/reports/sales', exportName: 'sales' },
  { key: 'products', label: 'Products', path: '/api/reports/products', exportName: 'products' },
  { key: 'approvals', label: 'Approvals', path: '/api/reports/approvals', exportName: 'approvals' },
  { key: 'inventory', label: 'Inventory', path: '/api/reports/inventory', exportName: 'inventory' },
];

/** Filters the reporting endpoints accept. Inventory ignores them. */
interface Filters { from: string; to: string; status: string }

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('pipeline');
  const [filters, setFilters] = useState<Filters>({ from: '', to: '', status: '' });

  const active = TABS.find(t => t.key === tab)!;
  const supportsFilters = tab !== 'inventory' && tab !== 'approvals';

  const query = useMemo(() => {
    const qs = new URLSearchParams();
    if (supportsFilters) {
      if (filters.from) qs.set('from', new Date(filters.from).toISOString());
      if (filters.to) qs.set('to', new Date(filters.to).toISOString());
      if (filters.status) qs.set('status', filters.status);
    }
    return qs.toString();
  }, [filters, supportsFilters]);

  const path = query ? `${active.path}?${query}` : active.path;

  /**
   * The export endpoint streams a file and needs the bearer token, which a plain
   * anchor cannot carry — so fetch it as a blob and hand it to a temporary link.
   */
  async function exportAs(format: 'pdf' | 'xls') {
    const qs = new URLSearchParams(query);
    qs.set('report', active.exportName);
    qs.set('format', format);
    const token = loadSession()?.token;
    const res = await fetch(`/api/reports/export?${qs}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${active.exportName}.${format === 'xls' ? 'xls' : 'pdf'}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0 }}>Reports</h2>
        <p className="muted" style={{ margin: '2px 0 0' }}>
          Pipeline, performance and stock position. Every view exports to XLS or PDF.
        </p>
      </div>

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

      <div className="card">
        <div className="row between">
          <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            {supportsFilters ? (
              <>
                <div style={{ width: 160 }}>
                  <label htmlFor="rfrom">From</label>
                  <input id="rfrom" type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
                </div>
                <div style={{ width: 160 }}>
                  <label htmlFor="rto">To</label>
                  <input id="rto" type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
                </div>
                {tab === 'pipeline' && (
                  <div style={{ width: 200 }}>
                    <label htmlFor="rstatus">Status</label>
                    <select id="rstatus" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
                      <option value="">All</option>
                      {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'UNDER_NEGOTIATION', 'CONFIRMED', 'FULFILLMENT', 'COMPLETED', 'REJECTED'].map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                )}
                <button className="btn secondary" onClick={() => setFilters({ from: '', to: '', status: '' })}>Clear</button>
              </>
            ) : (
              <span className="muted">This report is not date-filtered.</span>
            )}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn secondary" onClick={() => exportAs('xls')}>Export XLS</button>
            <button className="btn secondary" onClick={() => exportAs('pdf')}>Export PDF</button>
          </div>
        </div>
      </div>

      <div className="card">
        {tab === 'pipeline' && <PipelineReport path={path} />}
        {tab === 'sales' && <SalesReport path={path} />}
        {tab === 'products' && <ProductsReport path={path} />}
        {tab === 'approvals' && <ApprovalsReport path={path} />}
        {tab === 'inventory' && <GenericReport path={path} />}
      </div>
    </div>
  );
}

interface PipelineRow {
  id: string; quoteNumber: string; status: string; customerName?: string;
  grandTotalPaise: number; marginPaise: number; marginBp: number;
  riskScoreBp: number; lines: number;
  createdAt: string; sentAt: string | null; confirmedAt: string | null;
}

function PipelineReport({ path }: { path: string }) {
  const { data, loading, error } = useApiQuery<{ data: PipelineRow[] }>(path);
  const items = data?.data ?? [];
  if (error) return <ErrorNotice error={error} />;
  if (loading) return <Loading />;
  if (items.length === 0) return <Empty title="No quotations in range" hint="Widen the date range or clear the status filter." />;

  const total = items.reduce((s, r) => s + r.grandTotalPaise, 0);
  const margin = items.reduce((s, r) => s + r.marginPaise, 0);

  return (
    <>
      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div><div className="kpi-label">Quotations</div><div className="kpi">{items.length}</div></div>
        <div><div className="kpi-label">Total Value</div><div className="kpi">{formatPaise(total)}</div></div>
        <div><div className="kpi-label">Total Margin</div><div className="kpi">{formatPaise(margin)}</div></div>
      </div>
      <table>
        <thead><tr><th>Quote</th><th>Status</th><th className="num">Lines</th><th className="num">Total</th><th className="num">Margin</th><th className="num">Risk</th><th>Created</th><th>Confirmed</th></tr></thead>
        <tbody>
          {items.map(r => (
            <tr key={r.id}>
              <td><Link to={`/quotations/${r.id}`}>{r.quoteNumber}</Link></td>
              <td><span className={`badge ${r.status.toLowerCase()}`}>{r.status}</span></td>
              <td className="muted">{r.lines}</td>
              <td className="num">{formatPaise(r.grandTotalPaise)}</td>
              <td className="num">{formatBp(r.marginBp)}</td>
              <td className="num">{formatBp(r.riskScoreBp)}</td>
              <td className="muted mono">{new Date(r.createdAt).toLocaleDateString()}</td>
              <td className="muted mono">{r.confirmedAt ? new Date(r.confirmedAt).toLocaleDateString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

interface SalesRow {
  salesRepId: string; salesRepName: string; count: number;
  netTotalPaise: number; discountTotalPaise: number; costTotalPaise: number; marginPaise: number;
}

function SalesReport({ path }: { path: string }) {
  const { data, loading, error } = useApiQuery<{ data: SalesRow[] }>(path);
  const items = data?.data ?? [];
  if (error) return <ErrorNotice error={error} />;
  if (loading) return <Loading />;
  if (items.length === 0) return <Empty title="No sales in range" hint="No quotation was created inside these dates." />;
  return (
    <table>
      <thead><tr><th>Rep</th><th className="num">Quotes</th><th className="num">Net total</th><th className="num">Discount</th><th className="num">Cost</th><th className="num">Margin</th></tr></thead>
      <tbody>
        {items.map(r => (
          <tr key={r.salesRepId}>
            <td>{r.salesRepName}</td>
            <td className="num">{r.count}</td>
            <td className="num">{formatPaise(r.netTotalPaise)}</td>
            <td className="num muted">{formatPaise(r.discountTotalPaise)}</td>
            <td className="num muted">{formatPaise(r.costTotalPaise)}</td>
            <td className="num">{formatPaise(r.marginPaise)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface ProductRow {
  productId: string; productName: string; productSku: string; categoryName: string;
  units: number; netTotalPaise: number; discountTotalPaise: number; lineCount: number;
}

function ProductsReport({ path }: { path: string }) {
  const { data, loading, error } = useApiQuery<{ data: ProductRow[] }>(path);
  const items = data?.data ?? [];
  if (error) return <ErrorNotice error={error} />;
  if (loading) return <Loading />;
  if (items.length === 0) return <Empty title="No product sales in range" hint="No quotation line falls inside these dates." />;
  return (
    <table>
      <thead><tr><th>Product</th><th>Category</th><th className="num">Units</th><th className="num">Lines</th><th className="num">Net total</th><th className="num">Discount</th></tr></thead>
      <tbody>
        {items.map(r => (
          <tr key={r.productId}>
            <td>{r.productName} <span className="muted mono">{r.productSku}</span></td>
            <td className="muted">{r.categoryName}</td>
            <td className="num">{r.units}</td>
            <td className="muted">{r.lineCount}</td>
            <td className="num">{formatPaise(r.netTotalPaise)}</td>
            <td className="num muted">{formatPaise(r.discountTotalPaise)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface ApprovalReportRow {
  quoteId: string; quoteNumber: string; level: string; status: string;
  count: number; riskScoreBp: number;
}

function ApprovalsReport({ path }: { path: string }) {
  const { data, loading, error } = useApiQuery<{ data: ApprovalReportRow[] }>(path);
  const items = data?.data ?? [];
  if (error) return <ErrorNotice error={error} />;
  if (loading) return <Loading />;
  if (items.length === 0) return <Empty title="No approvals raised yet" hint="Only quotations whose risk crossed a threshold appear here." />;
  return (
    <table>
      <thead><tr><th>Quote</th><th>Level</th><th>Status</th><th className="num">Count</th><th className="num">Peak risk</th></tr></thead>
      <tbody>
        {items.map((r, i) => (
          <tr key={`${r.quoteId}-${r.level}-${r.status}-${i}`}>
            <td><Link to={`/quotations/${r.quoteId}`}>{r.quoteNumber}</Link></td>
            <td>{r.level}</td>
            <td>
              <span className={`badge ${r.status === 'APPROVED' ? 'approved' : r.status === 'REJECTED' ? 'rejected' : r.status === 'PENDING' ? 'pending' : 'draft'}`}>
                {r.status}
              </span>
            </td>
            <td className="num">{r.count}</td>
            <td className="num">{formatBp(r.riskScoreBp)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Fallback renderer: shows whatever columns the endpoint returns. */
function GenericReport({ path }: { path: string }) {
  const { data, loading, error } = useApiQuery<{ data: Array<Record<string, unknown>> }>(path);
  const items = data?.data ?? [];
  if (error) return <ErrorNotice error={error} />;
  if (loading) return <Loading />;
  if (items.length === 0) return <Empty title="No data" />;
  const columns = Object.keys(items[0] ?? {});
  return (
    <table>
      <thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>
        {items.map((row, i) => (
          <tr key={i}>
            {columns.map(c => <td key={c} className="mono">{String(row[c] ?? '—')}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}