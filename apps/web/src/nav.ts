/**
 * Which roles each workspace area is for.
 *
 * A page earns a place in a role's sidebar only if that role has at least one
 * permitted action there, or a genuine reason to read it. Anything else is
 * removed rather than shown disabled — a page whose every button returns 403 is
 * worse than no page, because the user has to discover the boundary by failing.
 *
 * This mirrors the `internalOnly(...)` guards on the API. It is a usability
 * boundary, not a security one: the server enforces the same rules and stays the
 * authority. Read access is deliberately wider than write in a few places, and
 * those are tagged so the limit is visible before clicking.
 */

import type { Role } from './types.js';

export interface NavItem {
  path: string;
  label: string;
  /** Roles that get something useful out of the page. */
  roles: readonly Role[];
  /** Roles that may look but not change anything here. */
  readOnlyFor?: readonly Role[];
}

const ALL_INTERNAL: readonly Role[] = ['SALES_REP', 'SALES_MANAGER', 'FINANCE_OPERATIONS', 'ADMIN'];
const AUTHORS: readonly Role[] = ['SALES_REP', 'SALES_MANAGER', 'ADMIN'];
const REVIEWERS: readonly Role[] = ['SALES_MANAGER', 'FINANCE_OPERATIONS', 'ADMIN'];
const CONFIG_ADMINS: readonly Role[] = ['SALES_MANAGER', 'ADMIN'];
const ADMIN_ONLY: readonly Role[] = ['ADMIN'];

export const WORKSPACE_NAV: readonly NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', roles: ALL_INTERNAL },

  // Quoting. Finance reads a quotation to know what it is approving and billing,
  // but never authors one.
  { path: '/quotations', label: 'Quotations', roles: ALL_INTERNAL, readOnlyFor: ['FINANCE_OPERATIONS'] },
  { path: '/pipeline', label: 'Pipeline', roles: ALL_INTERNAL, readOnlyFor: ['FINANCE_OPERATIONS'] },

  // Approvals. A rep cannot act on any rung, but needs to see which reviewer is
  // holding their quote — that is the whole reason the queue is legible.
  { path: '/approvals', label: 'Approvals', roles: ALL_INTERNAL, readOnlyFor: ['SALES_REP'] },

  // Fulfillment and billing are siblings downstream of a confirmed order, not a
  // sequence. A rep may generate an allocation plan; only ops accept or override it.
  { path: '/fulfillment', label: 'Fulfillment', roles: ALL_INTERNAL },
  { path: '/billing', label: 'Billing', roles: ALL_INTERNAL },

  { path: '/customers', label: 'Customers', roles: ALL_INTERNAL, readOnlyFor: ['SALES_REP', 'FINANCE_OPERATIONS'] },
  { path: '/catalog', label: 'Catalogue', roles: ALL_INTERNAL, readOnlyFor: ['SALES_REP', 'FINANCE_OPERATIONS'] },

  // Deal health is a sales worklist: Finance can neither nudge nor escalate any
  // alert type, so the page would be inert for them.
  { path: '/deal-health', label: 'Deal Health', roles: AUTHORS },

  { path: '/reports', label: 'Reports', roles: ALL_INTERNAL },

  // Governance edits the ceilings and recommendation inputs the engines read.
  { path: '/governance', label: 'Governance', roles: CONFIG_ADMINS },

  { path: '/users', label: 'Users', roles: ADMIN_ONLY },

  /*
   * Settings is engine calibration, approval bands and tier ceilings — it is
   * configuration, so it belongs with the roles that configure. A rep's and
   * Finance's own account details are already in the sidebar, which was the only
   * part of this page relevant to them.
   */
  { path: '/settings', label: 'Settings', roles: CONFIG_ADMINS, readOnlyFor: ['SALES_MANAGER'] },
];

export function navFor(role: Role | undefined): readonly NavItem[] {
  if (!role) return [];
  return WORKSPACE_NAV.filter((item) => item.roles.includes(role));
}

/** True when the signed-in role may reach this path at all. */
export function canAccess(role: Role | undefined, path: string): boolean {
  if (!role) return false;
  const item = WORKSPACE_NAV.find((n) => path === n.path || path.startsWith(`${n.path}/`));
  // Unlisted paths stay reachable; the server remains the authority.
  return item ? item.roles.includes(role) : true;
}

export function isReadOnly(role: Role | undefined, path: string): boolean {
  if (!role) return true;
  const item = WORKSPACE_NAV.find((n) => path === n.path || path.startsWith(`${n.path}/`));
  return item?.readOnlyFor?.includes(role) ?? false;
}

export { AUTHORS, REVIEWERS, CONFIG_ADMINS, ADMIN_ONLY, ALL_INTERNAL };
