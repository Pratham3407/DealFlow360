/**
 * Role-based navigation.
 *
 * The matrix decides what each role is shown, so a mistake here is how a Sales Rep
 * ends up looking at the Users page. It is only a usability boundary — the API
 * enforces the same rules and remains the authority — but a tab that opens onto
 * nothing a role can act on is clutter, so the matrix is worth pinning down.
 *
 * The one deliberate asymmetry is `deepLinkFor`: Finance has no Quotations tab
 * because it never authors a quote, yet it must be able to open the quotation it is
 * approving or billing. Sidebar membership and route access are therefore separate
 * questions, and both are asserted below.
 */

import { describe, expect, it } from 'vitest';
import { WORKSPACE_NAV, canAccess, isDeepLinkOnly, navFor } from '../src/nav.js';
import type { Role } from '../src/types.js';

const INTERNAL_ROLES: Role[] = ['SALES_REP', 'SALES_MANAGER', 'FINANCE_OPERATIONS', 'ADMIN'];

const labelsFor = (role: Role) => navFor(role).map((i) => i.label);

describe('admin-only areas', () => {
  it('shows Users to an Admin and nobody else', () => {
    expect(labelsFor('ADMIN')).toContain('Users');
    for (const role of ['SALES_REP', 'SALES_MANAGER', 'FINANCE_OPERATIONS'] as Role[]) {
      expect(labelsFor(role)).not.toContain('Users');
      expect(canAccess(role, '/users')).toBe(false);
    }
  });

  it('blocks the Users route by URL, not just in the sidebar', () => {
    expect(canAccess('SALES_REP', '/users')).toBe(false);
    expect(canAccess('ADMIN', '/users')).toBe(true);
  });

  it('limits Settings to an Admin, the only role that may change a value', () => {
    expect(labelsFor('ADMIN')).toContain('Settings');
    for (const role of ['SALES_REP', 'SALES_MANAGER', 'FINANCE_OPERATIONS'] as Role[]) {
      expect(labelsFor(role)).not.toContain('Settings');
      expect(canAccess(role, '/settings')).toBe(false);
    }
  });
});

describe('configuration areas', () => {
  it('limits Governance to a Sales Manager and an Admin', () => {
    expect(labelsFor('SALES_MANAGER')).toContain('Governance');
    expect(labelsFor('ADMIN')).toContain('Governance');
    expect(labelsFor('SALES_REP')).not.toContain('Governance');
    expect(labelsFor('FINANCE_OPERATIONS')).not.toContain('Governance');
  });

  it('keeps master data with the roles that can edit it', () => {
    for (const label of ['Customers', 'Catalogue']) {
      expect(labelsFor('SALES_MANAGER')).toContain(label);
      expect(labelsFor('ADMIN')).toContain(label);
      // A rep reads what it needs from the pickers on the quotation itself.
      expect(labelsFor('SALES_REP')).not.toContain(label);
      expect(labelsFor('FINANCE_OPERATIONS')).not.toContain(label);
    }
  });
});

describe('no view-only tabs', () => {
  it('keeps Approvals out of a rep sidebar', () => {
    // A rep cannot act on any rung; the chain is on their own quotation instead.
    expect(labelsFor('SALES_REP')).not.toContain('Approvals');
    expect(canAccess('SALES_REP', '/approvals')).toBe(false);
  });

  it('gives Approvals to every reviewer', () => {
    for (const role of ['SALES_MANAGER', 'FINANCE_OPERATIONS', 'ADMIN'] as Role[]) {
      expect(labelsFor(role)).toContain('Approvals');
    }
  });

  it('hides Deal Health from Finance, who can neither nudge nor escalate', () => {
    for (const role of ['SALES_REP', 'SALES_MANAGER', 'ADMIN'] as Role[]) {
      expect(labelsFor(role)).toContain('Deal Health');
    }
    expect(labelsFor('FINANCE_OPERATIONS')).not.toContain('Deal Health');
    expect(canAccess('FINANCE_OPERATIONS', '/deal-health')).toBe(false);
  });

  it('gives Finance no Quotations tab but still lets it open one', () => {
    // Finance approves and bills quotations, so the detail view must stay
    // reachable even though a list it cannot author in does not belong in the rail.
    expect(labelsFor('FINANCE_OPERATIONS')).not.toContain('Quotations');
    expect(canAccess('FINANCE_OPERATIONS', '/quotations/abc-123')).toBe(true);
    expect(isDeepLinkOnly('FINANCE_OPERATIONS', '/quotations/abc-123')).toBe(true);
  });

  it('does not treat an authored page as deep-link-only', () => {
    expect(isDeepLinkOnly('SALES_REP', '/quotations')).toBe(false);
    expect(isDeepLinkOnly('ADMIN', '/quotations')).toBe(false);
  });

  it('keeps Pipeline with the authors', () => {
    expect(labelsFor('SALES_REP')).toContain('Pipeline');
    expect(labelsFor('FINANCE_OPERATIONS')).not.toContain('Pipeline');
  });
});

describe('shared areas', () => {
  it('gives every internal role the pages the whole workflow needs', () => {
    // Billing is open to all four — a rep may issue the invoice on their own deal —
    // and Fulfillment because a rep may generate an allocation plan.
    for (const role of INTERNAL_ROLES) {
      const labels = labelsFor(role);
      for (const shared of ['Dashboard', 'Billing', 'Fulfillment', 'Reports']) {
        expect(labels, `${role} is missing ${shared}`).toContain(shared);
      }
    }
  });

  it('gives an Admin every page in the matrix', () => {
    expect(labelsFor('ADMIN')).toHaveLength(WORKSPACE_NAV.length);
  });

  it('narrows as authority narrows', () => {
    expect(navFor('ADMIN').length).toBeGreaterThan(navFor('SALES_MANAGER').length);
    expect(navFor('SALES_MANAGER').length).toBeGreaterThan(navFor('SALES_REP').length);
    expect(navFor('SALES_REP').length).toBeGreaterThan(navFor('FINANCE_OPERATIONS').length);
  });
});

describe('edge cases', () => {
  it('shows nothing when there is no session', () => {
    expect(navFor(undefined)).toHaveLength(0);
    expect(canAccess(undefined, '/quotations')).toBe(false);
    expect(isDeepLinkOnly(undefined, '/quotations')).toBe(false);
  });

  it('gives a portal customer no workspace page at all', () => {
    expect(navFor('CUSTOMER')).toHaveLength(0);
    expect(canAccess('CUSTOMER', '/users')).toBe(false);
    expect(canAccess('CUSTOMER', '/quotations')).toBe(false);
  });

  it('matches a nested route to its parent area', () => {
    expect(canAccess('SALES_REP', '/quotations/new')).toBe(true);
    expect(canAccess('FINANCE_OPERATIONS', '/quotations/abc-123')).toBe(true);
  });

  it('leaves an unlisted path reachable, deferring to the server', () => {
    // The matrix is not an allowlist; a page it does not know about is the API's
    // problem, not something to silently hide.
    expect(canAccess('SALES_REP', '/some/future/page')).toBe(true);
  });

  it('lists every area exactly once', () => {
    const paths = WORKSPACE_NAV.map((i) => i.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('never lists a role as both an owner and a deep-link guest', () => {
    for (const item of WORKSPACE_NAV) {
      for (const role of item.deepLinkFor ?? []) {
        expect(item.roles, `${item.path} lists ${role} twice`).not.toContain(role);
      }
    }
  });

  it('gives every listed page at least one role', () => {
    for (const item of WORKSPACE_NAV) {
      expect(item.roles.length, `${item.path} is unreachable`).toBeGreaterThan(0);
    }
  });
});
