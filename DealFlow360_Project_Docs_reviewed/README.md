# DealFlow360

An intelligent, self-governing B2B Sales Operations platform.

DealFlow360 manages the complete quotation-to-cash lifecycle:

**Quotation → Approval → Fulfillment → Billing → Customer Negotiation → Reporting**

It is not a marketplace or public product-listing site. The primary commercial interaction is:

**Sales Rep creates a quotation for a specific customer → customer receives the quotation → customer negotiates or confirms → the system enforces approvals and operational rules.**

## What the system solves

Traditional sales tools often stop at quote creation, order confirmation and invoicing. DealFlow360 adds the operational rules that make B2B sales difficult:

- Multi-tier discount governance
- Automatic approval routing
- Blended discount-risk scoring
- Live upsell/cross-sell recommendations
- Real-time margin impact
- Multi-warehouse fulfillment splitting
- Backorder handling
- Hybrid one-time + recurring billing
- Subscription proration
- Customer portal negotiation
- Deal-health monitoring
- Discount anomaly alerts
- Audit trails
- Role-based access
- Reporting and analytics

## Users

| Role | Primary responsibility |
|---|---|
| Admin | Configure products, price lists, discount tiers, approval chains, warehouses, subscription plans and reporting |
| Sales Rep | Create/manage quotations, add products, apply discounts, use upsell suggestions, track approvals and fulfillment, respond to customer negotiation |
| Sales Manager / Approver | Review risky quotations, approve/reject/return them, configure approval rules, monitor deal health |
| Finance / Operations | Handle high-risk second-level approvals, warehouse splits/backorders, recurring billing and credit-note reconciliation |
| Customer / Portal User | View quotations, ask questions, request changes, counter discounts and confirm final terms |

There is no separately defined Warehouse Staff role in the source specification. Warehouse operations are assigned to the Finance/Operations role.

## Core principle

The application itself is an active business actor.

It must not merely display forms. It must:

1. Calculate discount risk.
2. Decide whether approval is required.
3. Route approval to the correct reviewer(s).
4. Recalculate risk when the quotation changes.
5. Recommend products based on configured rules/data.
6. Calculate margin impact.
7. Recommend warehouse allocation from stock.
8. Handle backorders.
9. Generate recurring billing schedules.
10. Calculate proration.
11. Re-enter approval when customer negotiation crosses thresholds.
12. Record audit events.
13. Detect stalled/risky deals.

Core business rules must live in application logic, not hardcoded demo branches.

## Repository documentation

- `PRD.md` — complete product requirements
- `ARCHITECTURE.md` — system architecture and module boundaries
- `DOMAIN_MODEL.md` — entities, relationships and invariants
- `WORKFLOWS.md` — every major business workflow and state transition
- `STATE_MACHINES.md` — quotation, approval, fulfillment, billing and negotiation states
- `API_SPEC.md` — REST API contract proposal
- `RBAC.md` — permissions and portal isolation
- `BUSINESS_RULES.md` — deterministic rules engines and formulas
- `SEED_DATA.md` — realistic demo data and the canonical demo scenario
- `AGENT_INSTRUCTIONS.md` — instructions for AI coding agents working on the project
- `ACCEPTANCE_TESTS.md` — end-to-end acceptance criteria

## Source fidelity

The original hackathon specification is the authoritative source for required functionality. Where this documentation introduces implementation details not explicitly stated in that source, they are marked as **Implementation Decision** or **Recommended Extension**.

Source: `DealFlow360.pdf`.
