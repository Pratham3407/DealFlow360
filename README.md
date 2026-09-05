# DealFlow360

## Intelligent B2B Sales Operations & Deal Management Platform

DealFlow360 is a B2B sales operations platform that manages the complete lifecycle of a business deal — from quotation creation and discount-risk evaluation to approval, customer negotiation, fulfillment, billing, and reporting.

The goal is not to build another basic quote-to-invoice CRUD application. DealFlow360 is designed as a self-governing deal engine that enforces pricing rules, routes risky quotations for approval, reacts to inventory availability, supports hybrid billing, and allows customers to negotiate quotations through a dedicated portal.

## Core Workflow

```text
Sales Rep
   ↓
Create Quotation
   ↓
Add Products / Services / Subscriptions
   ↓
Pricing + Discount Evaluation
   ↓
Risk Assessment
   ↓
Approval Routing
   ↓
Manager / Finance Approval when required
   ↓
Customer Portal
   ↓
Customer Negotiation
   ↓
Risk Recalculation / Re-approval when required
   ↓
Customer Confirmation
   ↓
Warehouse Fulfillment
   ↓
Billing
   ↓
Payment
   ↓
Deal Health + Reporting
```

## Main Capabilities

### Quotation Management

- Create quotations for business customers
- Add products, services, and subscriptions
- Change quantities
- Apply line-level or order-level discounts
- View totals and margin impact
- Track approval and fulfillment status

### Discount Risk Engine

The Risk Engine evaluates every quotation line against applicable discount rules.

Example:

```text
Gold customer

Hardware       → 15% ceiling
Services       → 10% ceiling
Subscriptions  → 15% ceiling
```

A quotation with an 18% discount on a service whose ceiling is 10% produces an 8 percentage-point violation.

The quotation is evaluated as a whole as well, so multiple smaller violations can contribute to blended deal risk.

### Approval Routing

Risk determines whether a quotation needs approval. The Approval Engine determines who must approve it.

```text
Low Risk
  → No approval

Medium Risk
  → Sales Manager

High Risk
  → Sales Manager
  → Finance / Operations
```

Thresholds and discount rules are configurable.

### Customer Negotiation

Customers use a separate portal to:

- View quotations
- Ask line-level questions
- Request changes
- Counter discounts
- Confirm final terms

Material changes can trigger risk recalculation and re-approval.

### Upsell / Cross-Sell

The quotation builder can show relevant product recommendations based on configured product pairings, promotions, and margin rules.

### Fulfillment

Orders can be fulfilled from multiple warehouses.

The system supports:

- Recommended warehouse splits
- Manual overrides
- Partial fulfillment
- Backorders
- Stock arrival
- Backorder consolidation

### Hybrid Billing

A single deal can contain:

```text
One-time items
+
Recurring subscription lines
```

The system supports recurring schedules and configurable proration for mid-cycle changes.

### Deal Health

The platform surfaces operational signals such as:

- Stalled quotations
- Discount anomalies
- Delivery promise slippage
- Approval delays
- Fulfillment problems

### Audit Trail

Important business actions are recorded for traceability.

## Roles

### Sales Representative

Creates quotations, applies discounts, adds products, reviews margin, tracks approvals and fulfillment, and responds to customer negotiations.

### Sales Manager / Approver

Reviews approval-required quotations, approves/rejects/returns quotations, configures discount tiers and approval chains, and monitors deal health.

### Finance / Operations

Handles second-level approvals, fulfillment splits and backorders, recurring billing, and credit-note related operations.

### Customer

Uses the customer portal to review quotations, request changes, negotiate, and confirm final terms.

### Admin

Manages products, price lists, discount tiers, approval chains, warehouses, subscription plans, and reporting.

## Architecture

DealFlow360 should initially be implemented as a modular monolith.

```text
┌─────────────────────────────────────────┐
│                 Frontend                │
│                                         │
│ Internal Workspace   Customer Portal    │
└───────────────────┬─────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│               API Layer                 │
│ Auth │ RBAC │ Validation │ DTOs        │
└───────────────────┬─────────────────────┘
                    │
       ┌────────────┼────────────┐
       ▼            ▼            ▼
  Quotations      Risk       Approvals
       │          Engine        │
       └────────────┼────────────┘
                    │
       ┌────────────┼────────────┐
       ▼            ▼            ▼
 Fulfillment      Billing    Negotiation
       │            │            │
       └────────────┼────────────┘
                    ▼
               PostgreSQL
                    │
             ┌──────┴──────┐
             ▼             ▼
           Audit       Reporting
                           │
                       Deal Health
```

## Core Domain

```text
User
Role
Customer
CustomerTier

Category
Product
ProductVariant
PriceList
PriceListItem

DiscountRule
ApprovalRule
ApprovalInstance

Quotation
QuotationLine
NegotiationRequest

Warehouse
Inventory
Fulfillment
FulfillmentAllocation
Backorder

SubscriptionPlan
Subscription
BillingSchedule

Invoice
InvoiceLine
Payment
CreditNote

ProductPairing
Promotion

AuditLog
DealHealthEvent
```

## Important Invariants

1. A quotation belongs to one customer and one sales representative.
2. Customer portal access is restricted to the authenticated customer's quotations.
3. Discounts are validated by the backend.
4. Approval cannot be bypassed by changing frontend state.
5. Material quotation changes can invalidate approval.
6. Negotiation can trigger risk recalculation and re-approval.
7. Inventory allocation cannot exceed available inventory.
8. Billing schedules are derived from subscription terms.
9. Audit history is preserved.
10. Totals and margins are based on authoritative business data.

## Security

The frontend is not a security boundary.

The backend must enforce authentication, role-based authorization, customer isolation, quotation ownership, approval permissions, discount rules, inventory constraints, state transitions, and billing permissions.

Never trust the client for:

```text
Role
Customer ID
Approval status
Risk score
Margin
Inventory
Invoice status
Payment status
Quotation state
```

## Development Principles

### Business Logic Over UI

A feature is not complete merely because its screen looks correct. The backend must enforce the business behavior represented by the UI.

### Configuration Over Hardcoding

Do not hardcode behavior for a customer, quote ID, product ID, or demo scenario.

Bad:

```ts
if (customer === "Acme Corp") {
  requireFinanceApproval();
}
```

Good:

```text
Quotation
  ↓
Applicable Rules
  ↓
Risk Evaluation
  ↓
Approval Rules
  ↓
Approval Route
```

### Explicit State Transitions

Do not allow arbitrary frontend status mutation.

Use explicit domain operations such as:

```text
submitQuotation()
approveQuotation()
rejectQuotation()
requestRevision()
sendQuotation()
startNegotiation()
confirmQuotation()
allocateInventory()
issueInvoice()
recordPayment()
```

### Backend Authority

Frontend calculations may improve responsiveness, but final business decisions must be validated by the backend.

### Minimal Architecture

Do not introduce unnecessary microservices or infrastructure. Build correct domain boundaries first.

## Repository Documentation

```text
README.md
AGENTS.md

docs/
├── PRD.md
├── ARCHITECTURE.md
├── DOMAIN_MODEL.md
├── WORKFLOWS.md
├── STATE_MACHINES.md
├── BUSINESS_RULES.md
├── RBAC.md
├── API_SPEC.md
├── SEED_DATA.md
├── ACCEPTANCE_TESTS.md
├── IMPLEMENTATION_PLAN.md
├── NEXT_STEPS.md
└── TRACEABILITY.md
```

`README.md` is the human-facing project overview.

`AGENTS.md` is the living context and handoff document for AI coding agents.

## Development

Before changing the project:

1. Read `AGENTS.md`.
2. Identify the affected domain.
3. Inspect the existing implementation.
4. Read the relevant documentation.
5. Preserve existing invariants and state transitions.
6. Make the smallest correct change.
7. Run relevant tests and validation.
8. Update documentation when behavior changes.
9. Update `AGENTS.md` before finishing.

## Tech Stack

| Layer | Choice |
|---|---|
| API | Express 5 on Node 22+, TypeScript (ESM) |
| Data | PostgreSQL 18, Prisma 7 with the `pg` driver adapter |
| Validation | Zod 4 |
| Web | React 19, Vite 8, Tailwind CSS 4, React Router 7, TanStack Query 5 |
| Tests | Vitest 5, Supertest |

Layout is an npm-workspaces monorepo: `server/` (modular monolith API) and
`web/` (internal workspace + customer portal).

## Running locally

### Prerequisites

- Node 22.12 or newer
- A running PostgreSQL 15+ instance

### 1. Create the database and role

`prisma migrate dev` provisions a temporary shadow database, so the application
role needs `CREATEDB`.

```sql
CREATE ROLE dealflow LOGIN PASSWORD '<choose-one>' CREATEDB;
CREATE DATABASE dealflow360      OWNER dealflow;
CREATE DATABASE dealflow360_test OWNER dealflow;
```

### 2. Configure the environment

```bash
cp .env.example server/.env
# then set DATABASE_URL and TEST_DATABASE_URL
```

`server/.env` is gitignored. `TEST_DATABASE_URL` must point at a different
database from `DATABASE_URL`: the test suite truncates it between tests and
refuses to run if the two match.

### 3. Install, migrate, seed

```bash
npm install
npm run db:migrate      # apply migrations, then regenerate the client
npm run db:seed         # canonical demo data from docs/SEED_DATA.md
```

### 4. Run

```bash
npm run dev             # API on :4000, web on :5173
```

Open http://localhost:5173. Vite proxies `/api` to the API, so the browser sees a
single origin and the httpOnly session cookie works without CORS.

### Seeded accounts

Every seeded account uses the password `DealFlow!2026` (development only;
override with `SEED_PASSWORD` when seeding a shared environment).

| Email | Role | Signs in at |
|---|---|---|
| `admin@dealflow.local` | Admin | `/login` |
| `rep@dealflow.local` | Sales Representative | `/login` |
| `manager@dealflow.local` | Sales Manager | `/login` |
| `finance@dealflow.local` | Finance / Operations | `/login` |
| `buyer@acme.local` | Customer (Acme Corp) | `/portal/login` |
| `buyer@globex.local` | Customer (Globex Industries) | `/portal/login` |

Presenting a credential at the wrong surface is rejected, so an internal account
cannot obtain a portal session or vice versa.

### Commands

| Command | Purpose |
|---|---|
| `npm run dev` | API and web together |
| `npm test` | Vitest unit + Supertest integration suite |
| `npm run typecheck` | `tsc --noEmit` across both workspaces |
| `npm run build` | Typecheck, then production web build |
| `npm run db:migrate` | Apply migrations and regenerate the Prisma client |
| `npm run db:seed` | Seed demo data (idempotent) |
| `npm run db:reset` | **Destructive.** Drop, re-migrate and re-seed |
| `npm run db:studio` | Prisma Studio |

## Project Status

The product requirements, architecture, domain model, workflows, business rules,
RBAC model, API specification, seed data, acceptance scenarios, implementation
plan, and UI design specification have been defined.

**Implemented:** project foundation — database schema for the full domain model,
authentication with server-side sessions, RBAC and capability model, customer
portal isolation, append-only audit trail, admin user provisioning, demo seed
data, and the web shell with both sign-in surfaces.

**Not yet implemented:** quotation builder, pricing, risk engine, approval
engine, recommendations, fulfillment, billing, negotiation, deal health,
reporting.

The authoritative implementation state is always the repository and the latest
`AGENTS.md` update.

## License

Add the intended project license before public distribution.
