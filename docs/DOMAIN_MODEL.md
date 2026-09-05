# DealFlow360 — Domain Model

## Core identity

### User
- id
- email
- password_hash / auth_provider
- name
- role
- active
- customer_id *(nullable; set only for CUSTOMER users — see §Implementation deviations)*
- last_login_at
- created_at

### Session
*(Implementation Decision — see §Implementation deviations)*
- id
- user_id
- token_hash
- expires_at
- last_seen_at
- ip
- user_agent
- created_at

### Role
Values:
- ADMIN
- SALES_REP
- SALES_MANAGER
- FINANCE_OPERATIONS
- CUSTOMER

### Customer
- id
- name
- tier
- contact information
- active

### CustomerTier
- id
- name
- default_discount_ceiling

---

## Catalog

### Category
- id
- name
- default_margin characteristics

### Product
- id
- sku
- name
- category_id
- unit
- base_price
- cost_price *(Implementation Decision — see §Implementation deviations)*
- tax
- description
- product_type
- subscription_plan_id *(nullable; required for RECURRING products)*

Product types *(as implemented)*:
- ONE_TIME
- RECURRING

Hardware / Services / Subscriptions are `Category` rows rather than enum values. See §Implementation deviations.

### ProductVariant
- id
- product_id
- attribute
- value
- extra_price

### PriceList
- id
- name
- customer_tier
- currency

### PriceListItem
- price_list_id
- product_id
- price

---

## Discount governance

### DiscountRule
- id
- customer_tier_id
- category_id nullable
- maximum_discount
- priority

### ApprovalRule
- id
- minimum_risk
- maximum_risk
- required_level

Required levels:
- NONE
- MANAGER
- MANAGER_FINANCE

### ApprovalInstance
- id
- quotation_id
- level
- status
- reviewer_id
- reason
- acted_at

---

## Quotation

### Quotation
- id
- quote_number
- customer_id
- sales_rep_id
- status
- subtotal
- discount_total
- tax_total
- grand_total
- margin
- risk_score
- version
- created_at
- updated_at

### QuotationLine
- id
- quotation_id
- product_id
- quantity
- unit_price
- discount_percent
- tax
- line_total
- margin
- line_type

### NegotiationRequest
- id
- quotation_id
- customer_id
- quotation_version
- request_type
- line_id nullable
- proposed_value
- comment
- status
- created_at

---

## Inventory

### Warehouse
- id
- name
- shipping_weight
- active

### Inventory
- warehouse_id
- product_id
- available_quantity
- reserved_quantity
- reorder_point

### Fulfillment
- id
- quotation/order id
- status

### FulfillmentAllocation
- fulfillment_id
- warehouse_id
- product_id
- quantity
- shipment_cost

### Backorder
- id
- fulfillment_id
- product_id
- quantity
- status

---

## Billing

### SubscriptionPlan
- id
- name
- interval
- proration_rule
- cancellation_rule
- refund_rule

### Subscription
- id
- customer_id
- product_id
- plan_id
- quantity
- start_date
- next_billing_date
- status

### BillingSchedule
- id
- subscription_id
- period_start
- period_end
- amount
- status

### Invoice
- id
- customer_id
- quotation/order_id
- type
- status
- amount
- due_date

Invoice types:
- ONE_TIME
- RECURRING

### InvoiceLine
- invoice_id
- product_id
- quantity
- amount

### Payment
- id
- invoice_id
- amount
- status
- paid_at

### CreditNote
- id
- invoice_id
- amount
- reason

---

## Recommendations

### ProductPairing
- product_id
- recommended_product_id
- weight

### Promotion
- product_id
- active
- priority

---

## Analytics / audit

### AuditLog
- id
- actor_user_id
- entity_type
- entity_id
- action
- old_value
- new_value
- reason
- created_at

### DealHealthEvent
- id
- quotation_id
- type
- severity
- metadata
- created_at
- resolved_at

Types:
- STALLED
- DISCOUNT_ANOMALY
- DELIVERY_SLIPPAGE

---

# Key invariants

1. A quotation belongs to exactly one customer and Sales Rep.
2. Customer portal access is restricted to that customer's quotations.
3. Every discount must be validated against applicable rules.
4. Approval cannot be bypassed through the frontend.
5. An approved quote becomes invalid for approval purposes when material commercial terms change.
6. Customer negotiation changes must trigger risk recalculation.
7. Inventory allocation cannot exceed available/reservable stock.
8. Billing schedules must be derived from subscription terms.
9. Audit records cannot be silently overwritten.
10. Quote totals must be derivable from persisted lines and pricing rules.

---

# Implementation deviations

Recorded per §31 of `AGENTS.md`. Each item states the reason, so a later reader
does not have to re-derive it.

## 1. `Session` entity added

Not in the original model. The chosen auth mechanism is a server-side session
store with an opaque token in an httpOnly cookie, so the token's SHA-256 digest
needs somewhere to live. It also makes role and customer identity re-readable
from `users` on every request, which is what makes invariant 12 of `AGENTS.md`
§6 ("client-provided role … never trusted") true in practice rather than
aspirational.

## 2. `Product.cost_price` added

`BUSINESS_RULES.md` §6 defines `margin = quote_revenue − estimated_cost`, but the
documented `Product` carries no cost field, leaving margin uncomputable. That
same section explicitly leaves the cost model to implementation. A per-product
cost is the simplest deterministic choice. `QuotationLine.unit_cost` snapshots it
at add time so historical quotations stay reproducible when the catalog changes.

## 3. `product_type` narrowed; product kind moved to `Category`

The documented enum mixed billing cadence (`ONE_TIME`, `RECURRING`) with product
kind (`SERVICE`, `HARDWARE`, `SUBSCRIPTION`), which leaves questions like "is
this service billed once or monthly?" unanswerable. `SEED_DATA.md` already treats
Hardware / Services / Subscriptions as categories and has a separate
One-time / Recurring column, so:

- `Category` (data, admin-editable) carries product kind and drives discount ceilings.
- `product_type` carries billing cadence and drives the hybrid billing split in `WORKFLOWS.md` §8.

## 4. `User.customer_id` with a database CHECK constraint

Portal isolation (`RBAC.md`) needs a customer user bound to exactly one customer.
The link is enforced by a constraint, not convention:

```sql
CHECK ((role = 'CUSTOMER') = (customer_id IS NOT NULL))
```

An internal user therefore cannot be given a customer, and a customer user cannot
exist without one, regardless of application-layer bugs.

## 5. Approval validity expressed as two integers

`Quotation.version` increments on material commercial change and doubles as the
optimistic-concurrency token. `ApprovalInstance.quotation_version` records the
version reviewed, and `Quotation.approved_version` records the version that
completed the chain. Approval is live only while
`approved_version == version`, which satisfies `AGENTS.md` §11 without a
separate entity.

## 6. Additional derived columns on `Quotation` and `QuotationLine`

The documented fields are kept; per-line `line_subtotal`, `line_discount`,
`line_tax`, and quotation-level `estimated_cost`, `risk_band`,
`required_approval_level`, `order_discount_percent`, `last_activity_at` are added.
All are derived from authoritative data and recomputed server-side; they are
persisted so approvals, reports and deal-health signals read consistent figures
rather than recomputing history.

## 7. Deal-health event types extended

`STALLED`, `DISCOUNT_ANOMALY` and `DELIVERY_SLIPPAGE` are joined by
`APPROVAL_DELAY` and `FULFILLMENT_PROBLEM`, both of which `README.md` lists as
required deal-health signals.

## 8. Database-level invariants

Beyond the schema, the migrations add 27 CHECK constraints and one partial unique index.
Application code validates first so callers receive business errors; these are the backstop
against a bug, a raw query or a future refactor.

`20260905090720_init` — 23 constraints:

- percentages within 0–100 (`customer_tiers`, `discount_rules`, `products`, `quotations`, `quotation_lines`)
- non-negative money (`products`, `price_list_items`, `quotation_lines`, `invoices`) and positive money (`payments`, `credit_notes`)
- positive quantities (`quotation_lines`, `invoice_lines`, `subscriptions`, `fulfillment_allocations`, `backorders`)
- non-negative inventory (`inventory_quantities_nonneg_check`)
- coherent approval bands (`approval_rules_risk_band_check`)
- ordered billing periods (`billing_schedules_period_order_check`)
- version sanity (`quotations_version_positive_check`, `approval_instances_version_positive_check`)
- portal scope (`users_customer_scope_check`)
- plus `discount_rules_tier_wide_key`, a partial unique index enforcing at most one tier-wide
  discount rule per tier — Postgres treats NULLs as distinct in an ordinary unique index, so
  the Prisma `@@unique` alone would not enforce it

`20260905103502_master_data_constraints` — 4 more, each closing a gap between what a schema
comment claimed and what the database actually enforced:

- `products_recurring_requires_plan_check` — a `RECURRING` product must reference a subscription plan, since the billing cadence lives on the plan
- `product_variants_extra_price_nonneg_check` — a negative uplift would be a discount smuggled past the discount rules
- `warehouses_shipping_weight_positive_check` — a non-positive weight would make a warehouse free or profitable to ship from
- `promotions_window_order_check` — a promotion window must move forwards; either bound may be open

`20260905135805_quote_number_sequence` — adds `quotation_number_seq`, no constraints.
`Quotation.quote_number` was `@unique` with no generation strategy. A sequence is the
only race-free option that does not require locking: two concurrent creates receive
distinct values without either blocking, which `count(*) + 1` could not guarantee.
Numbers are formatted `Q-<year>-<6 digits>`; the sequence never resets, so uniqueness
does not depend on the year and a failed create leaves a harmless gap rather than
reusing a number.

Verify the count with:

```sql
SELECT count(*) FROM pg_constraint
WHERE contype = 'c' AND connamespace = 'public'::regnamespace;
```

## 9. Master-data conventions

Nothing in master data is deleted; every configurable entity carries `active`, and foreign
keys are `ON DELETE RESTRICT`, so a product referenced by a historical quotation stays
resolvable. The single exception is `PriceListItem`: it holds no history, and removing an
entry simply falls pricing back to `Product.base_price`.

Money, percentages, weights and risk scores are returned as fixed-scale strings (2 / 3 / 4 /
4 decimal places). `Prisma.Decimal.toString()` drops trailing zeros, which made the same
stored value render as `"80000"` from one endpoint and `"80000.00"` from another; every
response now passes through a formatter in `server/src/http/fields.ts`.

## 10. Quotation line positions

`QuotationLine.position` is a **sparse** ordering key, not a dense index. Lines append at
`max(position) + 1` and are never renumbered after a delete, so gaps are normal. Renumbering
would transiently collide with the `@@unique([quotationId, position])` index inside the
transaction, for no benefit — the ordering only needs to be strictly increasing.

Adding a product that already appears on the quotation with the **same variant and the same
discount** merges into that line by increasing its quantity: two lines on identical terms
are one commercial fact, and a duplicate would double-count in fulfillment and billing. A
different variant or discount is a different commercial fact and stays a separate line.
There is deliberately no unique constraint on `(quotation_id, product_id, variant_id)`,
because the same product on different terms is legitimate.



