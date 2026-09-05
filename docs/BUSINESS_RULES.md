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

### As implemented

`resolveEffectiveCeiling()` in `server/src/modules/pricing/discountRules.ts` — a pure
function over plain data, so the configuration preview and the risk engine cannot disagree.
Precedence, most specific first:

```text
1. active rule for (tier, category)   -> source CATEGORY_RULE
2. active rule for (tier, NULL)       -> source TIER_RULE
3. CustomerTier.default_discount_ceiling -> source TIER_DEFAULT
```

Specificity wins outright: a tier-wide rule with priority 999 still loses to a category rule
with priority 0. `priority` is only a tiebreaker **between rules of equal specificity**, and
if priority also ties the stricter (lower) ceiling wins, then the lowest id — so the result
never depends on row order. Deactivated rules are ignored at every level.

At most one tier-wide rule may exist per tier. Postgres treats NULLs as distinct in an
ordinary unique index, so this is enforced by a partial unique index
(`discount_rules_tier_wide_key … WHERE category_id IS NULL`) with a service-level check in
front of it that produces a readable `409` instead of a constraint violation.

Inspect any resolution with `GET /api/discount-rules/effective?customerTierId=&categoryId=`.

---

## 2. Line violation

```text
violation_points = max(0, requested_discount - effective_ceiling)
```

Example:

Requested = 18%
Allowed = 10%

Violation = 8 percentage points.

### As implemented

`violationPoints()` beside the resolver, in `Prisma.Decimal` throughout. The boundary is
compliant: a discount exactly at the ceiling yields `0.000`, not a violation.


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

### As implemented

Cost is per product: `Product.cost_price`, an addition recorded in
`DOMAIN_MODEL.md` "Implementation deviations". A product response exposes
server-computed `unitMargin` (`base_price − cost_price`) and `marginPercent`,
both in `Prisma.Decimal` — a client-supplied margin is never accepted.
`QuotationLine.unit_cost` snapshots the cost at add time so a historical
quotation stays reproducible when the catalogue changes.

Cost above price is deliberately permitted: the risk and margin engines must be
able to represent a loss-making line, not be prevented from recording one.

---

## 6a. Quotation calculation order

**One definition, in `server/src/modules/quotations/quotationMath.ts`.** Pure —
plain data in, plain data out — so the risk engine, billing and any preview read
the same implementation rather than three that drift.

```text
per line
  lineSubtotal   = unitPrice × quantity                       (gross)
  ownDiscount    = lineSubtotal × discountPercent / 100
  netAfterOwn    = lineSubtotal − ownDiscount

order-level discount, allocated across lines by net share
  orderShare_i   = netAfterOwn_i × orderDiscountPercent / 100
  netFinal_i     = netAfterOwn_i − orderShare_i

per line, continued
  lineDiscount   = ownDiscount + orderShare        (stored combined)
  lineTax        = netFinal × taxPercent / 100
  lineTotal      = netFinal + lineTax
  margin         = netFinal − (unitCost × quantity)

quotation
  subtotal       = Σ lineSubtotal
  discountTotal  = Σ lineDiscount
  taxTotal       = Σ lineTax
  grandTotal     = Σ lineTotal
  estimatedCost  = Σ (unitCost × quantity)
  margin         = (grandTotal − taxTotal) − estimatedCost
```

Four decisions embedded in that order:

1. **Tax applies to the post-discount amount.** An order-level trade discount
   reduces the taxable value; taxing the gross would overstate tax due.
2. **Margin excludes tax.** Tax is collected on behalf of the authority, not
   earned, so it cannot contribute to margin.
3. **`lineDiscount` stores the line's own discount plus its allocated share of
   the order discount.** That keeps `lineTotal = lineSubtotal − lineDiscount +
   lineTax` and `discountTotal = Σ lineDiscount` true, with the line-level figure
   still recoverable from `discountPercent`.
4. **Round per line to 2 dp, then sum**, so `Σ lineTotal` equals `grandTotal`
   exactly. The order-discount allocation gives its rounding residual to the last
   line, so the allocated shares sum to the order discount to the paisa.

Totals are written only by the recalculation routine, from the persisted lines, so
they are always derivable from them (`DOMAIN_MODEL.md` invariant 10) and a
client-supplied total can never reach the database.

Verified against the canonical quotation in `docs/SEED_DATA.md`: subtotal
₹1,750,000.00, discount ₹201,000.00, tax ₹278,820.00, grand total
₹1,827,820.00, cost ₹1,250,000.00, margin ₹299,000.00.

---

## 6b. Unit price resolution

`resolveUnitPrice()` in `server/src/modules/pricing/priceResolution.ts`. Order:

```text
1. an active price list bound to the customer's tier, holding this product
2. the product's base_price
+  the selected variant's extra_price, when a variant is chosen
```

A price list that exists but holds no entry for the product falls through to base
price: a list is a set of overrides, not a catalogue. A price-list entry of zero is
a real override, not a miss. Where a tier has more than one active list the lowest
`code` wins, so resolution is deterministic rather than dependent on row order.

The resolved price, cost and tax rate are snapshotted onto the quotation line.
Changing a line's variant re-resolves the price rather than adjusting it by hand.

---

## 6c. Quotation versioning and concurrency

`Quotation.version` is both the commercial version and the optimistic concurrency
token (`AGENTS.md` §37).

A **material commercial change** increments it: the customer, the order-level
discount, or any line added, updated or removed. Notes, the validity date and
`recalculate` do not, because bumping the version would needlessly invalidate an
approval (§5).

Every mutation states the version it believes it is changing. The check is a
conditional update inside the transaction —
`UPDATE … WHERE id = ? AND version = ?` — so a concurrent mutation that already
moved the version leaves this one matching zero rows and it fails with
`VERSION_CONFLICT`. A read-then-write would leave a race between the two
statements.

Commercial content is editable only while the quotation is `DRAFT` or
`REVISION_REQUIRED`. Editing an approved quotation would leave the approver's
decision attached to different terms, so it is refused rather than silently
allowed.


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
