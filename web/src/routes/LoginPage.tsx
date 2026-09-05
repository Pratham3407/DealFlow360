import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth, type LoginSurface } from '../lib/auth';
import { Alert } from '../components/ui/Feedback';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';

interface SignInFormProps {
  surface: LoginSurface;
  title: string;
  subtitle: string;
  /** Where to go after a successful sign-in. */
  redirectTo: string;
  footer: ReactNode;
}

/**
 * Shared sign-in form for both surfaces.
 *
 * The two surfaces post to different endpoints, and the server refuses a
 * credential presented at the wrong one, so a customer cannot obtain a workspace
 * session by using the internal form.
 */
export function SignInForm({
  surface,
  title,
  subtitle,
  redirectTo,
  footer,
}: SignInFormProps): ReactNode {
  const { login, isLoggingIn } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    try {
      await login({ email, password, surface });
      void navigate(redirectTo, { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError(0, 'UNKNOWN', 'Sign-in failed. Please try again.'),
      );
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <p className="text-sm font-semibold tracking-tight text-slate-900">DealFlow360</p>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-1 text-[13px] text-slate-600">{subtitle}</p>
        </div>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="space-y-4 rounded-lg border border-hairline bg-surface p-5 shadow-xs"
          noValidate
        >
          {error ? (
            <Alert tone={error.isForbidden ? 'warning' : 'error'}>{error.message}</Alert>
          ) : null}

          <Field
            label="Work email"
            type="email"
            name="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <Field
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            loading={isLoggingIn}
            disabled={email.length === 0 || password.length === 0}
          >
            Sign in
          </Button>
        </form>

        <div className="mt-4 text-center text-[13px] text-slate-500">{footer}</div>
      </div>
    </div>
  );
}

export function LoginPage(): ReactNode {
  return (
    <SignInForm
      surface="internal"
      title="Sign in to the workspace"
      subtitle="For sales, approval, operations and administration accounts."
      redirectTo="/overview"
      footer={
        <>
          Buying from us?{' '}
          <Link to="/portal/login" className="font-medium text-brand-700 underline underline-offset-2">
            Use the customer portal
          </Link>
        </>
      }
    />
  );
}

export function PortalLoginPage(): ReactNode {
  return (
    <SignInForm
      surface="portal"
      title="Customer portal"
      subtitle="Review your quotations, ask questions and confirm terms."
      redirectTo="/portal"
      footer={
        <>
          Work here?{' '}
          <Link to="/login" className="font-medium text-brand-700 underline underline-offset-2">
            Sign in to the workspace
          </Link>
        </>
      }
    />
  );
}
