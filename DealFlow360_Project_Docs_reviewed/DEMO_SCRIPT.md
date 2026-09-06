# DealFlow360 — 5-Minute Live Demo Script

> **Deliverable**: A five-minute live demo script covering at least two full flows end to end, from quotation to fulfillment or billing (Problem Statement §8).

---

## Overview of the Demo

| Timestamp | Phase | Role | What You Show |
|---|---|---|---|
| **0:00 – 0:45** | **Intro & Setup** | Presenter / Admin | Platform overview, self-governing concept, and backend settings. |
| **0:45 – 2:45** | **Flow 1: Quote to Fulfillment** | Sales Rep → Sales Manager → Finance | Build quote, ceiling violation, live upsell, blended risk score, 2-level approval chain, multi-warehouse split & backorder handling. |
| **2:45 – 4:40** | **Flow 2: Portal to Cash** | Customer → Sales Rep → Ops | Customer portal magic link login, line-level counter negotiation, automated re-approval routing, hybrid billing (one-time + recurring), payment recording. |
| **4:40 – 5:00** | **Closing** | Presenter | Architectural invariants, audit append-only trigger, and next steps. |

---

## Demo Credentials Cheat-Sheet

All accounts share the password: `Password123!`

* **Sales Rep**: `rep@dealflow.local`
* **Sales Manager**: `manager@dealflow.local`
* **Finance Operations**: `finance@dealflow.local`
* **Admin**: `admin@dealflow.local`
* **Portal Customer (Acme Corp)**: `buyer@acme.local` (or Magic Link via `/portal/enter`)

---

## Step-by-Step Script

### Phase 1: Introduction & Problem Framing (0:00 – 0:45)

**Presenter Talking Points**:
> *"Most CRM and sales tools treat quotes like glorified PDFs. In the real world, deals involve complex discount exceptions, partial inventory spread across warehouses, mixed hardware and subscription lines, and back-and-forth negotiations that stall deals.*  
> *Meet **DealFlow360**: a self-governing B2B sales operations platform where governance is enforced by policy and application logic, not manual reminders."*

1. **Sign In as Admin**:
   * Navigate to `http://localhost:5173/login`.
   * Log in with `admin@dealflow.local` / `Password123!`.
2. **Show Deal Pipeline Kanban**:
   * Point out the **Pipeline** view showing active quotations across stages (*Draft*, *Pending Approval*, *Approved & Sent*, *Under Negotiation*, *Confirmed*).
   * Note the top quick actions: **Reload Data**, **Go to Back-end**, **Close Workspace**.
3. **Show Backend Setup (§A2–A5)**:
   * Click **Go to Back-end** (navigates to Settings/Governance).
   * Briefly highlight the **Discount Ceilings** (Gold: Hardware 15%, Services 10%) and **Four-Component Blended Risk Weights** (Severity, Breadth, Exposure, Order-Level Discount).

---

### Phase 2: Flow 1 — Quotation, Blended Risk, Approval & Multi-Warehouse Split (0:45 – 2:45)

**Scenario**: Rep creates a quote for Gold customer **Acme Corp**. Gold gets 15% discount on Hardware, but only 10% on Services. The rep offers 12% on Hardware (passes) and 18% on Setup Service (breaches by 8%).

1. **Sign In as Sales Rep**:
   * Click **Close Workspace** and sign in as `rep@dealflow.local`.
   * Click **+ New quotation**. Select Customer **Acme Corp (ACME)**, add delivery date, click **Create draft**.
2. **Add Products to Cart**:
   * **Product 1**: Enterprise Laptop (`HW-LAPTOP-ENT`), Qty: `20`, Discount: `12%`.
     * *Observation*: Inside Gold Hardware ceiling (15%). No violation.
   * **Product 2**: Setup Service (`SVC-SETUP`), Qty: `5`, Discount: `18%`.
     * *Observation*: **Violates the 10% Service ceiling by 8 points!** The line highlights in red with a warning.
   * **Product 3**: Premium Support (`SUB-SUPPORT-PREM`), Qty: `20`, Discount: `0%` (Recurring subscription).
3. **Upsell & Cross-Sell Panel (§B5)**:
   * Alongside the cart, show the **Recommended add-ons** panel.
   * Notice the recommendations ranked by affinity score and active promotions (e.g. *Extended Warranty* with promotion tag).
   * Click **Add** on *Extended Warranty*.
   * *Observation*: The cart subtotal and live margin indicator update immediately!
4. **Blended Risk Score & Auto-Routing (§B4)**:
   * Point to the **Risk / Approval KPI card**: Risk Score is computed from the worst line, exposure, and breadth.
   * Notice **Required Approval** is automatically set to **MANAGER_FINANCE** (requires two sequential rungs).
   * Click **Submit for approval**. Quote enters `PENDING_APPROVAL`.
5. **Two-Rung Sequential Approval**:
   * Log out and log in as `manager@dealflow.local`.
   * Navigate to **Approvals**. View the quotation stepper:
     * Step 1 (Sales Manager): Active and actionable.
     * Step 2 (Finance): Blocked, waiting for Step 1.
   * Click **Approve** with reason: *"Approved for enterprise fleet deal."*
   * Log out and log in as `finance@dealflow.local`.
   * Step 2 is now active. Click **Approve** with reason: *"Margin acceptable over total bundle."*
   * Quote status moves to `APPROVED`.
6. **Multi-Warehouse Fulfillment Split (§B6)**:
   * Navigate to **Fulfillment** and open the quotation.
   * Click **Generate allocation plan**.
   * *Observation*:
     * Main Warehouse only has 12 laptops in stock.
     * The auto-split engine allocates **12 laptops from Main** and **8 laptops from East Depot**, calculating shipment counts and shipping costs.
     * Demonstrate **Manual Override**: click *Override split* to show ops can reallocate between warehouses while the server validates physical stock.

---

### Phase 3: Flow 2 — Customer Portal, Negotiation, Hybrid Billing & Cash (2:45 – 4:40)

**Scenario**: Quote is sent to Acme Corp. The customer opens the live quotation in their customer portal, counters the service discount, and confirms terms.

1. **Send to Customer**:
   * Switch back to Sales Rep (`rep@dealflow.local`), open quote, click **Send to customer**.
   * Quote status updates to `SENT`.
2. **Open Customer Portal (§B8)**:
   * Log out and sign in as customer `buyer@acme.local` (or click *Have a magic link?* on login).
   * *Observation*: Restricted customer view! All internal costs, margins, and risk scores are securely stripped.
3. **Customer Line-Level Negotiation**:
   * Click **Request a change**.
   * Select line: *Setup Service*. Request type: **Counter discount proposal**.
   * Propose discount: `15%`, Comment: *"Can you match 15% for onboarding our team?"*
   * Click **Submit request**. Quotation moves to `UNDER_NEGOTIATION`.
4. **Rep Applies Negotiation & Automated Re-Routing**:
   * Log back in as `rep@dealflow.local`, open the quotation.
   * Show the **Customer Requests** section displaying the customer's counter-offer.
   * Click **Apply**.
   * *Observation*: The customer terms are written onto the line, version bumps to `v2`, and the risk engine re-evaluates. If it exceeds thresholds, it automatically re-enters approval.
5. **1-Click Customer Confirmation**:
   * Customer logs in and clicks **Accept quotation**.
   * Quote status moves to `CONFIRMED`.
6. **Hybrid Billing & Payment (§B7)**:
   * Log in as `finance@dealflow.local` and open **Billing**.
   * Select the confirmed order.
   * *Observation*:
     * **One-Time Lines**: An invoice has been automatically generated for laptops, setup, and warranty.
     * **Recurring Lines**: A subscription has been generated with a 12-month forward billing schedule.
   * Click **Record Payment** against the invoice for ₹100,000.
   * *Observation*: Invoice status moves to `PARTIALLY_PAID` with remaining balance updated in real-time.
   * Record full remaining payment: status moves to `PAID`.

---

### Phase 4: Deal Health & Architectural Summary (4:40 – 5:00)

1. **Deal Health & Anomaly Dashboard (§B9)**:
   * Open **Deal Health**.
   * Show real-time alerts: *Stalled deals*, *Discount anomalies*, and *Delivery promise slippages*.
   * Click **Run health sweep** to show background engine evaluating commercial activity.
   * Click **Nudge** on an alert to show automated sales follow-up tracking.
2. **Closing Highlights**:
   * **Integer arithmetic**: Paise and basis points across all money math.
   * **Append-only audit trigger**: Database-level trigger prevents any user or admin from altering audit logs.
   * **193 Automated Tests**: Proves all rules, engines, and invariants are real application logic.
