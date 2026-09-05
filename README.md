# DealFlow360

A B2B quote-to-cash platform. A sales rep builds a quotation, a pricing engine
resolves the discount ceiling for every line, a risk engine scores the exceptions,
and the approval chain that results is decided by policy rather than by whoever is
asking. The customer sees the quote in their own portal, accepts it or counters it,
and the order flows on to warehouse allocation and billing.

The point of the system is that the governance is not advisory. A discount over its
ceiling cannot quietly ship: it is scored, it raises the approval rungs the score
demands, and every decision lands in an audit log the database itself refuses to
let anyone rewrite.

---

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Scripts](#scripts)
- [Roles](#roles)
- [How a deal moves](#how-a-deal-moves)
- [The engines](#the-engines)
- [API surface](#api-surface)
- [Testing](#testing)
- [Project layout](#project-layout)
- [Known gaps](#known-gaps)

---

## What it does

**Quoting.** Build a quotation line by line. Each line is priced from the
customer's tier price list, and the applicable discount ceiling is resolved from
the most specific matching rule — tier + category beats tier alone beats a global
backstop. The ceiling is *snapshotted onto the line*, so tightening a rule later
does not retroactively rewrite quotes that were already priced.

**Risk and approval.** Violations are blended into one score from four weighted
components: the severity of the worst breach, how many lines breach, how much
value is exposed, and any order-level discount. The score is matched against
configurable bands that decide whether the quote is auto-approved, needs a Sales
Manager, or needs Manager *then* Finance. The second rung cannot be cleared before
the first — enforced structurally, not by asking reviewers to take turns.

**Customer portal.** A separate shell where the buyer reviews a sent quotation and
either accepts it or submits a counter-offer: a better price on a line, a different
quantity, a line removal, or a question. Cost, margin, ceiling and risk fields are
stripped from the portal payload.

**Negotiation loop.** A rep applies an inbound counter-offer. The customer's terms
are written onto the line, the quote is re-versioned and re-scored, and if the new
risk crosses a threshold the approval chain re-enters automatically. The customer
cannot finalise terms that are still awaiting internal sign-off.

**Fulfillment.** Allocates each line across warehouses by available stock,
minimising shipments. Short quantities become visible backorders that become
consolidatable once stock is restocked. A human can override the split; the server
still validates the stock exists.

**Billing.** One-time lines produce an invoice; recurring lines open a subscription
with a generated schedule. Payments and credit notes are recorded against the
invoice, with a credit capped at what has actually been paid. Billing and
fulfillment are *siblings* downstream of a confirmed order, not a sequence — an
order is invoiceable whether or not its stock has moved.

**Deal health.** A background sweep raises alerts for stalled deals, discounts
still live above their ceiling, and delivery dates that have drifted past what was
promised. Each alert says why it was raised and what to do about it, tracks repeat
follow-ups, and closes itself when the cause disappears.

**Reporting.** Pipeline, sales by rep, product performance, approval activity and
inventory position, with date and status filters and PDF/XLS export.

**Audit.** Every commercial decision records who, when, what changed, and why.
`audit_logs` is append-only, enforced by a database trigger rather than convention.

---

## Architecture

```
apps/
  api/          Express + Drizzle ORM + PostgreSQL
    src/
      domain/   pricing · risk · quotation · approval · portal · fulfillment
                billing · dealhealth · recommendation · reporting · audit · config
      http/     route modules, one per area
      db/       schema, migrations, seed
      auth/     JWT, bcrypt, magic links
  web/          React 19 + Vite + React Router
    src/
      pages/    workspace screens and portal screens
      nav.ts    role → page matrix
packages/
  shared/       money arithmetic, enums, state machines, labels
```

**Money is integer paise; rates are basis points.** No floats anywhere in
pricing, so totals are exact and reproducible. `packages/shared/src/money.ts`
holds the apportionment helpers.

**The domain layer owns the rules.** HTTP handlers validate and delegate; they
never mutate state directly. Every state transition has exactly one legal path
through a domain service, so a rule cannot be bypassed by hitting a different
endpoint.

**Guards are per-route, not per-router**, so an unmatched path 404s instead of
403ing and leaking which routes exist.

Stack: TypeScript 7 (strict, `noUncheckedIndexedAccess`), Node 22+, PostgreSQL 16,
pnpm workspaces, Vitest.

---

## Getting started

### Prerequisites

- **Node.js 22+** (developed on 25)
- **pnpm 10** — `corepack enable && corepack prepare pnpm@10.32.1 --activate`
- **PostgreSQL 16** running locally

### 1. Install

```bash
pnpm install
```

### 2. Create the databases

```bash
createdb dealflow360
createdb dealflow360_test    # only needed to run the test suite
```

### 3. Configure the environment

```bash
cp apps/api/.env.example apps/api/.env
```

Then edit `apps/api/.env`:

- `DATABASE_URL` — replace the role name if yours is not `rudra`
- `JWT_SECRET` — must be at least 32 characters. Generate one with
  `openssl rand -hex 32`

The test suite reads `apps/api/.env.test`, which is git-ignored. Create it with:

```bash
cat > apps/api/.env.test <<'EOF'
NODE_ENV=test
DATABASE_URL=postgresql://YOUR_ROLE@localhost:5432/dealflow360_test
DEAL_HEALTH_SWEEP_MINUTES=0
BCRYPT_ROUNDS=4
LOG_LEVEL=silent
EOF
```

> **Careful:** an exported `DATABASE_URL` in your shell takes precedence over
> these files. The test bootstrap drops and recreates the `public` schema of
> whatever database it resolves, so `unset DATABASE_URL` before running tests if
> you have one exported.

### 4. Migrate and seed

```bash
pnpm db:migrate
pnpm db:seed
```

The seed builds the documented demo dataset: three customer tiers, six product
categories, thirteen products, two warehouses with varied stock levels, discount
ceilings, approval bands, three subscription plans, recommendation pairings and
promotions, and three quotations — one draft carrying a deliberate ceiling breach,
one clean, and one already sent to the customer so the portal has something to act
on.

The seed refuses to run against any database not named `dealflow360` or
`dealflow360_test`, and refuses to run with `NODE_ENV=production`.

### 5. Run

```bash
pnpm dev
```

- API — http://localhost:4000 (`/api/health` to check)
- Web — http://localhost:5173

### Demo accounts

All seeded accounts share the password `Dealflow!2026`, defined in
`apps/api/src/db/seed.ts`. Local demo data only.

| Role | Email |
| --- | --- |
| Admin | `admin@dealflow.local` |
| Sales Manager | `manager@dealflow.local` |
| Finance Operations | `finance@dealflow.local` |
| Sales Rep | `rep@dealflow.local` |
| Customer (portal) | `buyer@acme.local` |

Customers can also self-register at `/register`, which creates a new organisation
on the entry tier. Joining an *existing* organisation is deliberately not possible
that way — it needs an admin or a rep-issued magic link, or anyone could
self-attach to another company and read its pricing.

---

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | API and web together |
| `pnpm dev:api` / `pnpm dev:web` | One at a time |
| `pnpm build` | Typecheck both, build the web bundle |
| `pnpm typecheck` | `tsc --noEmit` across all packages |
| `pnpm test` | Every test in the monorepo |
| `pnpm test:api` / `pnpm test:web` | One package |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Truncate and re-seed the demo dataset |
| `pnpm db:reset` | Drop, migrate, seed |
| `pnpm db:studio` | Drizzle Studio |

Generate a migration after changing the schema:

```bash
pnpm --filter @dealflow/api exec drizzle-kit generate
```

---

## Roles

A page appears in a role's sidebar only where that role has an action to take or a
real reason to read it. `view` means visible but read-only.

| Page | Sales Rep | Sales Manager | Finance Ops | Admin |
| --- | :-: | :-: | :-: | :-: |
| Dashboard | ✓ | ✓ | ✓ | ✓ |
| Quotations | ✓ | ✓ | view | ✓ |
| Approvals | view | ✓ | ✓ | ✓ |
| Fulfillment | ✓ | ✓ | ✓ | ✓ |
| Billing | ✓ | ✓ | ✓ | ✓ |
| Customers | view | ✓ | view | ✓ |
| Catalogue | view | ✓ | view | ✓ |
| Reports | ✓ | ✓ | ✓ | ✓ |
| Deal Health | ✓ | ✓ | — | ✓ |
| Governance | — | ✓ | — | ✓ |
| Settings | — | view | — | ✓ |
| Users | — | — | — | ✓ |

Two asymmetries are deliberate. A rep sees the approvals queue read-only because
they need to know which reviewer is holding their quote. Finance sees quotations
read-only because they need to know what they are approving and billing.

Notable authority splits:

- **Issuing an invoice** is open to Rep, Manager, Finance and Admin — the rep who
  closed the deal should not wait on Finance to press a button.
- **Moving money** — recording a payment, issuing a credit note — is Finance and
  Admin only.
- **Approving** a Manager rung needs a Sales Manager or Admin; a Finance rung needs
  Finance Operations or Admin. A rep can never clear their own exception.

The sidebar filtering is a usability boundary, not the security boundary. The API
enforces the same rules independently and remains the authority; the matrix lives
in `apps/web/src/nav.ts` and is unit-tested.

---

## How a deal moves

```
DRAFT ──submit──> PENDING_APPROVAL ──approve──> APPROVED ──send──> SENT
  │                    │      │                                     │
  │                 reject  return                          ┌───────┴───────┐
  │                    │      │                             │               │
  │                    ▼      ▼                          accept          counter
  │               REJECTED  REVISION_REQUIRED               │               │
  │                            │                            ▼               ▼
  └────────────────────────────┘                       CONFIRMED   UNDER_NEGOTIATION
                                                            │               │
                                    ┌───────────────────────┤        apply ─┘
                                    │                       │      (re-scores; may
                                    ▼                       ▼       re-enter approval)
                              FULFILLMENT              billing
                            (allocate, accept)   (invoice, subscription)
                                    │
                                    ▼
                                COMPLETED
```

Submitting is not a request to a human — it is a request to the engine. If the
risk score falls in the `NONE` band the quote is approved on the spot, and the
audit trail records that approval was not required rather than that it was skipped.

---

## The engines

**Pricing** (`domain/pricing`) resolves the effective list price from the tier
price list, then the strictest applicable discount ceiling. Both are written onto
the line so the quote is reproducible from stored data.

**Risk** (`domain/risk`) blends four components into a basis-point score:

| Component | Question it answers |
| --- | --- |
| Severity | How far past its ceiling is the worst line? |
| Breadth | How many lines breach at all? |
| Exposure | How much of the quote's value is in breaching lines? |
| Order | How large is the order-level discount? |

Weights are configurable in Settings. Because breadth and exposure are separate
inputs, two quotes with an identical worst breach can score differently — many
small exceptions and one large one are not the same problem.

**Approval** (`domain/approval`) raises rungs from the score, enforces role and
sequence on each, and supersedes the remaining rungs of an attempt when one is
rejected or returned. A rung bound to a stale quote version cannot be acted on.

**Recommendation** (`domain/recommendation`) ranks add-ons from configured product
pairings weighted by margin, with promotion labels applied.

**Deal health** (`domain/dealhealth`) sweeps live deals on a timer, is idempotent
across runs, and auto-resolves an alert when its cause is gone.

---

## API surface

Mounted under `/api`. All routes require a bearer token except `/api/health`,
`/api/auth/login`, `/api/auth/register` and `/api/portal/auth/login`.

| Area | Routes |
| --- | --- |
| Auth | `/auth/login` `/auth/register` `/auth/signup` `/auth/me` `/auth/users` `/auth/portal/magic-link` |
| Quotations | `/quotations` `/quotations/:id` `/:id/lines` `/:id/confirm` `/:id/send` `/:id/recalculate` `/:id/audit` `/:id/recommendations` `/:id/negotiations/:requestId/apply` |
| Approvals | `/approvals` `/approvals/:id/{approve,reject,return}` |
| Portal | `/portal/quotations` `/portal/quotations/:id` `/:id/confirm` `/:id/negotiations` |
| Fulfillment | `/orders/:id/fulfillment{,/recalculate,/accept,/override}` `/backorders/:id/consolidate` `/stock/:productId/restock` |
| Billing | `/orders/:id/billing{,/generate}` `/payments` `/credit-notes` `/subscriptions/:id/{schedule,modify,cancel}` |
| Deal health | `/deal-health` `/deal-health/sweep` `/:id/{nudge,escalate}` |
| Reports | `/reports/{pipeline,sales,products,approvals,inventory,export}` |
| Master data | `/customers` `/products` `/categories` `/tiers` `/price-lists` `/discount-rules` `/approval-rules` `/warehouses` `/inventory` `/subscription-plans` `/pairings` `/promotions` `/settings` |

Errors are uniform:

```json
{ "error": { "code": "APPROVAL_SEQUENCE", "message": "…", "details": {} } }
```

The confirmed quotation *is* the order, which is why fulfillment and billing paths
resolve `/orders/:id` to a quotation id.

---

## Testing

```bash
unset DATABASE_URL   # see the warning above
pnpm test
```

**132 tests.** The API suite re-seeds inside a transaction per file, so every file
starts from the documented dataset and asserts against the same numbers the demo
uses.

| Suite | Tests | Covers |
| --- | :-: | --- |
| `auth.test.ts` | 8 | AT-01 login, AT-02 customer isolation, RBAC boundary |
| `risk.test.ts` | 14 | AT-03/04/05 ceilings, violations, blended risk, snapshotting |
| `approval.test.ts` | 17 | AT-06/07 single and two-rung chains, sequence, roles, AT-17 audit |
| `negotiation.test.ts` | 17 | AT-12/13/14 counter-offers, approval re-entry, acceptance |
| `billing.test.ts` | 14 | Invoice authority, billing/fulfillment independence, credit caps |
| `identity.test.ts` | 20 | Self-registration limits, user admin, no hash in any response |
| `deal-health.test.ts` | 17 | Sweep idempotency, follow-up counting, auto-resolution |
| `export.test.ts` | 7 | PDF geometry — no overflow, no overlapping baselines |
| `nav.test.ts` (web) | 18 | Role → page matrix, read-only asymmetries, URL guards |

The tests assert properties rather than restating arithmetic. A few examples:

- Two quotes with the same worst breach must score *differently* when breadth or
  exposure differ, which is what makes the risk engine more than a max().
- Tightening a discount rule under a live quote must not change it until it is
  recalculated.
- Finance must not be able to clear its rung before Manager has cleared theirs.
- The portal payload must not contain `costAmountPaise`, `marginPaise` or
  `violationBp`.
- `audit_logs` must reject `UPDATE` and `DELETE` at the SQL level.
- Rendered PDF text ops must not cross the right margin, and no two baselines may
  sit closer than a line of type.

### Acceptance criteria

`DealFlow360_Project_Docs_reviewed/ACCEPTANCE_TESTS.md` defines AT-01 to AT-17.

- **Covered by labelled tests:** AT-01 – AT-07, AT-12 – AT-14, AT-17
- **Behaviour implemented and exercised, but not labelled:** AT-15 (payments, in
  `billing.test.ts`), AT-16 (deal health, in `deal-health.test.ts`)
- **Not yet covered by tests:** AT-08 (upsell), AT-09 (warehouse split), AT-10
  (backorder), AT-11 (hybrid billing) — all four work and were verified manually
  against the running API

---

## Project layout

```
apps/api/src/
  domain/                 business rules, one directory per area
  http/                   route modules — validate, delegate, never mutate
  db/schema/              Drizzle table definitions
  db/migrate.ts           runtime migration using the same validated env
  db/seed.ts              the documented demo dataset
  auth/                   JWT signing, bcrypt, magic-link redemption
  middleware/             authenticate, role guards, error envelope
  lib/errors.ts           typed error constructors → HTTP status + code

apps/api/drizzle/
  0000_initial_schema.sql
  0001_audit_append_only_triggers.sql
  0002_deal_health_nudge_count.sql

apps/web/src/
  pages/                  one file per screen
  nav.ts                  role → page matrix
  api.ts                  typed fetch client, session handling
  useApiQuery.ts          load-on-mount hook
  plan-labels.ts          subscription enums → human labels

packages/shared/src/
  money.ts                integer paise arithmetic, apportionment
  enums.ts                shared unions, single source of truth
  state-machines.ts       legal transitions
```

Design documents live in `DealFlow360_Project_Docs_reviewed/` — PRD, domain model,
business rules, RBAC, state machines, API spec, workflows, seed data and the
acceptance criteria.

---

## Known gaps

Stated plainly rather than left to be discovered:

- **No rate limiting** on `/api/auth/login` or `/api/auth/register`. Both are
  public. A deployment needs it, plus email verification on registration.
- **No linter or formatter.** `tsc --noEmit` in strict mode is the only static
  gate.
- **Logout is client-only.** JWTs are stateless and not server-tracked, so a token
  stays valid until it expires. `POST /api/auth/logout` exists to keep the
  contract stable for a future revocable session.
- **`GET /api/auth/me` is never called by the web client.** The session is
  rehydrated from `localStorage`, so a revoked account looks signed in until its
  first API call returns 401.
- **No CI.** Tests, typecheck and build all pass locally but nothing enforces that
  on push.
- **Local Postgres is assumed to be trusted.** The default setup uses `trust` auth
  on loopback, which is normal for local development and not suitable beyond it.
- **AT-08 to AT-11 and AT-15/16 lack labelled tests**, as detailed above.
