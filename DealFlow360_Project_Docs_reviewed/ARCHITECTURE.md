# DealFlow360 — Architecture & Data Model

> **Deliverable**: One-page architecture diagram showing the data model and how the major modules connect (Problem Statement §8).

---

## 1. System Module Connectivity Architecture

```mermaid
flowchart TB
  subgraph ClientLayer ["1. Presentation Layer (React 19 + Vite + TypeScript)"]
    direction LR
    InternalUI["Internal Sales Workspace\n(Pipeline Kanban · Quotation Builder · Approvals · Fulfillment · Billing · Deal Health)"]
    PortalUI["Customer Negotiation Portal\n(Magic Link Auth · Negotiation Tool · 1-Click Accept)"]
  end

  subgraph Gateway ["2. HTTP API & Security Layer (Express + Zod)"]
    direction TB
    AuthMiddleware["Auth & RBAC Middleware\n(JWT · Role Guards: Rep, Manager, Finance, Admin, Customer)"]
    AuditLogger["Append-Only Audit Interceptor\n(PostgreSQL Trigger Enforced)"]
  end

  subgraph EngineLayer ["3. Core Domain Engines & Business Logic"]
    direction TB
    QuotationService["Quotation Engine\n(Line Item Versioning · Apportionment)"]
    PricingEngine["Tier Pricing & Ceiling Resolver\n(Rule Priority: Tier+Category > Tier > Global)"]
    RiskEngine["Blended Risk Engine\n(Severity 60% · Breadth 30% · Exposure 100% · Order Discount 100%)"]
    ApprovalEngine["Sequential Approval Router\n(NONE → MANAGER → MANAGER_FINANCE)"]
    FulfillmentEngine["Multi-Warehouse Split Engine\n(Cost-Weighted Allocation · Backorder Consolidation)"]
    BillingEngine["Hybrid Billing Engine\n(One-Time Invoices · Subscriptions with Daily Proration)"]
    HealthEngine["Deal Health & Anomaly Sweep\n(Stalled Deals · Slippage · Anomaly Multiplier)"]
    RecEngine["Upsell / Cross-Sell Engine\n(Affinity Pairing · Promotions · Margin Delta Guard)"]
  end

  subgraph DataLayer ["4. Persistence Layer (PostgreSQL 16 + Drizzle ORM)"]
    direction LR
    IdentityTables[(Identity & Tiers)]
    CatalogTables[(Catalog & Price Lists)]
    DealTables[(Quotations & Negotiations)]
    FulfillmentTables[(Warehouses & Inventory)]
    BillingTables[(Invoices & Subscriptions)]
    AuditTables[(Audit Logs & Deal Health)]
  end

  ClientLayer --> Gateway
  Gateway --> EngineLayer
  EngineLayer --> DataLayer

  %% Inter-Engine Flows
  QuotationService <--> PricingEngine
  QuotationService <--> RiskEngine
  RiskEngine --> ApprovalEngine
  QuotationService --> FulfillmentEngine
  QuotationService --> BillingEngine
  QuotationService <--> RecEngine
  HealthEngine -.-> QuotationService
  EngineLayer --> AuditLogger
  AuditLogger --> AuditTables
```

---

## 2. Complete Data Model (Entity Relationship Diagram)

```mermaid
erDiagram
    CUSTOMER_TIERS ||--o{ CUSTOMERS : classifies
    CUSTOMERS ||--o{ QUOTATIONS : receives
    CUSTOMERS ||--o{ USERS : portal_access
    USERS ||--o{ QUOTATIONS : manages_as_rep
    USERS ||--o{ APPROVAL_INSTANCES : reviews
    CUSTOMER_TIERS ||--o{ DISCOUNT_RULES : sets_ceilings
    CUSTOMER_TIERS ||--o{ PRICE_LISTS : tier_pricing

    CATEGORIES ||--o{ PRODUCTS : categorizes
    CATEGORIES ||--o{ DISCOUNT_RULES : category_ceiling
    PRODUCTS ||--o{ PRODUCT_VARIANTS : has_variants
    PRODUCTS ||--o{ PRICE_LIST_ITEMS : prices
    PRICE_LISTS ||--o{ PRICE_LIST_ITEMS : contains
    PRODUCTS ||--o{ PRODUCT_PAIRINGS : primary_product
    PRODUCTS ||--o{ INVENTORY : stocked_in
    WAREHOUSES ||--o{ INVENTORY : holds_stock

    QUOTATIONS ||--|{ QUOTATION_LINES : contains
    PRODUCTS ||--o{ QUOTATION_LINES : item_quoted
    PRODUCT_VARIANTS ||--o{ QUOTATION_LINES : variant_selected

    QUOTATIONS ||--o{ APPROVAL_INSTANCES : routes_to
    QUOTATIONS ||--o{ NEGOTIATION_REQUESTS : customer_counters
    QUOTATION_LINES ||--o{ NEGOTIATION_REQUESTS : targets_line

    QUOTATIONS ||--o| FULFILLMENTS : generates_plan
    FULFILLMENTS ||--o{ FULFILLMENT_ALLOCATIONS : dispatches
    WAREHOUSES ||--o{ FULFILLMENT_ALLOCATIONS : sourced_from
    QUOTATION_LINES ||--o{ FULFILLMENT_ALLOCATIONS : fulfills
    FULFILLMENTS ||--o{ BACKORDERS : logs_shortage
    QUOTATION_LINES ||--o{ BACKORDERS : backorders_line

    QUOTATIONS ||--o{ INVOICES : one_time_billing
    INVOICES ||--|{ INVOICE_LINES : bills_items
    INVOICES ||--o{ PAYMENTS : settles
    INVOICES ||--o{ CREDIT_NOTES : refunds_or_adjusts

    QUOTATIONS ||--o{ SUBSCRIPTIONS : recurring_billing
    SUBSCRIPTION_PLANS ||--o{ SUBSCRIPTIONS : dictates_terms
    SUBSCRIPTIONS ||--|{ SUBSCRIPTION_PERIODS : generates_schedule

    QUOTATIONS ||--o{ DEAL_HEALTH_EVENTS : triggers_alerts
    USERS ||--o{ AUDIT_LOGS : performs_action
    QUOTATIONS ||--o{ AUDIT_LOGS : tracks_changes

    CUSTOMER_TIERS {
      uuid id PK
      text name
      integer rank
      integer default_discount_ceiling_bp
    }

    CUSTOMERS {
      uuid id PK
      text code UK
      text name
      uuid tier_id FK
      text contact_email
      integer payment_terms_days
    }

    PRODUCTS {
      uuid id PK
      text sku UK
      text name
      uuid category_id FK
      integer base_price_paise
      integer unit_cost_paise
      integer tax_bp
      text billing_type
      boolean stock_tracked
    }

    PRODUCT_VARIANTS {
      uuid id PK
      uuid product_id FK
      text attribute
      text value
      integer extra_price_paise
    }

    QUOTATIONS {
      uuid id PK
      text quote_number UK
      uuid customer_id FK
      uuid sales_rep_id FK
      text status
      integer version
      integer order_discount_bp
      integer subtotal_paise
      integer discount_total_paise
      integer tax_total_paise
      integer grand_total_paise
      integer margin_bp
      integer risk_score_bp
      text required_approval_level
    }

    QUOTATION_LINES {
      uuid id PK
      uuid quotation_id FK
      uuid product_id FK
      uuid variant_id FK
      integer quantity
      integer unit_price_paise
      integer discount_bp
      integer effective_ceiling_bp
      integer violation_bp
      integer line_total_paise
      integer margin_paise
      text line_type
    }

    APPROVAL_INSTANCES {
      uuid id PK
      uuid quotation_id FK
      integer quotation_version
      integer attempt
      integer sequence
      text level
      text status
      integer risk_score_bp
      text reason
    }

    FULFILLMENTS {
      uuid id PK
      uuid quotation_id FK
      text status
      integer planned_shipment_count
      integer planned_shipping_cost_paise
      boolean is_overridden
      date projected_delivery_date
    }

    FULFILLMENT_ALLOCATIONS {
      uuid id PK
      uuid fulfillment_id FK
      uuid quotation_line_id FK
      uuid warehouse_id FK
      integer quantity
      integer shipment_cost_paise
      boolean reserved
    }

    INVOICES {
      uuid id PK
      text invoice_number UK
      uuid quotation_id FK
      text status
      integer total_paise
      integer paid_paise
      date due_date
    }

    SUBSCRIPTIONS {
      uuid id PK
      uuid quotation_id FK
      uuid plan_id FK
      text status
      integer quantity
      integer recurring_amount_paise
      date current_period_start
      date current_period_end
    }

    AUDIT_LOGS {
      uuid id PK
      uuid user_id FK
      text entity_type
      uuid entity_id
      text action
      jsonb old_value
      jsonb new_value
      timestamp created_at
    }
```

---

## 3. Module Interaction & Lifecycle Sequence

```mermaid
sequenceDiagram
    autonumber
    actor Rep as Sales Rep
    actor Mgr as Sales Manager
    actor Cust as Customer (Portal)
    participant API as API Layer
    participant Risk as Risk & Rules Engine
    participant Wh as Warehouse Engine
    participant Bill as Billing Engine

    Note over Rep, API: Phase 1: Quoting & Governance Routing
    Rep->>API: Build quotation (Product lines + discounts)
    API->>Risk: Score exceptions & resolve discount ceilings
    Risk-->>API: Blended Risk Score (Severity + Breadth + Exposure + Order Disc)
    API->>API: Route to required approval level (None / Manager / Finance)

    opt If Discretion Ceiling Exceeded
        API-->>Mgr: Raise approval instance in queue
        Mgr->>API: Approve quotation with reason
        API->>API: Quotation status updated to APPROVED
    end

    Note over Rep, Cust: Phase 2: Customer Portal Negotiation
    Rep->>API: Send quotation to customer
    API-->>Cust: Magic link access to negotiation portal
    Cust->>API: Counter discount on service line or ask line question
    API->>Risk: Re-evaluate risk on proposed terms
    alt Re-breaches Threshold
        API->>API: Automatically re-enters Manager approval flow
        Mgr->>API: Re-approve adjusted terms
    end
    Cust->>API: 1-Click Accept Quotation (Status: CONFIRMED)

    Note over API, Bill: Phase 3: Parallel Fulfillment & Hybrid Billing
    par Multi-Warehouse Allocation
        API->>Wh: Compute stock availability split
        Wh-->>API: Allocation plan (e.g. 12 Main + 8 East, 2 shipments)
        opt Stock Replenished Mid-Fulfillment
            API->>Wh: Consolidate remaining backorders
        end
    and Hybrid Invoicing & Subscriptions
        API->>Bill: Generate one-time invoice & subscription schedule
        Bill-->>API: Invoice ready for payment + Recurring billing schedule
    end
```

---

## 4. Key Architectural Invariants

1. **Integer Money (Paise) & Basis Points (bp)**: Zero floating-point arithmetic is permitted. Rates and discounts are integer basis points ($1\% = 100\text{ bp}$).
2. **Ceiling Snapshots**: When a line is added, its resolved discount ceiling is snapshotted to `quotation_lines.effective_ceiling_bp`. Changing rules later never rewrites past contracts.
3. **Portal Isolation**: Portal responses strip all confidential internals (`costAmountPaise`, `marginPaise`, `violationBp`, internal notes).
4. **Append-Only Audit Trail**: `audit_logs` is protected by PostgreSQL triggers that reject `UPDATE` and `DELETE` at the SQL engine level.
5. **Sibling Fulfillment & Billing**: Once an order reaches `CONFIRMED`, fulfillment and billing run as parallel siblings rather than a rigid linear dependency.
