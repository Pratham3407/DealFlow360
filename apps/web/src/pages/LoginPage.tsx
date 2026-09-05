import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth-context.js';
import { ApiClientError, type ApiError } from '../api.js';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  // Blank, not prefilled: credentials belong to the person signing in.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await login(email, password);
      navigate(session.role === 'CUSTOMER' ? '/portal/quotations' : '/quotations', { replace: true });
    } catch (err) {
      setError(err instanceof ApiClientError ? { status: err.status, code: err.code, message: err.message, details: err.details } : { status: 0, code: 'UNKNOWN', message: 'Login failed', details: {} });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>DealFlow360</h1>
        <p className="muted" style={{ marginTop: -8 }}>Sign in to the workspace</p>
        {error && <div className="error">{error.code}: {error.message}</div>}
        <div className="col" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="lg-email">Email</label>
            <input id="lg-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div>
            <label htmlFor="lg-password">Password</label>
            <input id="lg-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="hint">
            New customer? <Link to="/register">Create an account</Link>
            {' · '}Have a magic link? <Link to="/portal/enter">Use it</Link>
          </div>
        </div>
      </form>
    </div>
  );
}
