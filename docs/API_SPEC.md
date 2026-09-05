# DealFlow360 — REST API Contract

This is an implementation-neutral API proposal. Exact technology is not prescribed by the source specification.

## Conventions (as implemented)

### Response envelopes

A single resource answers `{ "data": … }`. A collection answers `{ "data": [...], "meta": { … } }`:

```json
{ "data": [ … ], "meta": { "total": 137, "limit": 50, "offset": 0 } }
```

Every collection endpoint accepts `limit` (1–200, default 50), `offset`, `q` (free-text
search over that entity's natural columns) and `active` (`true` / `false`; omitted returns
both, because master data is deactivated rather than deleted). Unknown query parameters
and unknown body fields are rejected with `400`, never silently ignored.

### Errors

```json
{ "error": { "code": "BUSINESS_RULE_VIOLATION", "message": "…", "details": [ … ] } }
```

| Code | Status | Meaning |
|---|---:|---|
| `VALIDATION_FAILED` | 400 | Body, query or params failed schema validation |
| `UNAUTHENTICATED` | 401 | No valid session |
| `FORBIDDEN` | 403 | Authenticated but lacking the required capability |
| `NOT_FOUND` | 404 | No such resource, or not visible to this caller |
| `CONFLICT` | 409 | Duplicate natural key, or a state that forbids the change |
| `VERSION_CONFLICT` | 409 | Stale version supplied (optimistic concurrency) |
| `INVALID_STATE_TRANSITION` | 409 | Illegal domain transition |
| `BUSINESS_RULE_VIOLATION` | 422 | A configured rule rejected the request |
| `INTERNAL` | 500 | Unexpected; detail withheld |

### Decimals

Money, percentages, weights and risk scores are returned as **strings at a fixed scale** —
money 2 dp, percentages 3 dp, weights and risk 4 dp — so the same stored value never
renders two ways across endpoints and no client needs to normalise before comparing.

### Deletion

Master data is deactivated (`active: false`), never deleted, so historical quotations stay
reproducible. The one exception is a price-list item, which holds no history: removing it
falls pricing back to the product's base price.

## Auth

```http
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

`POST /api/auth/signup` is **not implemented**. Accounts are provisioned by an
administrator through `POST /api/users` — deviation recorded in `PRD.md` FR-1.

## Users *(implemented — `users:manage`)*

```http
GET    /api/users                     ?role=
POST   /api/users
POST   /api/users/:id/deactivate
```

## Customers *(implemented)*

```http
GET    /api/customer-tiers            customers:read
POST   /api/customer-tiers            customers:configure
PATCH  /api/customer-tiers/:id        customers:configure (name, active)
                                      discount-rules:configure (defaultDiscountCeiling)

GET    /api/customers                 customers:read     ?tierId=
GET    /api/customers/:id             customers:read
POST   /api/customers                 customers:configure
PATCH  /api/customers/:id             customers:configure
```

A customer tier carries both an identity and a discount ceiling, which `RBAC.md` assigns to
different roles. The router admits either capability and the handler then checks per field:
only an admin may rename or deactivate a tier; only a manager or admin may move its ceiling.

## Catalog *(implemented)*

```http
GET    /api/categories                catalog:read
POST   /api/categories                products:configure
PATCH  /api/categories/:id            products:configure

GET    /api/products                  catalog:read   ?categoryId= &productType=
GET    /api/products/:id              catalog:read
POST   /api/products                  products:configure
PATCH  /api/products/:id              products:configure

GET    /api/products/:id/variants                    catalog:read
POST   /api/products/:id/variants                    products:configure
PATCH  /api/products/:id/variants/:variantId         products:configure
```

A product response includes server-computed `unitMargin` and `marginPercent` derived from
`basePrice − costPrice`; a client-supplied margin is never accepted. A `RECURRING` product
must reference a subscription plan and a `ONE_TIME` product must not — enforced in the
service and by a database CHECK constraint.

## Pricing *(implemented)*

```http
GET    /api/price-lists               pricing:read
GET    /api/price-lists/:id           pricing:read    (includes items)
POST   /api/price-lists               price-lists:configure
PATCH  /api/price-lists/:id           price-lists:configure
PUT    /api/price-lists/:id/items/:productId    price-lists:configure
DELETE /api/price-lists/:id/items/:productId    price-lists:configure

GET    /api/discount-rules            pricing:read    ?customerTierId= &categoryId=
GET    /api/discount-rules/effective  pricing:read    ?customerTierId= &categoryId=
POST   /api/discount-rules            discount-rules:configure
PATCH  /api/discount-rules/:id        discount-rules:configure
```

`GET /api/discount-rules/effective` answers "which rule governs this tier and category, and
why", using the same resolver the risk engine uses:

```json
{ "data": { "maximumDiscount": "10.000", "source": "CATEGORY_RULE", "ruleId": "…",
            "customerTierName": "Gold", "categoryName": "Services" } }
```

`source` is `CATEGORY_RULE`, `TIER_RULE` or `TIER_DEFAULT`. See `BUSINESS_RULES.md` §1.

## Approval configuration *(implemented)*

```http
GET    /api/approval-rules            pricing:read
POST   /api/approval-rules            approval-rules:configure
PATCH  /api/approval-rules/:id        approval-rules:configure
```

The list response carries a coverage block beside the rows:

```json
{ "data": [ … ], "meta": { … }, "coverage": { "valid": true, "problems": [] } }
```

Bands are half-open `[minimumRisk, maximumRisk)` with a null maximum meaning unbounded, and
the active set must tile `[0, ∞)` with no gap or overlap. Any write that would break that —
most often deactivating a middle band — is rejected `422`, because a gap is a silent
approval bypass.

## Warehouses and inventory *(implemented)*

```http
GET    /api/warehouses                                        inventory:read
POST   /api/warehouses                                        warehouses:configure
PATCH  /api/warehouses/:id                                    warehouses:configure
GET    /api/warehouses/:id/inventory                          inventory:read
PATCH  /api/warehouses/:id/inventory/:productId               warehouses:configure
POST   /api/warehouses/:id/inventory/:productId/receive       warehouses:configure
```

Stock semantics: `availableQuantity` is free to allocate, `reservedQuantity` is already
committed to a fulfillment, and `physicalQuantity` is their sum. `reservedQuantity` is
**absent from every request schema** — it moves only inside an allocation transaction, since
editing it directly would let one unit be promised twice. `PATCH` sets stock absolutely (for
corrections); `receive` applies an atomic increment, so concurrent replenishments cannot
overwrite each other.

## Subscriptions *(implemented)*

```http
GET    /api/subscription-plans        catalog:read
POST   /api/subscription-plans        subscription-plans:configure
PATCH  /api/subscription-plans/:id    subscription-plans:configure
```

A plan cannot be deactivated while products reference it, and its billing interval cannot
change once subscriptions exist. A `PARTIAL_PRORATED` refund rule requires proration to be
enabled, since a prorated refund is computed from the unused period fraction.

## Recommendation configuration *(implemented)*

```http
GET    /api/product-pairings          catalog:read   ?productId=
POST   /api/product-pairings          products:configure
PATCH  /api/product-pairings/:id      products:configure

GET    /api/promotions                catalog:read   ?productId= &live=
POST   /api/promotions                products:configure
PATCH  /api/promotions/:id            products:configure
```

Pairings are directional and a product cannot recommend itself. A promotion reports a
derived `live` flag (active and inside its window now); `?live=true` filters to those.
Ranking, margin-floor filtering and promotion boosting belong to the recommendation engine,
not to this configuration surface.

## Quotations *(implemented)*

```http
GET    /api/quotations                    quotations:read-internal  ?status= &customerId= &salesRepId=
GET    /api/quotations/:id                quotations:read-internal  (includes lines)
POST   /api/quotations                    quotations:create
PATCH  /api/quotations/:id                quotations:edit
POST   /api/quotations/:id/recalculate    quotations:edit
POST   /api/quotations/:id/submit         quotations:edit
```

### Optimistic concurrency

Every mutation body must carry `version`. The check is a conditional update inside
the transaction, so a client holding a stale version gets `409 VERSION_CONFLICT`
rather than silently overwriting newer commercial state:

```json
{ "version": 3, "orderDiscountPercent": 2.5 }
```

`version` increments only on a **material commercial change** — the customer, the
order discount, or any line add / update / remove. Notes, the validity date and
`recalculate` leave it alone, because bumping it would needlessly invalidate an
approval.

### Server-authored fields

`status`, `version`, `quoteNumber`, `unitPrice`, `unitCost`, `subtotal`,
`discountTotal`, `taxTotal`, `grandTotal`, `estimatedCost`, `margin`, every
`line*` figure, `riskScore` and `approvedVersion` are absent from every request
schema. Schemas are strict, so a request carrying one is rejected `400` rather
than ignored.

`quoteNumber` is assigned from a Postgres sequence as `Q-<year>-<6 digits>`.

### Visibility

A `SALES_REP` sees only quotations it owns (`docs/PRD.md` §21); every other
internal role sees all. A rep reading another rep's quotation gets `404`, not
`403`, so ids cannot be enumerated. A `?salesRepId=` filter cannot widen a rep's
own scope.

### Ownership

A rep always owns what it creates — a `salesRepId` naming anyone else is rejected
`422`. Other internal roles must name an active `SALES_REP` to own the quotation.

### Margin

`estimatedCost`, `margin`, `unitCost` and line `margin` are present only for
callers holding `margin:view`. They are **omitted**, not zeroed, so an absent key
cannot be misread as a zero margin.

## Quotation lines *(implemented)*

```http
POST   /api/quotations/:id/lines                 quotations:edit
PATCH  /api/quotations/:id/lines/:lineId         quotations:edit
DELETE /api/quotations/:id/lines/:lineId         quotations:edit   (version in body)
```

Every line operation returns the **whole quotation**, because a line change alters
the totals and the version; returning only the line would leave the client unable
to make its next call.

`unitPrice`, `unitCost` and `taxPercent` are resolved server-side and snapshotted
onto the line, so a historical quotation stays reproducible when the catalogue
changes. Price resolution order is the tier-bound price list, then the product's
base price, plus any variant uplift.

Adding a product that already appears with the **same variant and same discount**
merges into that line by increasing its quantity — two lines on identical terms
are one commercial fact, and a duplicate would double-count in fulfillment and
billing. A different variant or discount stays a separate line.

Commercial edits are accepted only while the quotation is `DRAFT` or
`REVISION_REQUIRED`; otherwise `409 INVALID_STATE_TRANSITION`.

`position` is a sparse ordering key. Lines append at `max(position) + 1` and are
never renumbered after a delete, so gaps are normal and expected.


## Recommendations *(not implemented)*

```http
GET /api/quotations/:id/recommendations
POST /api/quotations/:id/recommendations/:productId/add
```

## Approval *(not implemented)*

```http
GET  /api/approvals
GET  /api/approvals/:id
POST /api/approvals/:id/approve
POST /api/approvals/:id/reject
POST /api/approvals/:id/return
```

## Fulfillment *(not implemented)*

```http
GET  /api/orders/:id/fulfillment
POST /api/orders/:id/fulfillment/recalculate
POST /api/orders/:id/fulfillment/accept
POST /api/orders/:id/fulfillment/override
POST /api/backorders/:id/consolidate
```

## Billing *(not implemented)*

```http
GET  /api/orders/:id/billing
GET  /api/subscriptions/:id/schedule
POST /api/subscriptions/:id/modify
POST /api/subscriptions/:id/cancel
POST /api/payments
```

## Customer portal *(login implemented; the rest not)*

```http
POST /api/portal/auth/login           implemented
GET  /api/portal/quotations
GET  /api/portal/quotations/:id
POST /api/portal/quotations/:id/negotiations
POST /api/portal/quotations/:id/confirm
```

The portal is a separate namespace guarded at the router: a customer session is refused
everywhere outside `/api/portal`, and an internal session is refused inside it.

## Deal health *(not implemented)*

```http
GET  /api/deal-health
GET  /api/deal-health/:id
POST /api/deal-health/:id/nudge
POST /api/deal-health/:id/escalate
```

## Reporting *(not implemented)*

```http
GET /api/reports/quotations
GET /api/reports/sales
GET /api/reports/approvals
GET /api/reports/products
GET /api/reports/export?format=pdf
GET /api/reports/export?format=xls
```

## Health *(implemented)*

```http
GET /api/health
```

Returns `200` with `{ "data": { "status": "ok", "database": "up", "time": … } }`, or `503`
with `status: "degraded"` when the database is unreachable.

## API rules

1. Every mutation is authorized server-side.
2. Every quotation mutation should validate its current version.
3. Material quote changes trigger recalculation.
4. Approval actions require the correct role and current approval state.
5. Portal endpoints never expose internal fields.
6. Errors must be structured and actionable.
7. Routes ask for a **capability**, never a role, so the permission matrix stays in one place.
8. Every configuration write is audited in the same transaction as the change.

