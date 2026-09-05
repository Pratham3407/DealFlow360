import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Role, type Capability } from '../lib/types';
import { Alert, ErrorState, LoadingState } from './ui/Feedback';
import { PageHeader, Panel } from './ui/Panel';

/**
 * Route guards.
 *
 * These decide what to render, not what is permitted. The API enforces
 * authorization independently on every request, so a user who edits the URL or
 * the client bundle gains nothing (AGENTS.md 21).
 */

function SessionGate({ children }: { children: ReactNode }): ReactNode {
  const { isLoading, error } = useAuth();

  // Blocking here avoids the flash of a login screen while the session check is
  // still in flight.
  if (isLoading) return <LoadingState label="Checking your session" />;

  // A failed session check is not the same as being signed out: if the API is
  // unreachable, redirecting to a login form that also cannot work is worse than
  // saying so.
  if (error && !error.isUnauthenticated) return <ErrorState error={error} />;

  return <>{children}</>;
}

/** Requires any authenticated internal (non-customer) role. */
export function RequireInternal({ children }: { children: ReactNode }): ReactNode {
  const { profile } = useAuth();
  const location = useLocation();

  return (
    <SessionGate>
      {!profile ? (
        <Navigate to="/login" replace state={{ from: location.pathname }} />
      ) : profile.role === Role.CUSTOMER ? (
        // A customer session must land in the portal, never in the workspace.
        <Navigate to="/portal" replace />
      ) : (
        children
      )}
    </SessionGate>
  );
}

/** Requires an authenticated customer. */
export function RequireCustomer({ children }: { children: ReactNode }): ReactNode {
  const { profile } = useAuth();
  const location = useLocation();

  return (
    <SessionGate>
      {!profile ? (
        <Navigate to="/portal/login" replace state={{ from: location.pathname }} />
      ) : profile.role !== Role.CUSTOMER ? (
        <Navigate to="/overview" replace />
      ) : (
        children
      )}
    </SessionGate>
  );
}

/**
 * Requires at least one of the given capabilities.
 *
 * Renders an explanation rather than redirecting: a user who followed a link
 * they cannot use is better served by being told why.
 */
export function RequireCapability({
  anyOf,
  children,
}: {
  anyOf: Capability[];
  children: ReactNode;
}): ReactNode {
  const { profile, can } = useAuth();

  if (profile && !anyOf.some(can)) {
    return (
      <>
        <PageHeader title="Not available to your role" />
        <Panel>
          <Alert tone="warning" title="Insufficient permissions">
            Your role does not include access to this area. If you believe this is wrong, ask an
            administrator to review your role assignment.
          </Alert>
        </Panel>
      </>
    );
  }

  return <>{children}</>;
}

/** Sends an already-authenticated visitor away from a login screen. */
export function RedirectIfSignedIn({ children }: { children: ReactNode }): ReactNode {
  const { profile, isLoading } = useAuth();

  if (isLoading) return <LoadingState label="Checking your session" />;
  if (profile) return <Navigate to={profile.role === Role.CUSTOMER ? '/portal' : '/overview'} replace />;
  return <>{children}</>;
}
