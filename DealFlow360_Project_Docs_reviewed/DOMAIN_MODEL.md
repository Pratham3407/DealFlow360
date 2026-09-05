# DealFlow360 — Domain Model

## Core identity

### User
- id
- email
- password_hash / auth_provider
- role
- active
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
- tax
- description
- billing_type

**Implementation note:** `billing_type` and `category` are independent dimensions and must not be collapsed into one enum. Category (Hardware / Services / Subscriptions, defined by Admin per PDF §A2) drives which discount ceiling applies. Billing type drives invoicing behavior. Collapsing them would make it impossible to represent, e.g., a recurring hardware lease, and would break the discount-ceiling lookup which keys off category alone.

Billing types:
- ONE_TIME
- RECURRING

Category is a separate, admin-configured reference (see `Category` above) and is not constrained to a fixed enum — Admin can define arbitrary categories, each with its own discount ceiling (PDF §A3).

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
