# DealFlow360 — Acceptance Tests

## AT-01 Login

Given valid Sales Rep credentials:
- Login succeeds.
- Sales workspace is accessible.

Given invalid credentials:
- Login fails.

---

## AT-02 Customer isolation

Given Customer A:
- Customer A can access Customer A's quotation.

Customer A must not access Customer B's quotation even if Customer B's quotation ID is known.

---

## AT-03 Normal discount

Given a Gold customer and Hardware ceiling of 15%:
- Apply 12%.
- Quote does not require approval solely because of that line.

---

## AT-04 Category violation

Given:
- Gold customer ceiling = 15%
- Services ceiling = 10%

Apply 18% to a service.

Expected:
- 8-point violation.
- Quote flagged.
- Manager approval required.

---

## AT-05 Blended violations

Given multiple lines each slightly above their ceiling:
- Risk must include combined violations.
- The system must not evaluate only the worst line.

---

## AT-06 Approval

Given a Manager approval:
- Manager can approve.
- Manager can reject.
- Manager can return for revision.
- Every action creates an audit event.

Sales Rep must not be able to approve the quote.

---

## AT-07 Finance approval

Given high risk:
- Manager approval occurs first.
- Finance approval is then required.
- Finance can approve/reject/return.

---

## AT-08 Upsell

Given a configured product pairing:
- Recommendation appears.
- Add recommendation.
- Quote total updates.
- Margin updates.

---

## AT-09 Warehouse split

Given:
- Main Warehouse stock = 12
- East Depot stock = 20
- Required quantity = 20

Expected:
- Suggested allocation can satisfy quantity.
- Allocation never exceeds warehouse stock.
- Estimated shipment information is displayed.

---

## AT-10 Backorder

Given total available stock is less than demand:
- Available quantity is allocated.
- Remaining quantity becomes backorder.
- Backorder is visible.

---

## AT-11 Hybrid billing

Given one-time Laptop + recurring Premium Support:
- One-time invoice is generated for Laptop.
- Recurring schedule is generated for Premium Support.

---

## AT-12 Customer negotiation

Given a sent quotation:
- Customer can view it.
- Customer can submit a counter discount.
- Internal fields remain hidden.

---

## AT-13 Negotiation approval re-entry

Given a customer counter discount that exceeds configured limits:
- Quote risk recalculates.
- Approval flow restarts.
- Customer cannot finalize until required approval succeeds.

---

## AT-14 Negotiation without approval

Given a customer change that remains within configured limits:
- No unnecessary approval is created.
- Updated quote can proceed.

---

## AT-15 Payment

Given an issued invoice:
- Record payment.
- Payment status updates.
- Invoice status updates correctly.

---

## AT-16 Deal health

Given a quote inactive beyond configured days:
- STALLED event appears.

Given a discount materially above historical rep behavior:
- DISCOUNT_ANOMALY event appears.

---

## AT-17 Audit

Given quote discount change:
- Audit event contains actor, timestamp, old value, new value and quote reference.

---

# Demo acceptance

The complete eight-step demo must work:

1. Configure data.
2. Create risky quote.
3. Automatic approval.
4. Upsell and margin update.
5. Warehouse split.
6. Hybrid billing.
7. Customer negotiation and approval re-entry.
8. Confirmation, payment and invoice update.
