# DealFlow360 — AI Coding Agent Instructions

You are implementing DealFlow360, a B2B Sales Operations platform.

## 1. Source of truth

The primary functional source is the DealFlow360 problem statement.

Do not invent a different business model.

The base flow is:

```text
Sales Rep creates customer quotation
→ automated discount/risk evaluation
→ approval if required
→ customer portal
→ negotiation or confirmation
→ fulfillment
→ billing
→ reporting
```

Do not turn the product into a public marketplace.

---

# 2. Non-negotiable architecture principles

## Business rules must be real

Do not hardcode demo outcomes such as:

```text
if quoteId == "Q1001":
    requireFinanceApproval = true
```

Instead:

```text
load rules
→ calculate
→ persist result
→ route based on result
```

## Backend is authoritative

Never trust:

- Client role
- Client customer ID
- Discount permissions
- Approval status
- Stock quantity
- Invoice status
- Margin

---

# 3. AI agent implementation order

Implement in this order:

1. Authentication
2. RBAC
3. Customer + product master data
4. Pricing
5. Discount rules
6. Risk engine
7. Approval engine
8. Quotation builder
9. Recommendation engine
10. Warehouse allocation
11. Fulfillment/backorder
12. Hybrid billing
13. Customer portal
14. Negotiation re-entry
15. Deal health
16. Reporting
17. Audit trail
18. Tests

Do not build polished UI before the core domain logic works.

---

# 4. Agent behavior

Before changing code:

1. Identify the affected domain.
2. Read the corresponding state machine.
3. Identify invariants.
4. Identify authorization requirements.
5. Check whether the change invalidates existing approval.
6. Update tests.
7. Only then change implementation.

When requirements conflict, prefer the explicit product requirement over convenience.

---

# 5. Critical scenarios

Every implementation must support:

### Scenario A
Normal discount → no approval.

### Scenario B
Excessive category discount → Manager approval.

### Scenario C
High blended risk → Manager + Finance.

### Scenario D
Customer negotiates → risk recalculation.

### Scenario E
Negotiation crosses threshold → approval re-entry.

### Scenario F
Insufficient single-warehouse stock → multi-warehouse split.

### Scenario G
Insufficient total stock → backorder.

### Scenario H
New stock arrives → consolidation.

### Scenario I
One-time + recurring lines → separate billing treatment.

### Scenario J
Mid-cycle subscription change → proration.

---

# 6. State safety

Never allow illegal transitions.

Example:

```text
PENDING_APPROVAL → APPROVED
```

is legal only through an authorized approval action.

```text
PENDING_APPROVAL → CUSTOMER_CONFIRMED
```

must be rejected.

---

# 7. Quote versioning

Customer negotiation and approval must be version-aware.

Recommended pattern:

```text
Quotation v1
  ↓
customer changes discount
  ↓
Quotation v2
  ↓
risk recalculated
  ↓
approval regenerated if necessary
```

Never silently mutate a commercially approved quote without invalidating the affected approval.

---

# 8. Audit

Every meaningful commercial decision should produce an audit event.

Audit records should answer:

- Who changed it?
- What changed?
- When?
- Why?
- Which quote version?
- What was the previous value?
- What is the new value?

---

# 9. Testing expectations

For every rules engine, test:

- Normal case
- Boundary case
- Violation case
- Multiple-line case
- Role violation
- Concurrent/stale version
- Customer portal isolation

---

# 10. Do not overbuild

The source specification explicitly allows any technology stack.

Do not introduce microservices, Kafka, Kubernetes or other infrastructure merely to make the architecture look sophisticated.

A modular monolith is sufficient for the base implementation if domain boundaries are clean.

---

# 11. UI expectations

Internal workspace:

- Quotations
- Pipeline
- Quotation Builder
- Approval
- Upsell/Cross-sell
- Fulfillment
- Billing
- Deal Health
- Reporting

Customer workspace:

- Quotation
- Negotiation
- Confirmation

The customer workspace must be genuinely restricted.

---

# 12. Definition of done

A feature is not complete if it only renders UI.

It is complete when:

- Backend rule exists.
- API validates it.
- Database state represents it.
- Unauthorized paths fail.
- Audit event exists where applicable.
- Frontend reflects actual backend state.
- Automated test covers the behavior.
