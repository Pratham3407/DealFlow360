# AGENTS.md

## Purpose

This file is the persistent working context for AI coding agents contributing to DealFlow360.

Every agent must read this file before making meaningful changes.

Every agent that completes meaningful work must update this file before finishing.

The next agent must be able to understand the current implementation state without relying on hidden context from a previous agent.

---

# 1. Project Identity

## Current implementation state

- The authenticated web client now has a Stitch-inspired executive reports screen at `/reports`.
- `web/src/routes/ReportsPage.tsx` contains the interactive presentation layer for KPI, revenue, margin, alert and commercial-rep views.
- Reporting metrics currently use an explicitly labelled preview dataset because the reporting API slice is not implemented yet. Do not describe these values as live backend facts until the reporting endpoints are added.
- The previous standalone `frontend/` directory is an untracked Vite starter and is not the product client; the product client is `web/`.

**Project:** DealFlow360

**Type:** B2B Sales Operations / Deal Management Platform

**Purpose:** Manage the B2B deal lifecycle from quotation creation through discount governance, approval, customer negotiation, fulfillment, billing, payment, and reporting.

DealFlow360 is not a public e-commerce marketplace.

The core workflow is a sales representative creating a private quotation for an existing business customer.

---

# 2. Product Context

The platform covers:

- Multi-tier discount governance
- Automated approval routing
- Upsell / cross-sell recommendations
- Real-time margin impact
- Multi-warehouse fulfillment
- Backorders
- One-time and recurring billing
- Subscription proration
- Customer portal negotiation
- Deal-health monitoring
- Discount anomaly detection
- Reporting
- Auditability

Core flow:

```text
Sales Rep
  ↓
Quotation
  ↓
Pricing / Discount Rules
  ↓
Risk Engine
  ↓
Approval Engine
  ↓
Customer Portal
  ↓
Negotiation
  ↓
Risk Recalculation
  ↓
Re-approval if needed
  ↓
Confirmation
  ↓
Fulfillment
  ↓
Billing
  ↓
Payment
  ↓
Deal Health / Reporting
```

---

# 3. Source of Truth

Use the original DealFlow360 requirements and repository documentation as the product source of truth.

Relevant documentation:

```text
docs/PRD.md
docs/ARCHITECTURE.md
docs/DOMAIN_MODEL.md
docs/WORKFLOWS.md
docs/STATE_MACHINES.md
docs/BUSINESS_RULES.md
docs/RBAC.md
docs/API_SPEC.md
docs/SEED_DATA.md
docs/ACCEPTANCE_TESTS.md
docs/IMPLEMENTATION_PLAN.md
docs/NEXT_STEPS.md
docs/TRACEABILITY.md
```

Also inspect the UI/design specification when changing frontend behavior.

Do not invent product behavior when the repository already defines it.

When implementation and documentation disagree:

1. Inspect the existing code and tests.
2. Determine whether the difference is intentional.
3. Preserve correct existing behavior.
4. Update documentation when the intended behavior changes.

---

# 4. Roles

## Sales Representative

- Creates quotations
- Adds products/services/subscriptions
- Changes quantities
- Applies discounts
- Views margin impact
- Adds upsell/cross-sell products
- Submits quotations
- Tracks approvals
- Tracks fulfillment
- Responds to customer negotiation requests

## Sales Manager / Approver

- Reviews approval-required quotations
- Approves
- Rejects
- Returns for revision
- Configures discount tiers
- Configures approval chains
- Monitors deal health

## Finance / Operations

- Handles second-level approvals
- Manages fulfillment splits
- Manages backorders
- Handles recurring billing
- Reconciles billing
- Handles credit notes

## Customer

- Accesses their quotations
- Reviews quotation details
- Asks line-level questions
- Requests changes
- Counters discounts
- Confirms final terms

## Admin

- Manages products
- Manages categories
- Manages price lists
- Manages discount tiers
- Manages approval chains
- Manages warehouses
- Manages subscription plans
- Manages reporting / analytics

Do not invent a separate warehouse-staff role unless explicitly requested.

---

# 5. Domain Model

Core entities:

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

Before introducing a new entity, check whether an existing domain entity already represents the required concept.

---

# 6. Core Invariants

Do not break these without an explicit architecture decision.

1. A quotation belongs to exactly one customer.
2. A quotation has an owning sales representative.
3. Customer portal access is restricted to the authenticated customer's quotations.
4. Discounts are validated server-side.
5. Approval cannot be bypassed.
6. Material quotation changes can invalidate approval.
7. Negotiation can trigger risk recalculation.
8. Inventory allocation cannot exceed available/reservable stock.
9. Billing schedules follow subscription terms.
10. Audit records are preserved.
11. Totals and margins are derived from authoritative business data.
12. Client-provided role, customer ID, approval state, inventory, margin, invoice state, and payment state are never trusted blindly.

---

# 7. Quotation State Machine

Primary lifecycle:

```text
DRAFT
  ↓
PENDING_APPROVAL
  ↓
APPROVED
  ↓
SENT
  ↓
UNDER_NEGOTIATION
  ↓
CONFIRMED
  ↓
FULFILLMENT
```

Possible alternate states:

```text
REJECTED
REVISION_REQUIRED
```

Do not allow arbitrary frontend status mutation.

Use explicit domain operations where appropriate:

```text
submitQuotation()
approveQuotation()
rejectQuotation()
requestRevision()
sendQuotation()
startNegotiation()
requestNegotiationChange()
confirmQuotation()
```

---

# 8. Risk Engine

The Risk Engine evaluates quotation risk.

It answers:

> How risky is this quotation, and why?

It does not directly own approval workflow state.

Pipeline:

```text
Quotation
  ↓
Find Applicable Rules
  ↓
Evaluate Every Line
  ↓
Calculate Discount Violations
  ↓
Calculate Blended Deal Risk
  ↓
Classify Risk
```

Example:

```text
Gold customer

Hardware       → 15% ceiling
Services       → 10% ceiling
Subscriptions  → 15% ceiling
```

A service with an 18% requested discount against a 10% ceiling has an 8 percentage-point violation.

Do not make risk logic specific to a customer, quotation ID, product ID, or demo scenario.

---

# 9. Blended Risk

The system must consider the overall pattern of violations, not only the single worst line.

Example:

```text
Line A → 2 points over
Line B → 3 points over
Line C → 2 points over
```

The exact mathematical formula can be an implementation decision unless a more specific formula is already documented.

When implementing:

- Keep it deterministic.
- Keep it explainable.
- Avoid unexplained magic numbers.
- Persist enough information to explain the result.
- Keep approval thresholds configurable.

---

# 10. Approval Engine

The Approval Engine determines who must approve a risky quotation.

Conceptual routing:

```text
Low Risk
  → No Approval

Medium Risk
  → Sales Manager

High Risk
  → Sales Manager
  → Finance / Operations
```

Thresholds must come from configuration.

Do not implement quote-specific routing logic.

Keep the responsibilities separate:

```text
Risk Engine
→ How risky is the deal?

Approval Engine
→ Who needs to approve it?
```

---

# 11. Approval Invalidation

Approval is tied to the commercial state/version of the quotation.

Material changes can invalidate an existing approval.

Examples:

```text
Discount changed
Quantity changed
Price changed
Relevant product changed
Commercial terms changed
```

Expected flow:

```text
Approved
  ↓
Material Change
  ↓
Risk Recalculation
  ↓
Approval Validity Check
  ↓
Re-approval if required
```

Never let a materially modified quotation retain an obsolete approval.

---

# 12. Customer Portal

The customer portal is a separate restricted experience.

It must not simply be the internal application with a different label.

Customer APIs must not expose internal information such as:

```text
Internal margin
Internal approval notes
Internal risk configuration
Other customers
Internal operational metadata
```

Customer authorization must be enforced server-side.

Conceptually:

```text
authenticatedCustomer.id
==
quotation.customer_id
```

If false, deny access.

---

# 13. Negotiation

Customer negotiation belongs to the quotation lifecycle.

Customers can:

- Ask questions
- Request line changes
- Request quantity changes
- Counter discounts
- Request commercial changes
- Confirm final terms

Material negotiation changes must trigger:

```text
Quote Version / Commercial Change
  ↓
Risk Recalculation
  ↓
Approval Check
  ↓
Re-approval when required
```

Negotiation must remain traceable to the quotation/version involved.

---

# 14. Margin

Conceptually:

```text
Margin = Revenue - Estimated Cost
```

The backend is authoritative.

Do not trust a margin value supplied by the client.

---

# 15. Upsell / Cross-Sell

Recommendations may use:

- Product pairings
- Historical co-purchase behavior
- Promotions
- Minimum margin thresholds

Adding a recommendation should update:

```text
Quotation
Totals
Margin
Relevant risk/approval state if applicable
```

---

# 16. Fulfillment

Inventory is backend-controlled.

Do not allocate more than available/reservable inventory.

Example:

```text
Demand: 20

Main Warehouse: 12
East Depot: 20
```

Valid allocation:

```text
Main Warehouse → 12
East Depot     → 8
```

Support:

```text
Recommended Split
Manual Override
Partial Fulfillment
Backorder
Stock Arrival
Backorder Consolidation
```

Manual override cannot bypass inventory validation.

---

# 17. Backorders

When:

```text
Demand > Allocatable Stock
```

the remaining quantity becomes a backorder.

Do not mark the entire order fulfilled when only part of the demand has been fulfilled.

---

# 18. Billing

A quotation may contain:

```text
One-Time Products
One-Time Services
Recurring Subscriptions
```

One-time and recurring billing must retain their separate semantics.

A hybrid deal may result in:

```text
One-Time Invoice
+
Recurring Billing Schedule
```

---

# 19. Subscription Proration

Use one consistent proration approach.

Conceptually:

```text
Proration
=
Rate
×
Quantity Change
×
Unused Period Fraction
```

The exact day-count convention must be consistent across the application.

---

# 20. Audit

Important business events must be recorded.

Useful information:

```text
Actor
Timestamp
Action
Entity
Entity ID
Previous State
New State
Reason
Version
```

Examples:

```text
Quotation Created
Discount Changed
Approval Requested
Approval Approved
Approval Rejected
Revision Requested
Negotiation Started
Negotiation Submitted
Quotation Re-approved
Inventory Allocated
Invoice Issued
Payment Recorded
```

Do not silently rewrite historical audit records.

---

# 21. Backend Authority

The frontend is not a security boundary.

Backend validation is required for:

```text
Authentication
Authorization
Customer ownership
Quotation state
Discount eligibility
Risk
Approval
Inventory
Billing
Payment
```

A hidden or disabled UI button is not authorization.

---

# 22. API Rules

Prefer domain operations over arbitrary state mutation.

Prefer:

```text
POST /quotations
POST /quotations/:id/submit
POST /quotations/:id/approve
POST /quotations/:id/reject
POST /quotations/:id/send
POST /quotations/:id/negotiate
POST /quotations/:id/confirm
POST /quotations/:id/fulfill
```

over allowing a client to directly set:

```text
status = APPROVED
```

without transition validation.

Validate:

- Authorization
- State transitions
- Version conflicts
- Business rules
- Ownership
- Monetary values

---

# 23. Concurrency and Versioning

Multiple actors may interact with the same quotation.

Examples:

```text
Sales Rep edits quotation
Customer negotiates quotation
Manager reviews quotation
```

Use appropriate version checks or optimistic concurrency controls.

A stale client should not silently overwrite newer commercial state.

---

# 24. Money

Use a deterministic monetary representation.

Prefer:

```text
Decimal / NUMERIC
```

or a clearly documented minor-unit integer strategy.

Do not use ordinary binary floating-point as the persisted monetary representation.

---

# 25. Transactions

Use database transactions when multiple changes must succeed or fail together.

Examples:

```text
Approve quotation
+
Update quotation state
+
Create audit entry
```

```text
Allocate inventory
+
Create allocation
+
Update remaining demand
```

```text
Record payment
+
Update invoice balance/status
+
Create audit event
```

---

# 26. UI Rules

The UI should represent backend state.

Do not create independent frontend business truth.

Good:

```text
Backend:
PENDING_APPROVAL

Frontend:
Shows Pending Approval
```

Bad:

```text
Frontend:
discount > arbitrary local threshold
→ show Pending Approval
```

unless that is explicitly a preview and the backend remains authoritative.

---

# 27. UI Style

The application should feel like an enterprise B2B operations product.

Prefer:

- Clear information hierarchy
- Dense but readable information
- Tables for tabular data
- Status badges
- Risk indicators
- Approval timelines
- Audit history
- Clear action states
- Useful loading/error/empty states
- Responsive layouts

Avoid:

- Generic AI-dashboard aesthetics
- Excessive gradients
- Decorative widgets without business purpose
- Fake metrics
- Public e-commerce marketplace styling

---

# 28. Scope Discipline

When changing one feature, do not casually modify unrelated modules.

A quotation-builder change should not automatically become:

```text
Global CSS rewrite
Authentication rewrite
Billing rewrite
Customer portal redesign
Database redesign
```

unless the requested work actually requires those changes.

Prefer the smallest coherent change.

---

# 29. Dependency Discipline

Before adding a dependency:

1. Check whether the existing stack already provides the functionality.
2. Follow repository conventions.
3. Add only what is necessary.
4. Document material architectural impact.

---

# 30. Testing Requirements

After meaningful implementation work:

```text
Run relevant unit tests
Run relevant integration tests
Run type checks
Run linting when configured
Verify affected API/UI flow
Check failure cases
Check regressions
```

Important categories:

```text
Authentication
RBAC
Customer Isolation

Pricing
Discount Rules
Risk

Approval
Approval Invalidation

Quotation Versioning
Negotiation

Upsell / Cross-Sell

Warehouse Allocation
Backorders

Subscription Billing
Proration
Payments

Deal Health
Audit Logging
```

Never report a feature as complete merely because the application builds.

---

# 31. Documentation Rules

When behavior changes, update the relevant documentation.

```text
Business rule changed
→ docs/BUSINESS_RULES.md

State changed
→ docs/STATE_MACHINES.md

API changed
→ docs/API_SPEC.md

Entity changed
→ docs/DOMAIN_MODEL.md

Workflow changed
→ docs/WORKFLOWS.md

Architecture changed
→ docs/ARCHITECTURE.md
```

Any meaningful change also requires updating `AGENTS.md`.

---

# 32. Mandatory AGENTS.md Update

Every meaningful agent task must update this file.

Meaningful work includes:

- New feature
- Bug fix
- Database change
- API change
- Business rule change
- Authentication change
- Authorization change
- Risk-engine change
- Approval-engine change
- Fulfillment change
- Billing change
- UI workflow change
- Architecture change
- Dependency change

At minimum update:

```text
Current Project Status
Recent Changes
Implemented Features
Known Issues
Active Technical Decisions
Next Recommended Work
```

Do not leave these sections stale.

---

# 33. Do Not Erase History

When updating this file:

- Preserve important prior decisions.
- Keep recent changes concise.
- Do not delete known issues simply because they are inconvenient.
- Do not rewrite history to make unfinished work look complete.

---

# 34. Agent Handoff

When completing work, record:

```text
What changed
Why it changed
Where it changed
How it works
What was tested
What remains
Known problems
Important technical decisions
```

A future agent should be able to continue without rediscovering the entire task.

---

# 35. Current Project Status

**Last updated:** 2026-09-05

**Current phase:** Phases 1-3 complete (foundation, master data, quotation
engine). Risk engine is next. No admin/quotation UI yet.

**Stack (implemented, versions pinned exactly):**

```text
API   Express 5.2.1 · Node 24 · TypeScript 5.9.3 (ESM)
Data  PostgreSQL 18.6 · Prisma 7.10.0 + @prisma/adapter-pg
Web   React 19.2.8 · Vite 8.2.2 · Tailwind 4.3.3 · React Router 7 · TanStack Query 5
Test  Vitest 5.0.0 · Supertest 7.2.2
```

Layout is an npm-workspaces monorepo: `server/`, `web/`.

## Implemented Features

```text
Monorepo scaffold, shared tsconfig, env validation (Zod, fail-fast)
PostgreSQL schema for the ENTIRE domain model - 31 tables, three migrations
  + 27 CHECK constraints, 1 partial unique index, 1 sequence
Authentication
  - server-side session store; opaque 256-bit token, only its SHA-256 digest stored
  - httpOnly + SameSite=Lax cookie, Secure in production
  - scrypt password hashing via node:crypto (N=65536, r=8, p=1), parameters
    encoded per-hash so cost can be raised without invalidating credentials
  - uniform failure for wrong password / unknown email / inactive account,
    plus a dummy hash on the miss path so timing does not leak existence
  - separate internal and portal login endpoints that refuse each other's credentials
RBAC
  - capability model transcribed from docs/RBAC.md (32 capabilities x 5 roles)
  - requireAuth / requireRole / requireCapability / requireAnyCapability /
    assertCapability / requireInternal / requireCustomer
  - internal and portal guards mounted on ROUTERS, not per handler
  - role and customerId re-read from the database on every request
Audit
  - append-only writer that takes a transaction client, so state change and
    audit row commit together; no update or delete path exists
  - actor FK is ON DELETE RESTRICT, so attribution cannot be erased
  - recordConfigChange + diffFields: master-data writes record only the columns
    that actually changed, with their previous values
Admin user provisioning (list / create / deactivate, sessions revoked on deactivate)
MASTER DATA (Phase 2) - full CRUD behind capability gates, every write audited:
  - customers/      CustomerTier, Customer
  - catalog/        Category, Product (server-computed unit margin), ProductVariant
  - pricing/        PriceList, PriceListItem, DiscountRule
                    + resolveEffectiveCeiling(): pure, reused by the risk engine
  - approvalConfig/ ApprovalRule + validateApprovalBands(): rejects any edit that
                    would leave a gap, overlap or uncovered risk score
  - inventory/      Warehouse, Inventory (Option A semantics), stock receive
  - subscriptionPlans/  SubscriptionPlan
  - recommendationConfig/ ProductPairing, Promotion
QUOTATION ENGINE (Phase 3) - server-authoritative commercial arithmetic:
  - quotationMath.ts      PURE calculation, one defined order, Prisma.Decimal only
  - quotationStates.ts    PURE transition table + edit gate
  - priceResolution.ts    price list -> base price, plus variant uplift (in pricing/)
  - quotationNumber.ts    Q-<year>-<6 digits> from a Postgres sequence
  - create / list / get / patch / recalculate / submit
  - lines: add (merging identical terms) / update / remove
  - version bump on material change only; conditional-update concurrency
  - rep scoped to own quotations; 404 not 403 on a scoped miss
  - cost and margin OMITTED for callers without margin:view
Uniform list contract { data, meta: { total, limit, offset } } on every collection
  endpoint, /api/users included
Canonical decimal serialisation (formatMoney / formatPercent / formatWeight /
  formatRisk) so the same stored value never renders two ways
Structured error taxonomy -> stable machine-readable codes + Prisma error mapping
Health endpoint that reports database reachability
Demo seed data per docs/SEED_DATA.md (idempotent)
Web: Vite + Tailwind shell, both sign-in surfaces, capability-filtered navigation,
  Overview page (real session + health data only), Users page (fully wired),
  honest "not implemented" placeholders for every unbuilt module
```

## In Progress

```text
Nothing. Slice 3 ended at a clean, fully tested state.
```

## Blocked

```text
None.
```

## Verification performed

```text
npm test          -> 460 passed, 19 files, 0 failed  (284s)
                     unit 8 files: password, permissions, pagination,
                                   approvalBands, discountRules, priceResolution,
                                   quotationMath, quotationStates
                     integration 11 files: auth, rbac, users, customers, catalog,
                                   pricing, inventory, subscriptionPlans,
                                   recommendationConfig, quotations, quotationLines
npm run typecheck -> clean, both workspaces
npm run build     -> web production build succeeds (316 kB / 97 kB gzip)

Slice 3 targeted runs, in the order they were written:
  tests/unit/priceResolution.test.ts   -> 9 passed
  tests/unit/quotationMath.test.ts     -> 21 passed
  tests/unit/quotationStates.test.ts   -> 21 passed
  tests/integration/quotations.test.ts -> 43 passed
  tests/integration/quotationLines.test.ts -> 34 passed
  regression: auth + rbac + users      -> 51 passed
  regression: all unit + pricing + catalog -> 191 passed

Arithmetic is pinned against the canonical quotation in docs/SEED_DATA.md, asserted
as exact strings rather than floats: subtotal 1750000.00, discount 201000.00,
tax 278820.00, grand total 1827820.00, cost 1250000.00, margin 299000.00.
Also asserted: grandTotal == sum of lineTotal, discountTotal == sum of
lineDiscount, order-discount allocation summing to the paisa, 0.10+0.20 == 0.30.

Slice 2 live smoke against the real server on :4000, 38 checks - see the slice 2
entry in §36. Not repeated for slice 3; the integration suite exercises the same
Express app in-process through Supertest.
```

---

# 36. Recent Changes

## 2026-09-05 — Slice 2: Phase 2 Master data (backend)

**What changed.** All 12 master-data entities gained full CRUD behind the existing
capability gates, plus two pure rule functions that later slices depend on.

**Why.** `docs/IMPLEMENTATION_PLAN.md` Phase 2. The quotation engine cannot be
built without customers, a catalogue, prices and ceilings to read, and the risk
engine needs `resolveEffectiveCeiling` to exist before it can score anything.
Backend only, per instruction — admin configuration screens are a later pass.

**Where.**

```text
server/src/http/pagination.ts              NEW  shared list contract
server/src/http/fields.ts                  NEW  Zod field primitives + decimal formatters
server/src/http/middleware/auth.ts         +requireAnyCapability, +assertCapability
server/src/http/routes.ts                  11 new routers mounted
server/src/modules/audit/auditService.ts   AuditEntity +10 master-data names
server/src/modules/audit/configAudit.ts    NEW  diffFields, recordConfigChange
server/src/modules/auth/permissions.ts     +4 read capabilities via MASTER_DATA_READS
server/src/modules/users/{userService,userRoutes}.ts   list -> envelope
server/src/modules/customers/{customerService,customerRoutes}.ts            NEW
server/src/modules/catalog/{catalogService,catalogRoutes}.ts                NEW
server/src/modules/pricing/{discountRules,pricingService,pricingRoutes}.ts  NEW
server/src/modules/approvalConfig/{approvalBands,approvalRuleService,approvalRuleRoutes}.ts NEW
server/src/modules/inventory/{inventoryService,inventoryRoutes}.ts          NEW
server/src/modules/subscriptionPlans/{subscriptionPlanService,subscriptionPlanRoutes}.ts NEW
server/src/modules/recommendationConfig/{recommendationConfigService,recommendationConfigRoutes}.ts NEW
server/prisma/migrations/20260905103502_master_data_constraints/            NEW  4 CHECKs
server/tests/helpers/fixtures.ts           +seedMasterData, +seedApprovalBands
server/tests/unit/{pagination,approvalBands,discountRules}.test.ts          NEW
server/tests/integration/{customers,catalog,pricing,inventory,subscriptionPlans,recommendationConfig}.test.ts NEW
web/src/lib/api.ts                         +apiList, ListResponse, queryString
web/src/routes/UsersPage.tsx               reads data.meta.total
docs/API_SPEC.md                           conventions + every implemented endpoint
docs/BUSINESS_RULES.md                     "As implemented" for rules 1,2,4,5,6,7,9,11,12
docs/DOMAIN_MODEL.md                       deviations 8-9: 27 constraints, conventions
```

**Endpoints added (38).** Paths follow `docs/API_SPEC.md` where it specifies them
and extend it for the entities it omits:

```text
/api/customer-tiers          GET POST PATCH/:id
/api/customers               GET GET/:id POST PATCH/:id
/api/categories              GET POST PATCH/:id
/api/products                GET GET/:id POST PATCH/:id
                             GET/:id/variants POST/:id/variants PATCH/:id/variants/:variantId
/api/subscription-plans      GET POST PATCH/:id
/api/price-lists             GET GET/:id POST PATCH/:id
                             PUT/:id/items/:productId DELETE/:id/items/:productId
/api/discount-rules          GET GET/effective POST PATCH/:id
/api/approval-rules          GET POST PATCH/:id
/api/warehouses              GET POST PATCH/:id
                             GET/:id/inventory PATCH/:id/inventory/:productId
                             POST/:id/inventory/:productId/receive
/api/product-pairings        GET POST PATCH/:id
/api/promotions              GET POST PATCH/:id
```

**How it works.** Every module follows one shape: a `select` const that
structurally cannot leak private columns, a `toXView` mapper that formats decimals
canonically, service-layer validation ahead of Prisma so callers get business
errors rather than constraint violations, and `prisma.$transaction` wrapping the
write together with `recordConfigChange(tx, …)`. Nothing in master data is
deleted — every entity carries `active` — except price-list items, which hold no
history and whose removal simply falls pricing back to `base_price`.

**What was tested.** See §35 "Verification performed". 263 new tests, taking the
suite from 69 to 332.

**What remains.** The admin configuration UI (slice 2d).

**Known problems.** See §38, item 10.

## 2026-09-05 — Slice 1: Phase 1 Foundation

**What changed.** The repository went from documentation-only to a running,
tested application skeleton.

**Why.** `docs/IMPLEMENTATION_PLAN.md` Phase 1 and
`docs/AGENT_INSTRUCTIONS.md` §3 both put authentication and RBAC first;
`AGENT_INSTRUCTIONS.md` §85 forbids building polished UI ahead of domain logic.
The slice is therefore backend-heavy with deliberately thin UI.

**Where.**

```text
package.json  tsconfig.base.json  .gitignore  .env.example  .editorconfig
server/
  package.json  tsconfig.json  prisma.config.ts  vitest.config.ts
  prisma/schema.prisma  prisma/migrations/20260905090720_init/  prisma/seed.ts
  src/config/env.ts
  src/db/prisma.ts
  src/http/{errors,logger,routes,types}.ts
  src/http/middleware/{auth,errorHandler,validate}.ts
  src/modules/audit/auditService.ts
  src/modules/auth/{password,sessionService,cookies,permissions,authService,authRoutes}.ts
  src/modules/users/{userService,userRoutes}.ts
  src/{app,main}.ts
  tests/{globalSetup,setup}.ts  tests/helpers/{db,fixtures,api}.ts
  tests/unit/{password,permissions}.test.ts
  tests/integration/{auth,rbac,users}.test.ts
web/
  index.html  vite.config.ts  tsconfig.json
  src/{main.tsx,App.tsx,index.css}
  src/lib/{api.ts,types.ts,auth.tsx}
  src/components/{AppShell.tsx,guards.tsx,navigation.ts}
  src/components/ui/{Button,Field,Panel,Badge,Feedback,Table}.tsx
  src/routes/{LoginPage,OverviewPage,UsersPage,PlaceholderPage,PortalHomePage}.tsx
docs/DOMAIN_MODEL.md   (+ "Implementation deviations" section)
docs/PRD.md            (FR-1 deviation recorded)
README.md              (stack, running locally, seeded accounts, commands)
```

**How it works.** Login verifies the password with scrypt, then opens a
transaction that creates the session row, stamps `last_login_at`, and writes the
audit record. The response sets an httpOnly cookie holding a random token whose
digest alone is persisted. Every later request resolves that digest back to the
`users` row, so role and `customer_id` are always database truth. Routers, not
handlers, carry the internal/portal boundary.

**What was tested.** See §35 "Verification performed".

**What remains.** Everything from Phase 3 onward — see §39.

**Known problems.** See §38.

---

# 37. Active Technical Decisions

## Modular Monolith

Use a modular monolith initially.

Reason:

The project needs strong domain boundaries and correct business workflows more than distributed infrastructure.

## Backend as Source of Truth

Reason:

Security and business rules must not be bypassed through client state.

## Configuration-Driven Rules

Discount ceilings and approval thresholds should be data-driven.

## Separate Risk and Approval Engines

Reason:

Risk evaluation and approval routing are related but distinct responsibilities.

## Customer Portal Isolation

Reason:

Customer-facing access must be genuinely restricted.

## Version-Aware Commercial State

Reason:

Approvals and negotiation changes need to correspond to the quotation state/version being evaluated.

## Server-side sessions rather than JWT _(2026-09-05)_

An opaque token in an httpOnly cookie, with only its SHA-256 digest stored.

Reason: role and customer identity are re-read from `users` on every request, so
a role change or deactivation takes effect immediately and a client can never
assert its own role. Revocation is a row delete. Costs one indexed lookup per
request. JWT would have made stale role claims possible and revocation awkward,
which directly conflicts with §6 invariant 12.

## scrypt from `node:crypto` for password hashing _(2026-09-05)_

Reason: memory-hard, ships with Node, no native build step on Windows, no added
dependency (§29). Cost parameters are encoded in each hash and `needsRehash`
reports when a stored hash is below current policy, so cost can be raised later.

## Money as `NUMERIC`, percentages 0–100 _(2026-09-05)_

`Decimal(14,2)` for money, `Decimal(6,3)` for percentages, `Decimal(10,4)` for
risk scores. Percentages are stored as `12.5` meaning 12.5%. Never binary
floating point (§24). Arithmetic uses `Prisma.Decimal`.

## Blended risk model — contract for the risk-engine slice _(2026-09-05)_

The seeded `ApprovalRule` thresholds assume this 0–100 score. Implement it as
specified or change the seed with it.

```text
per line i:  v_i = max(0, discount_i - effective_ceiling_i)   // percentage points
             w_i = gross_i / sum(gross)                       // revenue share 0..1

severity  = max(v_i)                       // one severe line can trigger approval
breadth   = sum(v_i * w_i)                 // several small violations also can
orderRisk = max(0, orderDiscount - tierCeiling)

blended_risk = clamp(severity + breadth + orderRisk, 0, 100)
```

Deliberately not `max()` alone, which `docs/BUSINESS_RULES.md` §3 forbids.
Seeded bands are half-open `[min, max)` and tile 0→∞ with no gap:
`[0,4) → NONE`, `[4,15) → MANAGER`, `[15,∞) → MANAGER_FINANCE`.
Reference points: the canonical quote (Setup Service at 18% against a 10%
ceiling) scores ≈8.2 → MANAGER, satisfying AT-04; a counter to 30% on that line
scores ≈20 → MANAGER_FINANCE, satisfying AT-13.

## Approval validity as two integers _(2026-09-05)_

`Quotation.version` increments on material change and is also the optimistic
concurrency token. `ApprovalInstance.quotation_version` records what was
reviewed; `Quotation.approved_version` records what completed the chain.
Approval is live only while `approved_version == version`.

## Invariants pushed into the database _(2026-09-05)_

27 CHECK constraints plus a partial unique index, across two migrations. Notably
`(role = 'CUSTOMER') = (customer_id IS NOT NULL)`, which makes portal scope a
database invariant, and `product_type <> 'RECURRING' OR subscription_plan_id IS
NOT NULL`, which makes a recurring product without a billing cadence impossible.
Application code still validates first so users get business errors rather than
constraint violations; the constraints are the backstop.

Correction: §35 and this section previously claimed 25. The init migration
actually added 23; the slice-2 migration added 4, giving 27. Verify with
`SELECT count(*) FROM pg_constraint WHERE contype='c' AND
connamespace='public'::regnamespace;`

## Inventory stock semantics — Option A _(2026-09-05)_

```text
availableQuantity = units free to allocate
reservedQuantity  = units already committed to a fulfillment
physical stock    = availableQuantity + reservedQuantity
```

Allocation moves units from available to reserved inside one transaction, so the
two counters cannot disagree and no relational constraint between them is needed.
Both are independently non-negative in the database.

Consequence for the fulfillment slice: allocatable stock is `availableQuantity`
directly, never `available - reserved`. The configuration API deliberately has no
way to set `reservedQuantity` — the field is absent from a `.strict()` schema, so
a request carrying it is rejected — because editing it would let the same unit be
promised to two fulfillments.

The rejected alternative (Option B) read `availableQuantity` as total physical
stock with reserved as a subset, needing `reserved <= available` enforced and
making every allocation a two-column read-modify-write.

## Canonical decimal serialisation _(2026-09-05)_

`Prisma.Decimal.toString()` drops trailing zeros, so the same stored value
surfaced as `"80000"` from one endpoint and `"80000.00"` from another. Every
decimal response field now goes through `formatMoney` / `formatPercent` /
`formatWeight` / `formatRisk` in `src/http/fields.ts`, fixing the scale per column
family (2 / 3 / 4 / 4). A client can compare figures from different endpoints
without normalising them first.

Model row types use `Prisma.Decimal` rather than a structural
`{ toString(): string }` placeholder, so the compiler catches a field that skipped
a formatter.

## Master-data write conventions _(2026-09-05)_

Every module in `src/modules/*` that owns configuration follows one shape, and a
new one should too:

```text
select const        -> structurally cannot leak a private column
toXView mapper      -> canonical decimal formatting, derived fields computed here
service validation  -> runs BEFORE Prisma, so callers get business errors
prisma.$transaction -> write + recordConfigChange(tx, …) commit together
```

All configuration writes share `AuditAction.CONFIGURATION_CHANGED`, with
`entityType` distinguishing what changed, so "every configuration change last
week" is one indexed query. `diffFields` records only the columns that actually
differ together with their previous values, and returns null for a no-op so no
empty audit row is written.

Nothing in master data is deleted; every entity carries `active`. The single
exception is `PriceListItem`, which holds no history — removing an entry simply
falls pricing back to `Product.base_price`.

## Read capabilities separated from write capabilities _(2026-09-05)_

`customers:read`, `catalog:read`, `pricing:read` and `inventory:read` are granted
to all four internal roles via one `MASTER_DATA_READS` list spread into each,
while writes stay on the `*:configure` capabilities that `docs/RBAC.md` assigns.
Reason: a sales rep cannot build a quotation without reading the customer list and
the catalogue, but must not be able to change either. Declaring the reads once
stops the four role lists drifting apart.

`CustomerTier` is the one entity with per-field authority: the router admits
either `customers:configure` or `discount-rules:configure`, then the handler uses
`assertCapability` so only an admin may rename or deactivate a tier while only a
manager-or-admin may move its ceiling. `docs/RBAC.md` gives those two rows to
different roles and a tier carries both kinds of field.

## Approval bands must tile the risk axis _(2026-09-05)_

`validateApprovalBands` runs on every create and patch against the whole projected
active set, not just the row being touched. Bands are half-open `[min, max)` with
a null maximum meaning unbounded, and must cover `[0, ∞)` with no gap and no
overlap. A gap is a silent approval bypass — a score landing in it would route to
nobody — which §6 invariant 5 forbids. The common trigger is deactivating a middle
band, which is why the whole set is validated rather than the edited row.

`GET /api/approval-rules` returns a `coverage: { valid, problems[] }` block beside
the rows so a configuration screen can warn without a second request.

## `tsx` at runtime, `tsc --noEmit` for typechecking _(2026-09-05)_

Prisma 7 is ESM-only and emits its client as TypeScript source, and its docs
recommend `moduleResolution: bundler`, which permits extensionless relative
imports that bare Node ESM would reject. Running through `tsx` avoids that
mismatch. There is no `tsc` emit step for the server; bundling is deferred to
demo hardening.

## Prisma pinned to 7.10.0, TypeScript to 5.9.3 _(2026-09-05)_

The `prisma` CLI's `latest` npm tag currently points at an `8.0.0` release
candidate while `@prisma/client` `latest` is `7.10.0`; both are pinned to 7.10.0
so CLI and client agree. TypeScript is held at the 5.9.x line because that is
what Prisma 7 states as recommended, even though 7.0.2 is published.

## npm install-scripts allowlist _(2026-09-05)_

npm 12 blocks install scripts by default. `prisma`, `@prisma/engines` and
`esbuild` are allowlisted in root `package.json` under `allowScripts`, pinned by
exact version — they need their scripts to fetch platform binaries.

---

# 38. Known Issues

```text
1. npm audit reports 4 high-severity advisories, all inside the `prisma` CLI
   dev dependency: deepmerge-ts (<8, stack exhaustion) via @prisma/config, and
   mysql2 (<=3.23.0) which the CLI bundles for MySQL introspection.
   Not in the runtime dependency graph; mysql2 is never loaded with a PostgreSQL
   datasource. The offered fix downgrades to prisma@6, which would desync CLI and
   client. Accepted; recheck when Prisma ships an update.

2. No rate limiting on the login endpoints. Timing and message shape do not leak
   account existence, but nothing throttles guessing. Add before any deployment
   beyond local development.

3. No CSRF token. SameSite=Lax blocks the cross-site form-POST shape, and the API
   requires application/json, but a token should be added if a cookie-authenticated
   endpoint ever needs to accept a non-JSON content type.

4. Magic-link customer login (docs/PRD.md FR-1) is not implemented; email +
   password only.

5. Internal self-signup is intentionally absent - accounts are admin-provisioned.
   Deviation recorded in docs/PRD.md FR-1.

6. Frontend has no automated tests yet. Its behaviour was verified manually and
   through the API suite. Add component tests when the quotation builder lands.

7. No generic settings table. Deal-health thresholds ("inactive beyond configured
   days", docs/PRD.md 17) have nowhere to live yet; add with the deal-health slice.

8. 24 of the 31 tables have no code touching them yet. They were created in one
   migration on purpose (the domain model is frozen in docs), but they are
   unexercised, so expect small corrections as each slice lands.
   Slice 2 reduced this: 12 master-data tables are now exercised. The untouched
   set is now the transactional half - quotations, approvals, negotiation,
   fulfillment, billing, deal health.

9. Web bundle is a single 300 kB chunk. Fine at this size; revisit route-level
   code splitting when the module count grows.

10. ProductPairing and Promotion cascade-delete with their product. Products are
    deactivated rather than deleted in normal operation, so this is latent, but a
    future hard delete would silently drop recommendations. Pinned by a test.

11. Live smoke writes touch the DEVELOPMENT database. The slice-2 run created a
    warehouse, a discount rule and +5 laptop stock, all reverted afterwards and
    verified back to seeded values. Prefer `npm test` (which uses
    dealflow360_test) for anything repeatable.

12. Master data has no admin UI. Every Phase 2 endpoint is reachable only by HTTP
    client; the configuration screens listed in docs/AGENT_INSTRUCTIONS.md 11 are
    a later pass.
```

Do not claim an issue is fixed unless repository evidence and tests support that claim.

---

# 39. Next Recommended Work

Slice 2 is finished — backend, tests and documentation. Continue in order. Each
slice should end with tests, documentation and an `AGENTS.md` update.

```text
Slice 2d Admin configuration UI
         Screens for the 12 master-data entities. The endpoints, list envelope and
         capability list the navigation already reads are all in place.
         Optional: it can also be deferred until after the quotation engine, since
         the demo flow needs a quotation builder more than it needs config screens.

Slice 3  Quotation engine
         Quotation + lines, price resolution (price list -> base price fallback),
         discount and tax maths in Prisma.Decimal, margin from unit_cost,
         version bump on material change, optimistic concurrency on version.
         Quotation builder UI.

Slice 4  Risk engine
         Reuse resolveEffectiveCeiling() and violationPoints() from
         modules/pricing/discountRules.ts - do not reimplement them. Blended score
         per the formula in §37. Persist the per-line explanation.
         Covers AT-03, AT-04, AT-05.

Slice 5  Approval engine
         Route with bandForRisk() from modules/approvalConfig/approvalBands.ts,
         multi-level MANAGER -> FINANCE, approve / reject / return, invalidation on
         material change. Covers AT-06, AT-07.

Slice 6  Recommendations (pairings, promotions, margin floor) - AT-08
Slice 7  Fulfillment (allocation, override, backorder, consolidation) - AT-09, AT-10
Slice 8  Billing (hybrid invoicing, schedules, proration, payments) - AT-11, AT-15
Slice 9  Customer portal quotations + negotiation re-entry - AT-02, AT-12, AT-13, AT-14
Slice 10 Deal health + reporting + PDF/XLS export - AT-16
Slice 11 Demo hardening
```

Notes for whoever picks this up:

```text
- Read docs/BUSINESS_RULES.md and the relevant state machine before writing code.
- Copy the module shape described in §37 "Master-data write conventions".
- Reuse recordAudit(tx, ...) / recordConfigChange(tx, ...) inside the same
  transaction as the state change.
- Ask for a capability, never a role, in route guards.
- Every decimal in a response goes through a formatter from src/http/fields.ts.
- Every collection endpoint returns { data, meta } via src/http/pagination.ts.
- Allocatable stock is Inventory.availableQuantity directly (Option A, §37).
- Portal responses must never carry margin, cost, risk internals or approval notes.
- The AuditAction constant already lists the actions later slices need.
- Regenerate the Prisma client after any schema change: npm run db:generate.
```

---

# 40. Final Agent Rule

Before finishing work:

```text
Did I preserve the business model?
Did I preserve authorization?
Did I preserve state transitions?
Did I preserve data integrity?
Did I test the behavior?
Did I update the relevant documentation?
Did I update AGENTS.md?
Did I leave the next agent enough context?
```

If any answer is no, the task is not fully complete.
