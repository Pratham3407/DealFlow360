# DealFlow360 — State Machines

## Quotation

```text
DRAFT
  ↓
PENDING_APPROVAL
  ├── REJECTED
  ├── REVISION_REQUIRED → DRAFT
  └── APPROVED
          ↓
       SENT
          ↓
    UNDER_NEGOTIATION
       ├── DRAFT/REVISION_REQUIRED
       └── CONFIRMED
              ↓
          FULFILLMENT
```

Implementation may collapse some states, but state transitions must remain explicit.

## Approval

```text
NOT_REQUIRED
      OR
PENDING
  ├── APPROVED
  ├── REJECTED
  └── REVISION_REQUIRED
```

For multi-level approval:

```text
MANAGER_PENDING
  ↓
MANAGER_APPROVED
  ↓
FINANCE_PENDING
  ↓
FINANCE_APPROVED
```

Any rejection terminates the current approval attempt.

---

## Fulfillment

```text
NOT_STARTED
  ↓
ALLOCATING
  ↓
ALLOCATED
  ↓
PARTIALLY_FULFILLED
  ↓
FULFILLED
```

Backorder branch:

```text
ALLOCATING
  ↓
PARTIAL
  ↓
BACKORDERED
  ↓
STOCK_AVAILABLE
  ↓
CONSOLIDATION
  ↓
FULFILLED
```

---

## Subscription

```text
PENDING
  ↓
ACTIVE
  ├── MODIFIED
  ├── CANCELLED
  └── EXPIRED
```

A modification can generate proration and a refund/credit-note event.

---

## Invoice

```text
DRAFT
  ↓
ISSUED
  ├── PAID
  ├── PARTIALLY_PAID
  └── OVERDUE
```

Refund/credit note is a separate financial event.

---

## Negotiation

```text
SENT
  ↓
UNDER_NEGOTIATION
  ├── CUSTOMER_CONFIRMED
  └── CHANGE_REQUESTED
         ↓
      RISK_CHECK
         ├── NO_APPROVAL → UPDATED_QUOTE
         └── APPROVAL → APPROVAL_FLOW
```

---

## Rule

Never allow a client-side state mutation such as:

`PENDING_APPROVAL → APPROVED`

without a server-side approval action by an authorized reviewer.
