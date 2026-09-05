import type { Capability } from '../lib/types';

export interface NavItem {
  label: string;
  to: string;
  /** Visible when the profile holds at least one of these. Empty = any internal role. */
  anyOf: Capability[];
  /**
   * Whether the destination is implemented yet. Marked in the sidebar rather
   * than hidden, so the shape of the product is visible without pretending
   * unfinished screens work.
   */
  status: 'ready' | 'planned';
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * Internal workspace navigation.
 *
 * Items are filtered by the capability list the server returned, so the sidebar
 * reflects backend authorization instead of inventing its own idea of what the
 * user may do (AGENTS.md 26). Hiding an item is presentation only - the API
 * re-checks every request.
 */
export const INTERNAL_NAV: NavSection[] = [
  {
    label: 'Workspace',
    items: [
      { label: 'Overview', to: '/overview', anyOf: [], status: 'ready' },
      {
        label: 'Quotations',
        to: '/quotations',
        anyOf: ['quotations:read-internal'],
        status: 'planned',
      },
      { label: 'Pipeline', to: '/pipeline', anyOf: ['quotations:read-internal'], status: 'planned' },
    ],
  },
  {
    label: 'Governance',
    items: [
      { label: 'Approvals', to: '/approvals', anyOf: ['approvals:read-queue'], status: 'planned' },
      { label: 'Deal health', to: '/deal-health', anyOf: ['deal-health:view'], status: 'planned' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Fulfillment', to: '/fulfillment', anyOf: ['fulfillment:view'], status: 'planned' },
      { label: 'Billing', to: '/billing', anyOf: ['billing:view'], status: 'planned' },
    ],
  },
  {
    label: 'Insight',
    items: [
      {
        label: 'Reports',
        to: '/reports',
        anyOf: ['reports:view-all', 'reports:view-own'],
        status: 'planned',
      },
      { label: 'Audit log', to: '/audit', anyOf: ['audit:view-all', 'audit:view-own'], status: 'planned' },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { label: 'Products', to: '/config/products', anyOf: ['products:configure'], status: 'planned' },
      {
        label: 'Discount rules',
        to: '/config/discount-rules',
        anyOf: ['discount-rules:configure'],
        status: 'planned',
      },
      {
        label: 'Approval rules',
        to: '/config/approval-rules',
        anyOf: ['approval-rules:configure'],
        status: 'planned',
      },
      {
        label: 'Warehouses',
        to: '/config/warehouses',
        anyOf: ['warehouses:configure'],
        status: 'planned',
      },
      {
        label: 'Subscription plans',
        to: '/config/subscription-plans',
        anyOf: ['subscription-plans:configure'],
        status: 'planned',
      },
      { label: 'Users', to: '/config/users', anyOf: ['users:manage'], status: 'ready' },
    ],
  },
];

export function visibleSections(
  can: (capability: Capability) => boolean,
): { label: string; items: NavItem[] }[] {
  return INTERNAL_NAV.map((section) => ({
    label: section.label,
    items: section.items.filter((item) => item.anyOf.length === 0 || item.anyOf.some(can)),
  })).filter((section) => section.items.length > 0);
}
