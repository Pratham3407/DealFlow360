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

Beyond the schema, the initial migration adds 25 CHECK constraints and one
partial unique index covering: percentages within 0–100, non-negative money,
positive quantities, non-negative inventory, coherent approval risk bands,
ordered billing periods, and at most one tier-wide discount rule per tier
(Postgres treats NULLs as distinct in ordinary unique indexes, so the Prisma
`@@unique` alone would not enforce it).

