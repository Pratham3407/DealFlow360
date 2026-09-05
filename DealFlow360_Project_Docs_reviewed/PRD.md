# DealFlow360 — Product Requirements Document

## 1. Product Definition

### Product name
DealFlow360

### Product category
B2B Sales Operations / Quotation-to-Cash Platform

### Product vision
Build a self-governing deal engine that manages a living quotation from creation through approval, customer negotiation, fulfillment and billing while automatically enforcing pricing, inventory and billing rules.

### Product positioning

DealFlow360 is **not**:

- A public e-commerce marketplace.
- A simple product catalog.
- A static quote generator.
- A CRM-only pipeline.
- A PDF-based approval workflow.

DealFlow360 **is** a controlled B2B transaction workspace in which a Sales Rep creates a customer-specific quotation and the platform automatically governs the deal.

---

# 2. Problem

B2B deals become operationally difficult when:

- Different customer tiers have different discount ceilings.
- Different product categories have different margin characteristics.
- Multiple small discount violations collectively create material margin leakage.
- A quotation requires different approval levels.
- Stock for an order is distributed across warehouses.
- One order contains both one-time and recurring products.
- Customers negotiate after the initial quotation.
- Managers discover stalled deals too late.
- Approvals, edits and negotiation history must be auditable.

The product must solve these problems through executable business rules rather than UI-only workflows.

---

# 3. Goals

## Primary goals

1. Allow a Sales Rep to create a quotation for a specific customer.
2. Automatically evaluate discount risk.
3. Automatically route quotations to the required approval chain.
4. Give Sales Reps live upsell/cross-sell suggestions.
5. Show real-time margin impact.
6. Allocate orders across warehouses based on live stock.
7. Support manual warehouse override.
8. Support backorders and later consolidation.
9. Mix one-time and recurring lines in one order.
10. Generate recurring billing schedules.
11. Support mid-cycle proration.
12. Give customers a separate restricted portal.
13. Allow customers to negotiate line-by-line.
14. Re-run approval automatically after material customer changes.
15. Record audit trails for approvals, rejections and edits.
16. Detect stalled/risky deals.
17. Provide filtered reporting and PDF/XLS export.

## Non-goals for the base version

The source specification does not require:

- Lead generation.
- Automatic Sales Rep assignment.
- Public product browsing.
- Public checkout.
- A dedicated warehouse-staff role.
- Full accounting/GL functionality.
- Payment gateway integration.
- Multi-company support.
- Multi-currency support.

Multi-company and multi-currency are bonus capabilities.

---

# 4. Users and Responsibilities

## 4.1 Admin

Admin configures the rules that govern the system.

Responsibilities:

- Product creation/editing
- Product variants
- Price lists
- Customer-tier pricing
- Currency-specific pricing rules
- Customer discount ceilings
- Category discount ceilings
- Approval chains
- Warehouses
- Stock levels
- Replenishment rules
- Shipping-cost weighting
- Subscription plans
- Proration rules
- Cancellation/refund rules
- Optional upsell/cross-sell rules
- Reporting configuration

Admin does not necessarily participate in individual deal negotiation.

---

## 4.2 Sales Rep

The Sales Rep is the main deal operator.

Responsibilities:

- Open sales workspace
- Create quotation for customer
- Add products
- Adjust quantities
- Apply line/order discounts
- Review live margin
- Review upsell/cross-sell recommendations
- Add recommended products
- Submit/confirm quotation
- Track approval status
- Respond to customer negotiation
- Track fulfillment progress

The Sales Rep does not manually bypass approval. The system decides when approval is required.

---

## 4.3 Sales Manager / Approver

Responsibilities:

- Review quotations requiring approval
- View blended risk score
- Approve
- Reject
- Return for revision
- Configure discount tiers/approval chains
- Monitor deal-health dashboard
- Identify stalled/risky deals
- Trigger nudges/escalations where configured

---

## 4.4 Finance / Operations

Responsibilities:

- Perform second-level approval for high-risk discounts
- Manage warehouse fulfillment split
- Make backorder decisions
- Reconcile recurring billing
- Reconcile credit notes
- Support billing/operational completion

---

## 4.5 Customer / Portal User

Customers interact through a separate restricted portal.

Capabilities:

- Log in using magic link or email/password
- View quotation
- View current status
- Ask line-level questions
- Request line-level changes
- Counter a discount
- Submit negotiation request
- Confirm quotation

Customers must not see internal configuration, approval notes, internal analytics, or other customers' data.

---

# 5. Commercial Model / Correct Business Flow

The base system assumes the customer is already known to the Sales Rep.

The source specification does **not** define:

`Customer submits order → system assigns Sales Rep`.

Instead:

`Sales Rep → creates quotation for customer → approval → customer portal → negotiation/confirmation → fulfillment → billing`

A future CRM/lead module may add lead creation and automatic assignment, but it is outside the required base scope.

---

# 6. Functional Requirements

## FR-1 Authentication

### Internal users
Internal users can sign up/log in with standard credentials.

### Customer users
Customers can access quotations through:

- Magic link, or
- Email + password.

### Requirements

- Role must be resolved server-side.
- Authorization must be enforced server-side.
- Portal users must never gain internal access by changing client-side state.

---

# 7. Backend Configuration

## FR-2 Product and Price List Management

Product fields:

- Name
- Category
- Price
- Unit
- Tax
- Description

Variants:

- Attribute
- Values
- Extra prices

Price lists:

- Customer-tier pricing
- Currency-specific rules

---

## FR-3 Discount Tier and Approval Chain

Admin can configure:

### Customer-tier ceilings

Example:

- Bronze: 5%
- Silver: 10%
- Gold: 15%

### Category ceilings

Example:

- Hardware: 15%
- Services: 10%

### Approval chain

Example:

```text
0–within allowed limit
    → no approval

moderate violation
    → Sales Manager

high-risk violation
    → Sales Manager
    → Finance
```

Exact thresholds must be data-driven/configurable.

### Mixed-category requirement

If a quotation contains categories with different ceilings, the system computes a blended risk score and routes to the highest required approval level.

### Audit requirement

All approvals, rejections and edits must log:

- User
- Timestamp
- Action
- Reason
- Relevant quotation/version

---

# 8. Warehouse and Fulfillment

Admin can:

- Create warehouses
- Configure stock levels
- Configure replenishment rules
- Configure shipping-cost weighting

The fulfillment engine recommends a split using live stock and configured shipping-cost weighting.

The UI must show:

- Warehouse
- Quantity fulfilled
- Estimated shipment count
- Estimated shipment cost

Actions:

- Accept suggested split
- Manual override

If stock arrives while a backorder exists, the system should present a consolidation action.

---

# 9. Subscription Plans

Admin can configure:

- Monthly plans
- Quarterly plans
- Yearly plans
- Eligible products/services
- Proration rules
- Cancellation rules
- Partial-refund rules

The same order can contain:

- One-time lines
- Recurring lines

They must be displayed and billed separately.

---

# 10. Sales Workspace

Top-level navigation:

- Quotations
- Pipeline
- Reload Data
- Go to Back-end
- Close Workspace

Quotation cards display:

- Customer
- Amount
- Stage

Pipeline is Kanban-style.

---

# 11. Quotation Builder

Sales Rep can:

- Select customer
- Add products
- Select Hardware / Services / Subscriptions
- Change quantities
- Apply line discounts
- Apply order-level discount
- See totals
- See live margin
- See upsell/cross-sell suggestions
- Confirm quotation

On confirmation:

- Route to approval if required.
- Otherwise continue directly toward fulfillment.

---

# 12. Upsell / Cross-sell

Suggestions are ranked using:

- Co-purchase history
- Active promotions
- Minimum margin threshold

Suggestion displays:

- Product
- Margin delta
- Promotion tag

Actions:

- Add to quote
- Dismiss

Adding a product must immediately update:

- Quote total
- Margin

---

# 13. Discount Risk Engine

Every quotation line must be checked against the applicable discount ceiling.

Example:

Gold customer:

- Customer ceiling = 15%
- Hardware ceiling = 15%
- Service ceiling = 10%

Quote:

- Laptop = 12% → compliant
- Setup Service = 18% → 8 percentage points over limit

The quotation is flagged because the service line violates its stricter category ceiling.

The blended risk score must also account for multiple smaller violations.

Example:

- Line A: +2 points
- Line B: +3 points
- Line C: +2 points

The combined pattern must be capable of triggering approval even if no single line appears extreme.

---

# 14. Approval Workflow

Approval is automatic.

Example:

```text
Quotation confirmed
        ↓
Risk calculated
        ↓
No approval needed? ── Yes → Continue
        │
        No
        ↓
Sales Manager
        ↓
Approve / Reject / Return
        │
        ├── Reject → Quotation rejected
        ├── Return → Sales Rep revises
        └── Approve
                ↓
        Finance required?
          ├── No → Continue
          └── Yes → Finance review
```

Approvers must see:

- Quote details
- Discount details
- Risk score
- Required approval level
- Audit history

---

# 15. Customer Portal

Customer sees:

- Quotation details
- Status:
  - Sent
  - Under Negotiation
  - Confirmed
- Line-level comments
- Change requests
- Counter-discount field
- Submit Request
- Confirm Quotation

Customer cannot access internal workspace.

---

# 16. Negotiation Re-entry

Customer requests a discount or change.

System must:

1. Persist the request.
2. Apply/preview the proposed change.
3. Recalculate totals.
4. Recalculate margin.
5. Recalculate discount risk.
6. Determine whether approval is required.
7. If required, re-enter approval flow.
8. Otherwise allow confirmation.

This is a critical workflow.

---

# 17. Deal Health

Dashboard must identify:

### Stalled deals
Quotation inactive beyond configured days.

### Discount anomalies
Discount significantly above the representative's historical average.

### Delivery promise slippage
Fulfillment/delivery risk.

Clicking an alert opens the related quotation.

Optional configured actions:

- Nudge
- Escalation

---

# 18. Billing

For each confirmed order:

### One-time lines
Generate the one-time invoice component.

### Recurring lines
Generate recurring billing schedule.

The system must support:

- Billing cadence
- Mid-cycle quantity changes
- Proration
- Cancellation
- Partial refund
- Credit note trigger

Payment recording must update invoice status.

---

# 19. Reporting

Filters:

- Period
- Sales Team / Rep
- Approval Status
- Product / Category

Reports should support:

- Quotation analysis
- Sales performance
- Approval status
- Best-selling products
- Most-discounted products
- Deal health

Export:

- PDF
- XLS

---

# 20. Auditability

Audit records are required for important mutations.

Minimum events:

- Quote created
- Quote edited
- Discount changed
- Product added/removed
- Approval requested
- Approval approved
- Approval rejected
- Revision requested
- Customer negotiation submitted
- Customer confirmed
- Warehouse allocation accepted
- Warehouse allocation overridden
- Backorder created
- Backorder consolidated
- Subscription changed
- Credit note/refund triggered
- Payment recorded

Audit records should be append-only.

---

# 21. Security / Access Control

All authorization decisions must happen on the backend.

Example isolation:

```text
ADMIN
  └── configuration + analytics

SALES REP
  └── assigned/authorized quotations

MANAGER
  └── approval + deal health

FINANCE/OPS
  └── approval + fulfillment + billing

CUSTOMER
  └── only their quotations
```

The customer portal must be a real restricted view, not merely an internal screen with a different label.

---

# 22. Non-functional Requirements

## Correctness
Business rules must be deterministic and testable.

## Auditability
Important decisions must have immutable audit records.

## Consistency
Quote totals, margins, stock reservations and billing schedules must not become inconsistent due to concurrent edits.

## Security
Never trust client-provided role, price, discount authorization or customer identity.

## Extensibility
Discount rules, approval chains, warehouses and subscription plans should be data-driven.

## Performance
Quote recalculation should feel immediate for normal quote sizes.

---

# 23. Success Criteria

The implementation is successful when the eight-step canonical flow works:

1. Login and configure basic backend data.
2. Create a quote with an excessive discount.
3. Automatic manager approval is triggered.
4. Add an upsell and see immediate total/margin update.
5. Approve and split fulfillment across warehouses if required.
6. Bill one-time + recurring lines correctly.
7. Customer requests a larger discount and the quote re-enters approval.
8. Confirm, record payment and observe invoice status update.

---

# 24. Demo Requirements

The source specification requires:

- Working backend + frontend
- Seed data
- Five-minute live demo
- At least two full end-to-end flows
- One-page architecture diagram
- Short next-steps note

---

# 25. Recommended Extensions

These are not required by the source specification:

- Lead management
- Sales Rep assignment
- CRM contact history
- Email notifications
- Payment gateway
- Webhooks
- Event bus
- Full accounting
- Multi-company
- Multi-currency
- Advanced anomaly detection
- AI-generated negotiation summaries
