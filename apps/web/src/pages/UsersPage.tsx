import { useMemo, useState, type FormEvent } from 'react';
import { api, toApiError, type ApiError } from '../api.js';
import { useAuth } from '../auth-context.js';
import { useApiQuery } from '../useApiQuery.js';
import { type Customer, type Role } from '../types.js';

interface DirectoryUser {
  id: string; email: string; name: string; role: Role;
  customerId: string | null; active: boolean;
  lastLoginAt: string | null; createdAt: string;
  customer?: { id: string; name: string; code: string } | null;
}

/** Internal roles an admin may assign, with what each one is allowed to do. */
const INTERNAL_ROLES: Array<{ value: Role; label: string; can: string }> = [
  { value: 'SALES_REP', label: 'Sales Rep', can: 'Builds quotations and requests approval. Cannot approve.' },
  { value: 'SALES_MANAGER', label: 'Sales Manager', can: 'Everything a rep can, plus clears the Manager approval step and edits governance rules.' },
  { value: 'FINANCE_OPERATIONS', label: 'Finance Operations', can: 'Clears the Finance approval step, generates billing, records payments and credit notes.' },
  { value: 'ADMIN', label: 'Admin', can: 'Full access, including user management and engine calibration.' },
];

const ROLE_LABEL: Record<string, string> = {
  SALES_REP: 'Sales Rep',
  SALES_MANAGER: 'Sales Manager',
  FINANCE_OPERATIONS: 'Finance Operations',
  ADMIN: 'Admin',
  CUSTOMER: 'Customer (portal)',
};

/**
 * User administration.
 *
 * Two populations with different rules, so they are listed separately: internal
 * employees authenticate with a password and must not carry a customer scope,
 * while portal users must belong to exactly one customer. The API enforces both;
 * this screen makes the distinction visible instead of offering one ambiguous form.
 */
export function UsersPage() {
  const { session } = useAuth();
  const [includeInactive, setIncludeInactive] = useState(false);
  const users = useApiQuery<{ data: DirectoryUser[] }>(
    `/api/auth/users?includeInactive=${includeInactive}`,
  );
  const customers = useApiQuery<{ data: Customer[] }>('/api/customers');

  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pane, setPane] = useState<'none' | 'employee' | 'portal'>('none');
  const [resetFor, setResetFor] = useState<DirectoryUser | null>(null);

  const rows = users.data?.data ?? [];
  const employees = useMemo(() => rows.filter((u) => u.role !== 'CUSTOMER'), [rows]);
  const portalUsers = useMemo(() => rows.filter((u) => u.role === 'CUSTOMER'), [rows]);

  async function run(label: string, path: string, method: 'POST' | 'PATCH', body: unknown, message: string, after?: () => void) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await api(path, { method, body });
      users.refetch();
      setNotice(message);
      window.setTimeout(() => setNotice(null), 5000);
      after?.();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(null);
    }
  }

  if (session?.role !== 'ADMIN') {
    return (
      <div>
        <h2>Users</h2>
        <div className="notice warn">Only an Admin can manage users.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="row between" style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>Users</h2>
        <div className="row" style={{ gap: 8 }}>
          <button className={pane === 'employee' ? '' : 'btn secondary'} onClick={() => setPane(pane === 'employee' ? 'none' : 'employee')}>
            + Add employee
          </button>
          <button className={pane === 'portal' ? '' : 'btn secondary'} onClick={() => setPane(pane === 'portal' ? 'none' : 'portal')}>
            + Add portal user
          </button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Employees sign in at the workspace login. Portal users see only their own organisation&rsquo;s quotations.
      </p>

      {error && <div className="error">{error.code}: {error.message}</div>}
      {notice && <div className="notice ok">{notice}</div>}

      {pane === 'employee' && (
        <NewEmployeeForm
          busy={busy}
          onSubmit={(body, label) =>
            run('new-employee', '/api/auth/signup', 'POST', body, `${label} can now sign in.`, () => setPane('none'))
          }
          onCancel={() => setPane('none')}
        />
      )}

      {pane === 'portal' && (
        <NewPortalUserForm
          customers={customers.data?.data ?? []}
          busy={busy}
          onSubmit={(body, label) =>
            run('new-portal', '/api/auth/signup', 'POST', body, `${label} can now sign in to the portal.`, () => setPane('none'))
          }
          onCancel={() => setPane('none')}
        />
      )}

      <div className="card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Employees ({employees.length})</h3>
          <button className="btn secondary" onClick={() => setIncludeInactive((v) => !v)}>
            {includeInactive ? 'Hide disabled' : 'Show disabled'}
          </button>
        </div>
        <UserTable
          rows={employees}
          busy={busy}
          selfId={session.userId}
          onToggleActive={(u) =>
            run(
              `act-${u.id}`,
              `/api/auth/users/${u.id}/active`,
              'PATCH',
              { active: !u.active },
              u.active ? `${u.name} disabled.` : `${u.name} re-enabled.`,
            )
          }
          onReset={setResetFor}
        />
        {employees.length === 0 && !users.loading && <div className="muted">No employees.</div>}
        {users.loading && <div className="muted">Loading…</div>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Portal users ({portalUsers.length})</h3>
        <UserTable
          rows={portalUsers}
          busy={busy}
          selfId={session.userId}
          showCustomer
          onToggleActive={(u) =>
            run(
              `act-${u.id}`,
              `/api/auth/users/${u.id}/active`,
              'PATCH',
              { active: !u.active },
              u.active ? `${u.name} disabled.` : `${u.name} re-enabled.`,
            )
          }
          onReset={setResetFor}
        />
        {portalUsers.length === 0 && !users.loading && (
          <div className="muted">No portal users. Customers can also self-register from the sign-up page.</div>
        )}
      </div>

      {resetFor && (
        <ResetPasswordForm
          user={resetFor}
          busy={busy}
          onSubmit={(password) =>
            run(
              `pw-${resetFor.id}`,
              `/api/auth/users/${resetFor.id}/password`,
              'PATCH',
              { password },
              `Password reset for ${resetFor.name}.`,
              () => setResetFor(null),
            )
          }
          onCancel={() => setResetFor(null)}
        />
      )}
    </div>
  );
}

function UserTable({ rows, busy, selfId, showCustomer = false, onToggleActive, onReset }: {
  rows: DirectoryUser[];
  busy: string | null;
  selfId: string;
  showCustomer?: boolean;
  onToggleActive: (u: DirectoryUser) => void;
  onReset: (u: DirectoryUser) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <table>
      <thead>
        <tr>
          <th>Name</th><th>Email</th><th>Role</th>
          {showCustomer && <th>Organisation</th>}
          <th>Last sign-in</th><th>Status</th><th />
        </tr>
      </thead>
      <tbody>
        {rows.map((u) => {
          const isSelf = u.id === selfId;
          return (
            <tr key={u.id} style={u.active ? undefined : { opacity: 0.55 }}>
              <td>{u.name}{isSelf && <span className="muted"> (you)</span>}</td>
              <td className="mono">{u.email}</td>
              <td>{ROLE_LABEL[u.role] ?? u.role}</td>
              {showCustomer && <td className="muted">{u.customer?.name ?? '—'}</td>}
              <td className="muted mono">
                {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'never'}
              </td>
              <td>
                <span className={`badge ${u.active ? 'approved' : 'draft'}`}>
                  {u.active ? 'ACTIVE' : 'DISABLED'}
                </span>
              </td>
              <td>
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn secondary" onClick={() => onReset(u)}>Reset password</button>
                  <button
                    className={u.active ? 'danger' : 'btn secondary'}
                    disabled={busy !== null || isSelf}
                    title={isSelf ? 'You cannot disable your own account' : undefined}
                    onClick={() => onToggleActive(u)}
                  >
                    {u.active ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Shared password field with the server's rules restated inline. */
function PasswordFields({ password, setPassword, confirm, setConfirm, idPrefix }: {
  password: string; setPassword: (v: string) => void;
  confirm: string; setConfirm: (v: string) => void;
  idPrefix: string;
}) {
  const longEnough = password.length >= 10;
  const mixed = /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
  const matches = password !== '' && password === confirm;

  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-pw`}>Password</label>
        <input id={`${idPrefix}-pw`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          <span style={{ color: longEnough ? 'var(--success)' : undefined }}>
            {longEnough ? '✓' : '·'} 10+ characters
          </span>
          {' · '}
          <span style={{ color: mixed ? 'var(--success)' : undefined }}>
            {mixed ? '✓' : '·'} a letter and a number
          </span>
        </div>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-pw2`}>Confirm password</label>
        <input id={`${idPrefix}-pw2`} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        {confirm !== '' && !matches && (
          <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4 }}>Passwords do not match.</div>
        )}
      </div>
    </>
  );
}

function passwordOk(password: string, confirm: string): boolean {
  return (
    password.length >= 10 &&
    /[a-zA-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    password === confirm
  );
}

function NewEmployeeForm({ busy, onSubmit, onCancel }: {
  busy: string | null;
  onSubmit: (body: Record<string, unknown>, label: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('SALES_REP');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const chosen = INTERNAL_ROLES.find((r) => r.value === role);
  const valid = name.trim().length >= 2 && email.includes('@') && passwordOk(password, confirm);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    // No customerId: the API rejects an internal user carrying a customer scope.
    onSubmit(
      { name: name.trim(), email: email.trim().toLowerCase(), role, password },
      name.trim(),
    );
  }

  return (
    <form className="card" onSubmit={submit} style={{ borderColor: 'var(--accent)' }}>
      <h3 style={{ marginTop: 0 }}>Add an employee</h3>
      <div className="grid grid-2">
        <div>
          <label htmlFor="ne-name">Full name</label>
          <input id="ne-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="ne-email">Work email</label>
          <input id="ne-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="ne-role">Role</label>
          <select id="ne-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {INTERNAL_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          {chosen && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{chosen.can}</div>}
        </div>
        <div />
        <PasswordFields
          password={password} setPassword={setPassword}
          confirm={confirm} setConfirm={setConfirm}
          idPrefix="ne"
        />
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button type="submit" disabled={busy !== null || !valid}>
          {busy === 'new-employee' ? 'Creating…' : 'Create employee'}
        </button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Share the password out of band; the employee can be given a new one from this screen at any time.
      </div>
    </form>
  );
}

function NewPortalUserForm({ customers, busy, onSubmit, onCancel }: {
  customers: Customer[];
  busy: string | null;
  onSubmit: (body: Record<string, unknown>, label: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const customer = customers.find((c) => c.id === customerId);
  const valid = name.trim().length >= 2 && email.includes('@') && customerId !== '' && passwordOk(password, confirm);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    onSubmit(
      { name: name.trim(), email: email.trim().toLowerCase(), role: 'CUSTOMER', customerId, password },
      name.trim(),
    );
  }

  if (customers.length === 0) {
    return (
      <div className="card" style={{ borderColor: 'var(--accent)' }}>
        <h3 style={{ marginTop: 0 }}>Add a portal user</h3>
        <div className="notice warn">
          A portal user must belong to a customer, and none exist yet.
        </div>
        <button className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={submit} style={{ borderColor: 'var(--accent)' }}>
      <h3 style={{ marginTop: 0 }}>Add a portal user</h3>
      <div className="grid grid-2">
        <div>
          <label htmlFor="np-name">Full name</label>
          <input id="np-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="np-email">Email</label>
          <input id="np-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="np-cust">Organisation</label>
          <select id="np-cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
            <option value="">Select a customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
          </select>
          {customer?.tier && (
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              {customer.tier.name} tier. This user will see only {customer.name}&rsquo;s quotations.
            </div>
          )}
        </div>
        <div />
        <PasswordFields
          password={password} setPassword={setPassword}
          confirm={confirm} setConfirm={setConfirm}
          idPrefix="np"
        />
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button type="submit" disabled={busy !== null || !valid}>
          {busy === 'new-portal' ? 'Creating…' : 'Create portal user'}
        </button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ResetPasswordForm({ user, busy, onSubmit, onCancel }: {
  user: DirectoryUser;
  busy: string | null;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const valid = passwordOk(password, confirm);

  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <h3 style={{ marginTop: 0 }}>Reset password for {user.name}</h3>
      <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
        The new password takes effect immediately. Existing sessions keep working until their token expires.
      </p>
      <div className="grid grid-2">
        <PasswordFields
          password={password} setPassword={setPassword}
          confirm={confirm} setConfirm={setConfirm}
          idPrefix={`rs-${user.id}`}
        />
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button disabled={busy !== null || !valid} onClick={() => onSubmit(password)}>
          {busy === `pw-${user.id}` ? 'Saving…' : 'Set password'}
        </button>
        <button className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}