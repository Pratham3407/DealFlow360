# DealFlow360 — Business Rules

## 1. Effective discount ceiling

For each quotation line, determine:

```text
effective_ceiling =
    most_specific applicable category/customer rule
    subject to configured priority
```

If no category-specific rule exists, fall back to the applicable customer-tier ceiling.

Do not hardcode Bronze/Silver/Gold values in application logic.

---

## 2. Line violation

```text
violation_points = max(0, requested_discount - effective_ceiling)
```

Example:

Requested = 18%
Allowed = 10%

Violation = 8 percentage points.

---

## 3. Blended risk

The specification requires a blended risk score that considers the total pattern of violations.

A concrete implementation formula is intentionally left as an implementation decision.

Recommended deterministic starting model:

```text
line_risk =
    violation_points
    × line_value_weight

blended_risk =
    sum(line_risk)
    + order_level_discount_risk
```

Normalize the score to a documented range if desired.

Important:

- One severe line can trigger approval.
- Several smaller violations can collectively trigger approval.
- Do not use only `max(line_violation)`.

---

## 4. Approval routing

Recommended configurable mapping:

```text
risk <= threshold_0
    → no approval

threshold_0 < risk <= threshold_1
    → Sales Manager

risk > threshold_1
    → Sales Manager → Finance
```

The thresholds belong in database configuration.

---

## 5. Approval invalidation

Any material change to:

- Quantity
- Price
- Discount
- Product
- Customer
- Subscription term

should invalidate approval if it changes the commercial risk.

Recalculate risk and create a new approval attempt when required.

---

## 6. Margin

At minimum:

```text
line_revenue = quantity × effective_unit_price

quote_revenue = sum(line_revenue)

margin =
    quote_revenue - estimated_cost
```

The exact cost model is an implementation decision because the source specification only requires live margin impact, not a particular costing methodology.

---

## 7. Warehouse allocation

Constraints:

```text
allocated_quantity <= available_quantity
```

Recommended objective:

1. Satisfy demand.
2. Minimize number of shipments.
3. Consider shipping-cost weighting.
4. Respect product stock.
5. Permit authorized manual override.

Never allocate negative or unavailable stock.

---

## 8. Backorder

If:

```text
demand > allocatable_stock
```

then:

```text
allocated = available stock
backorder = demand - allocated
```

When new stock arrives, present a consolidation action.

---

## 9. Subscription proration

For a mid-cycle change:

```text
proration_amount =
    plan_unit_rate
    × quantity_delta
    × unused_period_fraction
```

The exact day-count convention must be configurable/documented.

---

## 10. Customer negotiation

Every proposed commercial change must:

1. Be tied to a quotation version.
2. Be attributable to the customer.
3. Be persisted.
4. Trigger recalculation.
5. Trigger approval if thresholds are exceeded.

---

## 11. Audit

Never update approval history destructively.

Use append-only audit events.

---

## 12. Security

Never accept from the browser as authoritative:

- Role
- Customer ID
- Approval status
- Discount authorization
- Invoice status
- Stock availability

These must be resolved server-side.
