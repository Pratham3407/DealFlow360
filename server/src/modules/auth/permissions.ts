import { Role } from '../../generated/prisma/enums';

/**
 * Capability model, transcribed from the permission matrix in docs/RBAC.md.
 *
 * Route handlers ask for a capability rather than naming roles inline, so the
 * matrix stays in one auditable place and a role change is a single edit here.
 *
 * Where docs/RBAC.md records a capability as "Optional" for a role, the least
 * privileged reading is taken and noted below. In particular ADMIN does not hold
 * the two approval capabilities: the document lists them as "No/Optional" for
 * Admin, and keeping configuration authority separate from deal approval
 * authority preserves separation of duties (an admin can otherwise raise its own
 * ceilings and then approve against them).
 */
export const Capability = {
  // ---- Configuration writes (docs/RBAC.md rows 1-6) ----
  PRODUCTS_CONFIGURE: 'products:configure',
  PRICE_LISTS_CONFIGURE: 'price-lists:configure',
  DISCOUNT_RULES_CONFIGURE: 'discount-rules:configure',
  APPROVAL_RULES_CONFIGURE: 'approval-rules:configure',
  WAREHOUSES_CONFIGURE: 'warehouses:configure',
  SUBSCRIPTION_PLANS_CONFIGURE: 'subscription-plans:configure',
  CUSTOMERS_CONFIGURE: 'customers:configure',
  USERS_MANAGE: 'users:manage',

  /**
   * ---- Master-data reads ----
   *
   * Split from the write capabilities above because every internal role needs to
   * read master data to do its job - a sales rep cannot build a quotation
   * without the customer list and the catalogue - while only the roles named in
   * docs/RBAC.md may change it. Reads are granted to all four internal roles and
   * to none of the customer role; the portal boundary refuses customer sessions
   * at the namespace, and customer-facing data arrives through /api/portal.
   */
  CUSTOMERS_READ: 'customers:read',
  CATALOG_READ: 'catalog:read',
  PRICING_READ: 'pricing:read',
  INVENTORY_READ: 'inventory:read',

  // ---- Quotations (rows 7-9, 16) ----
  QUOTATIONS_READ_INTERNAL: 'quotations:read-internal',
  QUOTATIONS_CREATE: 'quotations:create',
  QUOTATIONS_EDIT: 'quotations:edit',
  QUOTATIONS_APPLY_DISCOUNT: 'quotations:apply-discount',
  QUOTATIONS_CONFIRM: 'quotations:confirm',
  MARGIN_VIEW: 'margin:view',

  // ---- Approval (rows 10-11) ----
  APPROVALS_READ_QUEUE: 'approvals:read-queue',
  APPROVALS_ACT_MANAGER: 'approvals:act-manager',
  APPROVALS_ACT_FINANCE: 'approvals:act-finance',

  // ---- Operations (rows 12-13) ----
  FULFILLMENT_VIEW: 'fulfillment:view',
  FULFILLMENT_MANAGE: 'fulfillment:manage',
  BILLING_VIEW: 'billing:view',
  BILLING_MANAGE: 'billing:manage',

  // ---- Negotiation (row 14) ----
  NEGOTIATIONS_CREATE: 'negotiations:create',
  NEGOTIATIONS_RESPOND: 'negotiations:respond',

  // ---- Analytics and audit (rows 17-18) ----
  DEAL_HEALTH_VIEW: 'deal-health:view',
  REPORTS_VIEW_ALL: 'reports:view-all',
  REPORTS_VIEW_OWN: 'reports:view-own',
  AUDIT_VIEW_ALL: 'audit:view-all',
  AUDIT_VIEW_OWN: 'audit:view-own',
} as const;

export type Capability = (typeof Capability)[keyof typeof Capability];

const C = Capability;

/**
 * Master-data reads, held by every internal role.
 *
 * Declared once and spread into each role so the four lists cannot drift apart -
 * a rep that could not read the catalogue would be unable to build a quotation
 * at all, which is the kind of gap that is easy to introduce by editing one list
 * and forgetting the others.
 */
const MASTER_DATA_READS = [
  C.CUSTOMERS_READ,
  C.CATALOG_READ,
  C.PRICING_READ,
  C.INVENTORY_READ,
] as const;

const ROLE_CAPABILITIES: Readonly<Record<Role, readonly Capability[]>> = {
  [Role.ADMIN]: [
    C.PRODUCTS_CONFIGURE,
    C.PRICE_LISTS_CONFIGURE,
    C.DISCOUNT_RULES_CONFIGURE,
    C.APPROVAL_RULES_CONFIGURE,
    C.WAREHOUSES_CONFIGURE,
    C.SUBSCRIPTION_PLANS_CONFIGURE,
    C.CUSTOMERS_CONFIGURE,
    C.USERS_MANAGE,
    ...MASTER_DATA_READS,
    C.QUOTATIONS_READ_INTERNAL,
    C.QUOTATIONS_CREATE,
    C.QUOTATIONS_EDIT,
    C.QUOTATIONS_APPLY_DISCOUNT,
    C.QUOTATIONS_CONFIRM,
    C.MARGIN_VIEW,
    C.APPROVALS_READ_QUEUE,
    C.FULFILLMENT_VIEW,
    C.FULFILLMENT_MANAGE,
    C.BILLING_VIEW,
    C.BILLING_MANAGE,
    C.DEAL_HEALTH_VIEW,
    C.REPORTS_VIEW_ALL,
    C.AUDIT_VIEW_ALL,
  ],

  [Role.SALES_REP]: [
    ...MASTER_DATA_READS,
    C.QUOTATIONS_READ_INTERNAL,
    C.QUOTATIONS_CREATE,
    C.QUOTATIONS_EDIT,
    C.QUOTATIONS_APPLY_DISCOUNT,
    C.QUOTATIONS_CONFIRM,
    C.MARGIN_VIEW,
    C.NEGOTIATIONS_RESPOND,
    // "Track" in docs/RBAC.md: a rep watches fulfillment but cannot change it.
    C.FULFILLMENT_VIEW,
    C.BILLING_VIEW,
    C.REPORTS_VIEW_OWN,
    C.AUDIT_VIEW_OWN,
  ],

  [Role.SALES_MANAGER]: [
    C.DISCOUNT_RULES_CONFIGURE,
    C.APPROVAL_RULES_CONFIGURE,
    ...MASTER_DATA_READS,
    C.QUOTATIONS_READ_INTERNAL,
    C.MARGIN_VIEW,
    C.APPROVALS_READ_QUEUE,
    C.APPROVALS_ACT_MANAGER,
    C.NEGOTIATIONS_RESPOND,
    C.FULFILLMENT_VIEW,
    C.BILLING_VIEW,
    C.DEAL_HEALTH_VIEW,
    C.REPORTS_VIEW_ALL,
    C.AUDIT_VIEW_ALL,
  ],

  [Role.FINANCE_OPERATIONS]: [
    C.WAREHOUSES_CONFIGURE,
    C.SUBSCRIPTION_PLANS_CONFIGURE,
    ...MASTER_DATA_READS,
    C.QUOTATIONS_READ_INTERNAL,
    C.MARGIN_VIEW,
    C.APPROVALS_READ_QUEUE,
    C.APPROVALS_ACT_FINANCE,
    C.NEGOTIATIONS_RESPOND,
    C.FULFILLMENT_VIEW,
    C.FULFILLMENT_MANAGE,
    C.BILLING_VIEW,
    C.BILLING_MANAGE,
    C.DEAL_HEALTH_VIEW,
    C.REPORTS_VIEW_OWN,
    C.AUDIT_VIEW_OWN,
  ],

  /**
   * Deliberately tiny. A customer reads its own quotations through the portal
   * endpoints, which additionally scope every query by the authenticated
   * customer id. Note the absence of MARGIN_VIEW - internal margin must never
   * reach a customer (docs/PRD.md 15, AGENTS.md 12).
   */
  [Role.CUSTOMER]: [C.NEGOTIATIONS_CREATE, C.QUOTATIONS_CONFIRM],
};

const CAPABILITY_SETS: Readonly<Record<Role, ReadonlySet<Capability>>> = {
  [Role.ADMIN]: new Set(ROLE_CAPABILITIES[Role.ADMIN]),
  [Role.SALES_REP]: new Set(ROLE_CAPABILITIES[Role.SALES_REP]),
  [Role.SALES_MANAGER]: new Set(ROLE_CAPABILITIES[Role.SALES_MANAGER]),
  [Role.FINANCE_OPERATIONS]: new Set(ROLE_CAPABILITIES[Role.FINANCE_OPERATIONS]),
  [Role.CUSTOMER]: new Set(ROLE_CAPABILITIES[Role.CUSTOMER]),
};

export function can(role: Role, capability: Capability): boolean {
  return CAPABILITY_SETS[role].has(capability);
}

/**
 * Capabilities for a role, sorted for stable output.
 *
 * Sent to the client by GET /api/auth/me purely so the UI can hide actions it
 * cannot perform. It is a rendering hint, never an authorization decision - the
 * server re-checks on every request (AGENTS.md 21).
 */
export function capabilitiesFor(role: Role): Capability[] {
  return [...CAPABILITY_SETS[role]].sort();
}

/** True for every role except CUSTOMER. */
export function isInternalRole(role: Role): boolean {
  return role !== Role.CUSTOMER;
}
