# DealFlow360 — Seed Data

The following dataset is designed for the canonical demo.

## Users

### Admin
Email: `admin@dealflow.local`
Role: ADMIN

### Sales Rep
Email: `rep@dealflow.local`
Role: SALES_REP

### Sales Manager
Email: `manager@dealflow.local`
Role: SALES_MANAGER

### Finance/Operations
Email: `finance@dealflow.local`
Role: FINANCE_OPERATIONS

### Customer
Email: `buyer@acme.local`
Role: CUSTOMER
Customer: Acme Corp

---

## Customer tiers

| Tier | Default ceiling |
|---|---:|
| Bronze | 5% |
| Silver | 10% |
| Gold | 15% |

---

## Categories

- Hardware
- Services
- Subscriptions

---

## Products

| Product | Category | Type | Example price |
|---|---|---|---:|
| Enterprise Laptop | Hardware | One-time | ₹80,000 |
| Setup Service | Services | One-time | ₹10,000 |
| Premium Support | Subscriptions | Recurring | ₹5,000/month |
| Extended Warranty | Services | One-time | ₹7,500 |

---

## Category discount ceilings

| Category | Gold ceiling |
|---|---:|
| Hardware | 15% |
| Services | 10% |
| Subscriptions | 15% |

---

## Warehouses

### Main Warehouse
Stock:
- Enterprise Laptop: 12

### East Depot
Stock:
- Enterprise Laptop: 20

Shipping weights should be configured so the recommendation has a meaningful optimization decision.

---

## Subscription plans

### Premium Monthly
- Interval: Monthly
- Proration: Enabled
- Cancellation: Configured
- Partial refund: Enabled

---

# Canonical quote

Customer: Acme Corp

Sales Rep: rep@dealflow.local

Lines:

1. Enterprise Laptop — quantity 20 — 12% discount
2. Setup Service — quantity 5 — 18% discount
3. Premium Support — quantity 20 — recurring

Expected behavior:

- Hardware 12% is within its 15% ceiling.
- Service 18% exceeds its 10% ceiling by 8 points.
- Whole quotation is flagged.
- Manager approval is required.
- If risk is high enough, Finance follows Manager.
- Adding Extended Warranty should update total and margin.
- Laptop stock should be split across Main Warehouse and East Depot.
- One-time and recurring billing must be separated.
- Customer countering with a larger discount must re-trigger risk evaluation and approval.
