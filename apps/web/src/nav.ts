/**
 * Which roles each workspace area belongs to.
 *
 * A page appears in a role's sidebar only if that role can *do* something there.
 * View-only tabs are not listed at all: a tab you can open but never act on is
 * clutter that costs a click to discover, and every fact on those pages is already
 * shown where the work happens — a quotation's approval chain and audit trail are
 * on the quotation itself, and the customer and product pickers carry tier,
 * ceiling, price and tax inline.
 *
 * Being absent from the sidebar is not the same as being unreachable. Finance must
 * open the quotation it is approving or billing, so `deepLinkFor` keeps that path
 * routable without giving Finance a Quotations tab it cannot author in. That split
 * is the whole reason `navFor` and `canAccess` are separate functions.
 *
 * This mirrors the `internalOnly(...)` guards on the API and is a usability
 * boundary only; the server enforces the same rules and stays the authority.
 */

import type { Role } from './types.js';

export interface NavItem {
  path: string;
  label: string;
  /** Roles that get a sidebar entry, because they can act here. */
  roles: readonly Role[];
  /**
   * Roles that may follow a link into this path but get no sidebar entry —
   * typically a detail view reached from a queue they do own.
   */
  deepLinkFor?: readonly Role[];
}

const ALL_INTERNAL: readonly Role[] = ['SALES_REP', 'SALES_MANAGER', 'FINANCE_OPERATIONS', 'ADMIN'];
const AUTHORS: readonly Role[] = ['SALES_REP', 'SALES_MANAGER', 'ADMIN'];
const REVIEWERS: readonly Role[] = ['SALES_MANAGER', 'FINANCE_OPERATIONS', 'ADMIN'];
const CONFIG_ADMINS: readonly Role[] = ['SALES_MANAGER', 'ADMIN'];
const ADMIN_ONLY: readonly Role[] = ['ADMIN'];

export const WORKSPACE_NAV: readonly NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', roles: ALL_INTERNAL },

  /*
   * Quoting belongs to the people who author quotes. Finance reviews and bills
   * them, so it needs the detail view, but a Quotations tab would only ever be
   * read-only for them.
   */
  { path: '/quotations', label: 'Quotations', roles: AUTHORS, deepLinkFor: ['FINANCE_OPERATIONS'] },
  { path: '/pipeline', label: 'Pipeline', roles: AUTHORS },

  // Approvals is a reviewer's queue. A rep cannot act on any rung; their own
  // quote already shows the chain and who is holding it.
  { path: '/approvals', label: 'Approvals', roles: REVIEWERS },

  // Fulfillment and billing are siblings downstream of a confirmed order, not a
  // sequence. A rep may generate an allocation plan and issue an invoice.
  { path: '/fulfillment', label: 'Fulfillment', roles: ALL_INTERNAL },
  { path: '/billing', label: 'Billing', roles: ALL_INTERNAL },

  // Master data is editable by the config roles; a rep and Finance read what they
  // need from the pickers on the quote itself.
  { path: '/customers', label: 'Customers', roles: CONFIG_ADMINS },
  { path: '/catalog', label: 'Catalogue', roles: CONFIG_ADMINS },

  // Deal health is a sales worklist: Finance can neither nudge nor escalate.
  { path: '/deal-health', label: 'Deal Health', roles: AUTHORS },

  { path: '/reports', label: 'Reports', roles: ALL_INTERNAL },

  // Governance edits the ceilings and recommendation inputs the engines read.
  { path: '/governance', label: 'Governance', roles: CONFIG_ADMINS },

  { path: '/users', label: 'Users', roles: ADMIN_ONLY },

  // Settings is engine calibration and only an Admin may change a value.
  { path: '/settings', label: 'Settings', roles: ADMIN_ONLY },
];

function itemFor(path: string): NavItem | undefined {
  return WORKSPACE_NAV.find((n) => path === n.path || path.startsWith(`${n.path}/`));
}

/** Sidebar entries for a role: only where it can act. */
export function navFor(role: Role | undefined): readonly NavItem[] {
  if (!role) return [];
  return WORKSPACE_NAV.filter((item) => item.roles.includes(role));
}

/** True when the role may reach this path, whether or not it is in the sidebar. */
export function canAccess(role: Role | undefined, path: string): boolean {
  if (!role) return false;
  const item = itemFor(path);
  // Unlisted paths stay reachable; the server remains the authority.
  if (!item) return true;
  return item.roles.includes(role) || (item.deepLinkFor?.includes(role) ?? false);
}

/**
 * True when the role can open the path but has no sidebar entry for it — used to
 * decide whether a cross-page link is worth rendering.
 */
export function isDeepLinkOnly(role: Role | undefined, path: string): boolean {
  if (!role) return false;
  const item = itemFor(path);
  if (!item) return false;
  return !item.roles.includes(role) && (item.deepLinkFor?.includes(role) ?? false);
}

export { AUTHORS, REVIEWERS, CONFIG_ADMINS, ADMIN_ONLY, ALL_INTERNAL };
