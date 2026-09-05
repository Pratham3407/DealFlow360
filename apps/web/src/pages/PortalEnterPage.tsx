import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { exchangeMagicLink } from '../api.js';
import { ApiClientError, type ApiError } from '../api.js';
import { ErrorNotice } from '../components/States.js';
import { ThemeToggle } from '../components/ThemeToggle.js';

export function PortalEnterPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(searchParams.get('token') || '');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await exchangeMagicLink(token);
      navigate('/portal/quotations', { replace: true });
    } catch (err) {
      setError(err instanceof ApiClientError ? { status: err.status, code: err.code, message: err.message, details: err.details } : { status: 0, code: 'UNKNOWN', message: 'Invalid or expired link', details: {} });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>DealFlow360 Portal</h1>
        <p className="muted" style={{ marginTop: -8 }}>Enter your magic link to access quotations</p>
        {error && <ErrorNotice error={error} />}
        <div className="col" style={{ marginTop: 12 }}>
          <div>
            <label>Magic Link Token</label>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste the token from your email"
              required
              autoFocus
            />
          </div>
          <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Enter Portal'}</button>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', paddingTop: 14 }}>
          <ThemeToggle />
        </div>
      </form>
    </div>
  );
}