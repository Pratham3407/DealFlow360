/**
 * App shell + routing.
 *
 * - `/login`         internal-workspace email + password
 * - `/portal/enter`  magic-link redeem for customers
 * - everything else  requires an authenticated session; internal users get the
 *                    workspace, portal customers get the portal.
 */

import { createContext, type ReactNode, useContext, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ApiClientError, type ApiError } from './api.js';
import { AuthProvider, useAuth } from './auth-context.js';
import { canAccess } from './nav.js';
import { ErrorNotice } from './components/States.js';
import { LoginPage } from './pages/LoginPage.js';
import { RegisterPage } from './pages/RegisterPage.js';
import { UsersPage } from './pages/UsersPage.js';
import { PortalEnterPage } from './pages/PortalEnterPage.js';
import { WorkspaceLayout } from './pages/WorkspaceLayout.js';
import { PortalLayout } from './pages/PortalLayout.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { QuotationsPage } from './pages/QuotationsPage.js';
import { NewQuotationPage } from './pages/NewQuotationPage.js';
import { QuotationDetailPage } from './pages/QuotationDetailPage.js';
import { ApprovalsPage } from './pages/ApprovalsPage.js';
import { CatalogPage } from './pages/CatalogPage.js';
import { CustomersPage } from './pages/CustomersPage.js';
import { FulfillmentPage } from './pages/FulfillmentPage.js';
import { BillingPage } from './pages/BillingPage.js';
import { DealHealthPage } from './pages/DealHealthPage.js';
import { GovernancePage } from './pages/GovernancePage.js';
import { ReportsPage } from './pages/ReportsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { PortalQuotationsPage } from './pages/PortalQuotationsPage.js';
import { PortalQuotationDetailPage } from './pages/PortalQuotationDetailPage.js';

const ErrorCtx = createContext<{ error: ApiError | null; setError: (e: ApiError | null) => void; clearError: () => void } | null>(null);

export function useApiError() {
  const ctx = useContext(ErrorCtx);
  if (!ctx) throw new Error('useApiError must be used inside <App>');
  return ctx;
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiClientError) return { status: err.status, code: err.code, message: err.message, details: err.details };
  if (err instanceof Error) return { status: 0, code: 'UNKNOWN', message: err.message, details: {} };
  return { status: 0, code: 'UNKNOWN', message: 'Unexpected error', details: {} };
}

function ErrorBoundary({ children }: { children: ReactNode }) {
  const [err, setErr] = useState<ApiError | null>(null);
  return (
    <ErrorCtx.Provider value={{ error: err, setError: setErr, clearError: () => setErr(null) }}>
      {err && <div style={{ margin: 12 }}><ErrorNotice error={err} /></div>}
      {children}
    </ErrorCtx.Provider>
  );
}

function RequireAuth({ children, portal }: { children: ReactNode; portal: boolean }) {
  const { session } = useAuth();
  const location = useLocation();
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />;
  if (portal) {
    if (session.role !== 'CUSTOMER') return <Navigate to="/" replace />;
  } else {
    if (session.role === 'CUSTOMER') return <Navigate to="/portal/quotations" replace />;
    /*
     * A role that has no use for an area should not be able to reach it by URL
     * either. This is a usability guard, not the security boundary — the API
     * enforces the same rules and remains the authority.
     */
    if (!canAccess(session.role, location.pathname)) {
      return <Navigate to="/quotations" replace />;
    }
  }
  return <>{children}</>;
}

function RootRedirect() {
  const { session } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  if (session.role === 'CUSTOMER') return <Navigate to="/portal/quotations" replace />;
  return <Navigate to="/quotations" replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ErrorBoundary>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/portal/enter" element={<PortalEnterPage />} />
            <Route path="/" element={<RootRedirect />} />

            <Route path="/portal/quotations" element={<RequireAuth portal><PortalLayout><PortalQuotationsPage /></PortalLayout></RequireAuth>} />
            <Route path="/portal/quotations/:id" element={<RequireAuth portal><PortalLayout><PortalQuotationDetailPage /></PortalLayout></RequireAuth>} />

            <Route path="/quotations" element={<RequireAuth portal={false}><WorkspaceLayout><QuotationsPage /></WorkspaceLayout></RequireAuth>} />
            <Route path="/quotations/new" element={<RequireAuth portal={false}><WorkspaceLayout><NewQuotationPage /></WorkspaceLayout></RequireAuth>} />
            <Route path="/quotations/:id" element={<RequireAuth portal={false}><WorkspaceLayout><QuotationDetailPage /></WorkspaceLayout></RequireAuth>} />
            <Route path="/approvals" element={<RequireAuth portal={false}><WorkspaceLayout><ApprovalsPage /></WorkspaceLayout></RequireAuth>} />
            <Route path="/fulfillment" element={<RequireAuth portal={false}><WorkspaceLayout><FulfillmentPage /></WorkspaceLayout></RequireAuth>} />
            <Route path="/billing" element={<RequireAuth portal={false}><WorkspaceLayout><BillingPage /></WorkspaceLayout></RequireAuth>} />
            <Route path="/customers" element={<RequireAuth portal={false}><WorkspaceLayout><CustomersPage /></WorkspaceLayout></RequireAuth>} />
            <Route path="/catalog" element={<RequireAuth portal={false}><WorkspaceLayout><CatalogPage /></WorkspaceLayout></RequireAuth>} />
            <Route path="/deal-health" element={<RequireAuth portal={false}><WorkspaceLayout><DealHealthPage /></WorkspaceLayout></RequireAuth>} />
            <Route path="/governance" element={<RequireAuth portal={false}><WorkspaceLayout><GovernancePage /></WorkspaceLayout></RequireAuth>} />
            <Route path="/users" element={<RequireAuth portal={false}><WorkspaceLayout><UsersPage /></WorkspaceLayout></RequireAuth>} />
            <Route path="/reports" element={<RequireAuth portal={false}><WorkspaceLayout><ReportsPage /></WorkspaceLayout></RequireAuth>} />
            <Route path="/settings" element={<RequireAuth portal={false}><WorkspaceLayout><SettingsPage /></WorkspaceLayout></RequireAuth>} />
            <Route path="/dashboard" element={<RequireAuth portal={false}><WorkspaceLayout><DashboardPage /></WorkspaceLayout></RequireAuth>} />
          </Routes>
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  );
}