import { useApiQuery } from '../useApiQuery.js';
import { type Customer } from '../types.js';

export function CustomersPage() {
  const { data, loading } = useApiQuery<{ data: Customer[] }>('/api/customers');
  const items = data?.data ?? [];

  return (
    <div>
      <h2>Customers</h2>
      <div className="card">
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>Tier</th><th>Contact</th><th>Terms</th></tr></thead>
          <tbody>
            {items.map(c => (
              <tr key={c.id}>
                <td className="mono">{c.code}</td>
                <td>{c.name}</td>
                <td>{c.tier?.name ?? c.tierId}</td>
                <td className="muted">{c.contactEmail ?? c.contactName ?? '—'}</td>
                <td>{c.paymentTermsDays ? `${c.paymentTermsDays}d` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && !loading && <div className="muted">No customers.</div>}
        {loading && <div className="muted">Loading…</div>}
      </div>
    </div>
  );
}