# DealFlow360 — Business Workflows

## Workflow 1 — Initial configuration

```text
Admin login
  ↓
Create categories/products
  ↓
Configure prices/price lists
  ↓
Configure customer tiers
  ↓
Configure discount ceilings
  ↓
Configure approval chain
  ↓
Create warehouses + stock
  ↓
Configure subscription plans
  ↓
Optional: configure upsell/cross-sell
  ↓
System ready
```

---

## Workflow 2 — Sales Rep creates quotation

```text
Sales Rep login
  ↓
Sales Workspace
  ↓
New quotation
  ↓
Select existing customer
  ↓
Select products
  ↓
Set quantities
  ↓
Apply discounts
  ↓
Risk engine evaluates
  ↓
Upsell/cross-sell panel updates
  ↓
Margin updates
  ↓
Confirm
```

---

## Workflow 3 — No approval required

```text
Quote confirmed
  ↓
Risk = within configured threshold
  ↓
Approval skipped
  ↓
Fulfillment planning
  ↓
Billing preparation
```

---

## Workflow 4 — Manager approval

```text
Quote confirmed
  ↓
Risk threshold exceeded
  ↓
Approval instance created
  ↓
Sales Manager notified / sees queue
  ↓
Review risk + quote + audit
  ├── Reject → REJECTED
  ├── Return → REVISION_REQUIRED
  └── Approve → continue
```

---

## Workflow 5 — Manager + Finance approval

```text
Risk exceeds high-risk threshold
  ↓
Sales Manager
  ├── Reject → REJECTED
  ├── Return → REVISION_REQUIRED
  └── Approve
          ↓
       Finance
          ├── Reject
          ├── Return
          └── Approve
```

---

## Workflow 6 — Upsell

```text
Quote has products
  ↓
Recommendation engine
  ↓
Rank candidate products
  ↓
Check promotion + margin threshold
  ↓
Show suggestion
  ├── Dismiss
  └── Add
        ↓
     Recalculate quote
        ↓
     Recalculate margin
```

---

## Workflow 7 — Warehouse split

```text
Approved quote
  ↓
Inventory availability lookup
  ↓
Calculate candidate allocations
  ↓
Apply shipping-cost weighting
  ↓
Recommend split
  ↓
Sales/Operations accepts
      OR
Manual override
  ↓
Reserve stock
  ↓
Create fulfillment allocations
```

If insufficient stock:

```text
Required quantity > available quantity
  ↓
Allocate available stock
  ↓
Create backorder
  ↓
Later stock arrives
  ↓
Consolidate remaining backorder
```

---

## Workflow 8 — Hybrid billing

```text
Confirmed order
  ↓
Separate lines
  ├── One-time
  │     ↓
  │   One-time invoice
  │
  └── Recurring
        ↓
      Subscription
        ↓
      Billing schedule
```

---

## Workflow 9 — Customer negotiation

```text
Sales Rep sends quotation
  ↓
Customer opens restricted portal
  ↓
Customer reviews quote
  ├── Confirm
  │    ↓
  │  Continue
  │
  └── Negotiate
       ↓
     Comment / change / counter discount
       ↓
     Recalculate price + margin + risk
       ↓
     Approval required?
       ├── No → updated quote
       └── Yes → approval flow
                    ↓
                 Customer sees result
```

---

## Workflow 10 — Customer confirmation

```text
Customer clicks Confirm
  ↓
Validate quote version
  ↓
Validate approval state
  ↓
Validate inventory
  ↓
Create/confirm order
  ↓
Fulfillment
  ↓
Billing
```

---

## Workflow 11 — Deal health

Scheduled/background evaluation:

```text
Quotation
  ↓
Check inactivity
  ↓
Check discount behavior
  ↓
Check fulfillment promise
  ↓
Create health events
  ↓
Dashboard
  ↓
Optional nudge/escalation
```

---

## Workflow 12 — Payment

```text
Invoice issued
  ↓
Payment recorded
  ↓
Validate amount
  ↓
Update payment status
  ↓
Update invoice status
```

---

## Canonical complete scenario

### Scenario

Customer: Enterprise customer

Products:

- Hardware
- Installation service
- Recurring support subscription

### Flow

1. Admin configures products, discount rules, warehouses and subscription plan.
2. Sales Rep creates quotation.
3. Rep adds hardware, service and subscription.
4. Rep applies discounts.
5. Risk engine detects service discount above category ceiling.
6. Manager approval is automatically created.
7. Rep adds recommended upsell.
8. Quote total and margin update immediately.
9. Manager approves.
10. Finance approves if high-risk.
11. Fulfillment engine checks warehouse stock.
12. Order is split across warehouses if necessary.
13. Customer receives portal link.
14. Customer requests a larger discount.
15. Risk engine recalculates.
16. Quote re-enters approval.
17. Approval succeeds.
18. Customer confirms final terms.
19. One-time items are invoiced.
20. Subscription billing schedule is created.
21. Payment is recorded.
22. Invoice status updates.
23. Deal health dashboard tracks the completed deal.
