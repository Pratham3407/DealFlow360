# DealFlow360 — Architecture

## 1. Logical Architecture

```text
                    ┌───────────────────────┐
                    │       Web Client      │
                    │ Internal + Portal UI  │
                    └───────────┬───────────┘
                                │ HTTPS
                    ┌───────────▼───────────┐
                    │       API Layer       │
                    │ Auth + RBAC + DTOs    │
                    └───────────┬───────────┘
                                │
       ┌────────────────────────┼────────────────────────┐
       │                        │                        │
┌──────▼───────┐        ┌───────▼────────┐       ┌──────▼───────┐
│ Quotation    │        │ Rules Engines  │       │ Customer     │
│ Service      │◄──────►│ Risk/Approval  │       │ Portal       │
└──────┬───────┘        └───────┬────────┘       └──────────────┘
       │                        │
       │              ┌─────────▼──────────┐
       │              │ Inventory /        │
       │              │ Fulfillment Engine │
       │              └─────────┬──────────┘
       │                        │
       │              ┌─────────▼──────────┐
       └─────────────►│ Billing Engine     │
                      │ + Subscriptions    │
                      └─────────┬──────────┘
                                │
                    ┌───────────▼───────────┐
                    │ PostgreSQL / Database │
                    └───────────────────────┘

         ┌────────────────────────────────────────┐
         │ Audit Log / Deal Health / Reporting    │
         └────────────────────────────────────────┘
