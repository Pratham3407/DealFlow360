/**
 * Role, capability and profile types.
 *
 * These mirror the server's contract. The capability list is a rendering hint
 * only - the API re-authorizes every request, so hiding a button here is a
 * convenience, never a security control (AGENTS.md 21, 26).
 */
export const Role = {
  ADMIN: 'ADMIN',
  SALES_REP: 'SALES_REP',
  SALES_MANAGER: 'SALES_MANAGER',
  FINANCE_OPERATIONS: 'FINANCE_OPERATIONS',
  CUSTOMER: 'CUSTOMER',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  SALES_REP: 'Sales Representative',
  SALES_MANAGER: 'Sales Manager',
  FINANCE_OPERATIONS: 'Finance / Operations',
  CUSTOMER: 'Customer',
};

export type Capability =
  | 'products:configure'
  | 'price-lists:configure'
  | 'discount-rules:configure'
  | 'approval-rules:configure'
  | 'warehouses:configure'
  | 'subscription-plans:configure'
  | 'customers:configure'
  | 'users:manage'
  | 'quotations:read-internal'
  | 'quotations:create'
  | 'quotations:edit'
  | 'quotations:apply-discount'
  | 'quotations:confirm'
  | 'margin:view'
  | 'approvals:read-queue'
  | 'approvals:act-manager'
  | 'approvals:act-finance'
  | 'fulfillment:view'
  | 'fulfillment:manage'
  | 'billing:view'
  | 'billing:manage'
  | 'negotiations:create'
  | 'negotiations:respond'
  | 'deal-health:view'
  | 'reports:view-all'
  | 'reports:view-own'
  | 'audit:view-all'
  | 'audit:view-own';

export interface AuthProfile {
  id: string;
  email: string;
  name: string;
  role: Role;
  customerId: string | null;
  customerName: string | null;
  capabilities: Capability[];
}

export function isCustomer(profile: AuthProfile): boolean {
  return profile.role === Role.CUSTOMER;
}

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  customerId: string | null;
  customerName: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}
