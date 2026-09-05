# DealFlow360 — Requirement Traceability

| Source requirement | Documentation |
|---|---|
| Multi-tier discount governance | PRD §13, BUSINESS_RULES |
| Automated approval routing | PRD §14, STATE_MACHINES |
| Upsell/cross-sell | PRD §12 |
| Multi-warehouse fulfillment | PRD §8 |
| Backorders | WORKFLOWS §7 |
| Hybrid billing | PRD §18 |
| Subscription proration | BUSINESS_RULES §9 |
| Customer portal | PRD §15 |
| Customer negotiation | WORKFLOWS §9 |
| Negotiation re-approval | PRD §16 |
| Deal health | PRD §17 |
| Reporting | PRD §19 |
| Audit trails | PRD §20 |
| RBAC | RBAC.md |
| Backend configuration | PRD §7 |
| Five-minute demo | PRD §24 |
| Seed data | SEED_DATA.md |
| Architecture diagram | ARCHITECTURE.md |
| Quick test flow | ACCEPTANCE_TESTS.md |

## Important source boundary

The source specification does not define lead generation or automatic Sales Rep assignment.

Therefore the base product assumes:

**A Sales Rep already has/knows the customer and creates the quotation.**

A lead-to-rep assignment system is documented only as a future extension.
