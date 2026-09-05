import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { registerCustomer, toApiError, type ApiError } from '../api.js';
import { useAuth } from '../auth-context.js';
import { ErrorNotice } from '../components/States.js';
import { ThemeToggle } from '../components/ThemeToggle.js';

/**
 * Customer self-registration.
 *
 * Creates a buying organisation plus its first portal login. Deliberately narrow:
 * the form cannot choose a role, a pricing tier, or attach itself to an existing
 * organisation — joining an existing account needs a magic link from a rep, or
 * anyone could self-attach to another company and read its pricing.
 */
export function RegisterPage() {
  const { setSession } = useAuth();
  const navigate = useNavigate();

  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  // Mirrors the server rule rather than inventing a stricter one, so the form
  // never rejects something the API would have accepted.
  const longEnough = password.length >= 10;
  const hasLetterAndDigit = /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
  const matches = password !== '' && password === confirm;
  const valid =
    companyName.trim().length >= 2 &&
    contactName.trim().length >= 2 &&
    email.includes('@') &&
    longEnough &&
    hasLetterAndDigit &&
    matches;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const session = await registerCustomer({
        companyName: companyName.trim(),
        contactName: contactName.trim(),
        email: email.trim().toLowerCase(),
        password,
      });
      setSession(session);
      navigate('/portal/quotations', { replace: true });
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit} style={{ width: 440 }}>
        <h1>Create an account</h1>
        <p className="muted" style={{ marginTop: -8 }}>
          Register your organisation to receive and accept quotations.
        </p>

        {error && <ErrorNotice error={error} />}

        <div className="col" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="rg-company">Company name</label>
            <input
              id="rg-company"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Corporation"
              required
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="rg-contact">Your name</label>
            <input
              id="rg-contact"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Riya Sharma"
              required
            />
          </div>

          <div>
            <label htmlFor="rg-email">Work email</label>
            <input
              id="rg-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="rg-password">Password</label>
            <input
              id="rg-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              <span style={{ color: longEnough ? 'var(--success)' : undefined }}>
                {longEnough ? '✓' : '·'} at least 10 characters
              </span>
              {' · '}
              <span style={{ color: hasLetterAndDigit ? 'var(--success)' : undefined }}>
                {hasLetterAndDigit ? '✓' : '·'} a letter and a number
              </span>
            </div>
          </div>

          <div>
            <label htmlFor="rg-confirm">Confirm password</label>
            <input
              id="rg-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            {confirm !== '' && !matches && (
              <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4 }}>
                Passwords do not match.
              </div>
            )}
          </div>

          <button type="submit" disabled={busy || !valid}>
            {busy ? 'Creating account…' : 'Create account'}
          </button>

          <div className="hint">
            Already have an account? <Link to="/login">Sign in</Link>
            <br />
            Sent a magic link instead? <Link to="/portal/enter">Use the link</Link>
          </div>

          <div className="muted" style={{ fontSize: 11 }}>
            New organisations start on the entry pricing tier. Your account manager can move you up.
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', paddingTop: 14 }}>
          <ThemeToggle />
        </div>
      </form>
    </div>
  );
}