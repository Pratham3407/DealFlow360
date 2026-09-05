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

### As implemented

The transition table lives in `server/src/modules/quotations/quotationStates.ts` —
pure, so every legal and illegal edge is unit tested. Clients never set `status`;
they invoke a domain operation and the service asks this module whether it is
allowed.

| From | Allowed to |
|---|---|
| `DRAFT` | `PENDING_APPROVAL`, `APPROVED`, `SENT` |
| `PENDING_APPROVAL` | `APPROVED`, `REJECTED`, `REVISION_REQUIRED` |
| `APPROVED` | `SENT`, `REVISION_REQUIRED`, `PENDING_APPROVAL` |
| `SENT` | `UNDER_NEGOTIATION`, `CONFIRMED`, `REVISION_REQUIRED` |
| `UNDER_NEGOTIATION` | `CONFIRMED`, `REVISION_REQUIRED`, `PENDING_APPROVAL`, `DRAFT` |
| `CONFIRMED` | `FULFILLMENT` |
| `FULFILLMENT` | — terminal |
| `REJECTED` | `DRAFT` |
| `REVISION_REQUIRED` | `DRAFT` |

Notes on specific edges:

- `DRAFT → APPROVED` and `DRAFT → SENT` exist because a quotation whose risk is
  within the configured threshold skips approval entirely (`WORKFLOWS.md` §3).
  Nothing forges an approval; the risk engine decides.
- `APPROVED → PENDING_APPROVAL` and `UNDER_NEGOTIATION → PENDING_APPROVAL` exist so
  a quotation whose approval was invalidated by a material change can re-enter
  review (`BUSINESS_RULES.md` §5).
- `REJECTED` and `REVISION_REQUIRED` both return to `DRAFT`: a rejected quotation is
  reworked, not recreated.
- `PENDING_APPROVAL → CONFIRMED` is refused, as `AGENT_INSTRUCTIONS.md` §6 requires.

### Edit gate

Commercial content — lines, discounts, the customer — may be changed only in
`DRAFT` and `REVISION_REQUIRED`. Any other state returns `409
INVALID_STATE_TRANSITION`. Editing an approved quotation would leave the approver's
decision attached to different commercial terms.

Non-commercial fields (notes, validity date) remain editable throughout.

### Slice status

`POST /api/quotations/:id/submit` implements `DRAFT → PENDING_APPROVAL` with its
guards, version check and audit event. Risk scoring will choose the target state
(slice 4) and approval instances will be created alongside it (slice 5); the
transition table, version semantics and audit shape do not change when they land.


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
