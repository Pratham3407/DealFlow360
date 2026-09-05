import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import {
  RedirectIfSignedIn,
  RequireCapability,
  RequireCustomer,
  RequireInternal,
} from "./components/guards";
import { LoginPage, PortalLoginPage } from "./routes/LoginPage";
import { OverviewPage } from "./routes/OverviewPage";
import { ReportsPage } from "./routes/ReportsPage";
import { NotFoundPage, PlaceholderPage } from "./routes/PlaceholderPage";
import { PortalHomePage } from "./routes/PortalHomePage";
import { UsersPage } from "./routes/UsersPage";

/**
 * Route table.
 *
 * Three trust zones matching the API: public sign-in, the internal workspace, and
 * the customer portal. Routes for unbuilt modules exist and say so, so the
 * navigation is never a dead link.
 */
export function App(): ReactNode {
  return (
    <Routes>
      {/* Public */}
      <Route
        path="/login"
        element={
          <RedirectIfSignedIn>
            <LoginPage />
          </RedirectIfSignedIn>
        }
      />
      <Route
        path="/portal/login"
        element={
          <RedirectIfSignedIn>
            <PortalLoginPage />
          </RedirectIfSignedIn>
        }
      />

      {/* Customer portal */}
      <Route
        path="/portal"
        element={
          <RequireCustomer>
            <PortalHomePage />
          </RequireCustomer>
        }
      />

      {/* Internal workspace */}
      <Route
        element={
          <RequireInternal>
            <AppShell />
          </RequireInternal>
        }
      >
        <Route index path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />

        <Route
          path="/quotations"
          element={
            <PlaceholderPage
              title="Quotations"
              description="Create and manage customer quotations, apply discounts and watch margin move in real time."
              plannedBehaviour={[
                "Create a quotation for an existing customer",
                "Add hardware, service and subscription lines",
                "Apply line-level and order-level discounts, validated server-side",
                "See totals, tax and margin recomputed from authoritative pricing",
                "Submit for approval when the risk engine requires it",
              ]}
              specifiedIn={[
                "docs/PRD.md 11",
                "docs/WORKFLOWS.md 2",
                "docs/BUSINESS_RULES.md 6",
              ]}
            />
          }
        />

        <Route
          path="/pipeline"
          element={
            <PlaceholderPage
              title="Pipeline"
              description="Kanban view of every quotation by lifecycle stage."
              plannedBehaviour={[
                "Group quotations by status across the documented state machine",
                "Show customer, amount and stage per card",
                "Open a quotation directly from its card",
              ]}
              specifiedIn={["docs/PRD.md 10", "docs/STATE_MACHINES.md"]}
            />
          }
        />

        <Route
          path="/approvals"
          element={
            <PlaceholderPage
              title="Approvals"
              description="Review queue for quotations the risk engine routed for approval."
              plannedBehaviour={[
                "Queue filtered to the approvals your role may act on",
                "Blended risk score with a per-line explanation of every violation",
                "Approve, reject or return for revision, each producing an audit event",
                "Second-level finance approval after manager approval on high risk",
              ]}
              specifiedIn={[
                "docs/PRD.md 14",
                "docs/WORKFLOWS.md 4-5",
                "docs/BUSINESS_RULES.md 4",
                "docs/ACCEPTANCE_TESTS.md AT-06, AT-07",
              ]}
            />
          }
        />

        <Route
          path="/deal-health"
          element={
            <PlaceholderPage
              title="Deal health"
              description="Operational signals across live deals."
              plannedBehaviour={[
                "Stalled quotations past a configured inactivity window",
                "Discount anomalies against a representative’s historical behaviour",
                "Delivery promise slippage and approval delays",
                "Open the related quotation from any alert",
              ]}
              specifiedIn={["docs/PRD.md 17", "docs/WORKFLOWS.md 11"]}
            />
          }
        />

        <Route
          path="/fulfillment"
          element={
            <PlaceholderPage
              title="Fulfillment"
              description="Allocate confirmed orders across warehouses, with backorder handling."
              plannedBehaviour={[
                "Recommended warehouse split from live stock and shipping weighting",
                "Manual override that is still inventory-validated",
                "Partial fulfillment and backorder creation",
                "Consolidation once replenishment stock arrives",
              ]}
              specifiedIn={[
                "docs/PRD.md 8",
                "docs/WORKFLOWS.md 7",
                "docs/BUSINESS_RULES.md 7-8",
                "docs/ACCEPTANCE_TESTS.md AT-09, AT-10",
              ]}
            />
          }
        />

        <Route
          path="/billing"
          element={
            <PlaceholderPage
              title="Billing"
              description="Hybrid one-time and recurring billing, proration and payments."
              plannedBehaviour={[
                "One-time invoice for one-time lines",
                "Subscription and billing schedule for recurring lines",
                "Mid-cycle proration on quantity change",
                "Payment recording that updates invoice status",
                "Credit notes and partial refunds",
              ]}
              specifiedIn={[
                "docs/PRD.md 18",
                "docs/WORKFLOWS.md 8, 12",
                "docs/BUSINESS_RULES.md 9",
                "docs/ACCEPTANCE_TESTS.md AT-11, AT-15",
              ]}
            />
          }
        />

        <Route path="/reports" element={<ReportsPage />} />

        <Route
          path="/audit"
          element={
            <PlaceholderPage
              title="Audit log"
              description="Append-only history of every material business action."
              plannedBehaviour={[
                "Filter by actor, entity, action and date",
                "Show previous and new value for each change",
                "Scope to your own activity where your role is limited to it",
              ]}
              specifiedIn={["docs/PRD.md 20", "docs/ACCEPTANCE_TESTS.md AT-17"]}
            />
          }
        />

        <Route
          path="/config/products"
          element={
            <PlaceholderPage
              title="Products"
              description="Catalog, variants and price lists."
              plannedBehaviour={[
                "Create and edit products, categories and variants",
                "Maintain customer-tier price lists",
                "Set tax and cost so margin stays authoritative",
              ]}
              specifiedIn={["docs/PRD.md 7 FR-2", "docs/DOMAIN_MODEL.md"]}
            />
          }
        />

        <Route
          path="/config/discount-rules"
          element={
            <PlaceholderPage
              title="Discount rules"
              description="Customer-tier and category discount ceilings."
              plannedBehaviour={[
                "Edit tier-wide and category-specific ceilings",
                "Preview which rule wins for a given tier and category",
                "Keep every ceiling data-driven rather than coded",
              ]}
              specifiedIn={["docs/PRD.md 7 FR-3", "docs/BUSINESS_RULES.md 1-2"]}
            />
          }
        />

        <Route
          path="/config/approval-rules"
          element={
            <PlaceholderPage
              title="Approval rules"
              description="Risk thresholds that decide who must approve."
              plannedBehaviour={[
                "Edit the risk bands that map to no approval, manager, or manager then finance",
                "Keep bands contiguous so every score routes somewhere",
              ]}
              specifiedIn={["docs/PRD.md 7 FR-3", "docs/BUSINESS_RULES.md 4"]}
            />
          }
        />

        <Route
          path="/config/warehouses"
          element={
            <PlaceholderPage
              title="Warehouses"
              description="Locations, stock levels and shipping weighting."
              plannedBehaviour={[
                "Create warehouses and set shipping-cost weighting",
                "Maintain per-product stock and reorder points",
                "Record replenishment arrivals",
              ]}
              specifiedIn={["docs/PRD.md 8", "docs/SEED_DATA.md"]}
            />
          }
        />

        <Route
          path="/config/subscription-plans"
          element={
            <PlaceholderPage
              title="Subscription plans"
              description="Billing cadence, proration, cancellation and refund rules."
              plannedBehaviour={[
                "Create monthly, quarterly and yearly plans",
                "Configure proration and cancellation behaviour",
                "Choose which products a plan governs",
              ]}
              specifiedIn={["docs/PRD.md 9", "docs/BUSINESS_RULES.md 9"]}
            />
          }
        />

        <Route
          path="/config/users"
          element={
            <RequireCapability anyOf={["users:manage"]}>
              <UsersPage />
            </RequireCapability>
          }
        />

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
