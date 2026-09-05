import { formatBp } from '../api.js';
import { useApiQuery } from '../useApiQuery.js';
import { type Customer } from '../types.js';
import { Empty, ErrorNotice, SkeletonRows } from '../components/States.js';

const COLUMNS = 6;

export function CustomersPage() {
  const { data, loading, error } = useApiQuery<{ data: Customer[] }>('/api/customers');
  const items = [...(data?.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <h2>Customers</h2>

      {error && <ErrorNotice error={error} />}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Code</th><th>Name</th><th>Tier</th>
              <th className="num">Default ceiling</th><th>Contact</th><th className="num">Payment terms</th>
            </tr>
          </thead>
          <tbody>
            {loading && <SkeletonRows columns={COLUMNS} rows={4} />}
            {!loading && items.map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.code}</td>
                <td>{c.name}</td>
                <td>{c.tier?.name ?? c.tierId}</td>
                <td className="num muted">
                  {c.tier ? formatBp(c.tier.defaultDiscountCeilingBp) : '—'}
                </td>
                <td className="muted">{c.contactEmail ?? c.contactName ?? '—'}</td>
                <td className="num muted">
                  {c.paymentTermsDays ? `${c.paymentTermsDays} days` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 && (
          <Empty title="No customers" hint="Customers are created by an Admin or a Sales Manager." />
        )}
      </div>
    </div>
  );
}