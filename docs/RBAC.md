# DealFlow360 — RBAC

## Permission matrix

| Capability | Admin | Sales Rep | Manager | Finance/Ops | Customer |
|---|---:|---:|---:|---:|---:|
| Configure products | Yes | No | Optional | No | No |
| Configure price lists | Yes | No | Optional | No | No |
| Configure discount rules | Yes | No | Yes | No | No |
| Configure approval chains | Yes | No | Yes | No | No |
| Configure warehouses | Yes | No | No | Yes | No |
| Configure subscriptions | Yes | No | No | Yes | No |
| Create quotations | Yes | Yes | Optional | No | No |
| Edit quotations | Yes | Yes | Review/return | Limited | Request only |
| Apply discounts | Yes | Yes | Review | Review | Counter proposal |
| View margin | Yes | Yes | Yes | Yes | No |
| Approve manager-level | No/Optional | No | Yes | No | No |
| Approve finance-level | No/Optional | No | No | Yes | No |
| Manage fulfillment | Yes | Track | View | Yes | View limited |
| Manage billing | Yes | View | View | Yes | No |
| Negotiate | No | Respond | Review | Review | Yes |
| Confirm quotation | Yes | On behalf if authorized | Optional | Optional | Yes |
| View all analytics | Yes | Limited | Yes | Relevant | No |
| View audit logs | Yes | Own/authorized | Yes | Relevant | No |

## Portal isolation

Customer API responses must be filtered by authenticated customer identity.

Example:

```text
GET /portal/quotations/Q1001
```

The server must verify:

```text
quotation.customer_id == authenticated_customer.id
```

Never rely on frontend route protection alone.
