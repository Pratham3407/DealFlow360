# DealFlow360 — REST API Contract

This is an implementation-neutral API proposal. Exact technology is not prescribed by the source specification.

## Auth

```http
POST /api/auth/login
POST /api/auth/signup
POST /api/auth/logout
GET  /api/auth/me
```

## Customers

```http
GET    /api/customers
POST   /api/customers
GET    /api/customers/:id
PATCH  /api/customers/:id
```

## Products

```http
GET    /api/products
POST   /api/products
GET    /api/products/:id
PATCH  /api/products/:id
```

## Pricing

```http
GET    /api/price-lists
POST   /api/price-lists
GET    /api/discount-rules
POST   /api/discount-rules
PATCH  /api/discount-rules/:id
```

## Approval configuration

```http
GET    /api/approval-rules
POST   /api/approval-rules
PATCH  /api/approval-rules/:id
```

## Warehouses

```http
GET    /api/warehouses
POST   /api/warehouses
GET    /api/warehouses/:id/inventory
PATCH  /api/warehouses/:id/inventory/:productId
```

## Subscriptions

```http
GET    /api/subscription-plans
POST   /api/subscription-plans
PATCH  /api/subscription-plans/:id
```

## Quotations

```http
GET    /api/quotations
POST   /api/quotations
GET    /api/quotations/:id
PATCH  /api/quotations/:id
POST   /api/quotations/:id/recalculate
POST   /api/quotations/:id/confirm
POST   /api/quotations/:id/send
```

## Quotation lines

```http
POST   /api/quotations/:id/lines
PATCH  /api/quotations/:id/lines/:lineId
DELETE /api/quotations/:id/lines/:lineId
```

## Recommendations

```http
GET /api/quotations/:id/recommendations
POST /api/quotations/:id/recommendations/:productId/add
```

## Approval

```http
GET  /api/approvals
GET  /api/approvals/:id
POST /api/approvals/:id/approve
POST /api/approvals/:id/reject
POST /api/approvals/:id/return
```

## Fulfillment

```http
GET  /api/orders/:id/fulfillment
POST /api/orders/:id/fulfillment/recalculate
POST /api/orders/:id/fulfillment/accept
POST /api/orders/:id/fulfillment/override
POST /api/backorders/:id/consolidate
```

## Billing

```http
GET  /api/orders/:id/billing
GET  /api/subscriptions/:id/schedule
POST /api/subscriptions/:id/modify
POST /api/subscriptions/:id/cancel
POST /api/payments
```

## Customer portal

```http
POST /api/portal/auth/login
GET  /api/portal/quotations
GET  /api/portal/quotations/:id
POST /api/portal/quotations/:id/negotiations
POST /api/portal/quotations/:id/confirm
```

## Deal health

```http
GET  /api/deal-health
GET  /api/deal-health/:id
POST /api/deal-health/:id/nudge
POST /api/deal-health/:id/escalate
```

## Reporting

```http
GET /api/reports/quotations
GET /api/reports/sales
GET /api/reports/approvals
GET /api/reports/products
GET /api/reports/export?format=pdf
GET /api/reports/export?format=xls
```

## API rules

1. Every mutation is authorized server-side.
2. Every quotation mutation should validate its current version.
3. Material quote changes trigger recalculation.
4. Approval actions require the correct role and current approval state.
5. Portal endpoints never expose internal fields.
6. Errors must be structured and actionable.
