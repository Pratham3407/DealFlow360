/**
 * Role-based navigation.
 *
 * The nav matrix decides what each role is shown, so a mistake here is how a
 * Sales Rep ends up looking at the Users page. It is only a usability boundary —
 * the API enforces the same rules and remains the authority — but a page whose
 * every action returns 403 is worse than no page at all, so the matrix is worth
 * pinning down.
 *
 * The two asymmetries are deliberate and asserted: a rep sees Approvals read-only
 * because they need to know which reviewer is holding their quote, and Finance
 * sees Quotations read-only because they need to know what they are billing.
 */

import { describe, expect, it } from 'vitest';
import { WORKSPACE_NAV, canAccess, isReadOnly, navFor } from '../src/nav.js';
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
    // Typing the path must not be a way around the sidebar.
    expect(canAccess('SALES_REP', '/users')).toBe(false);
    expect(canAccess('ADMIN', '/users')).toBe(true);
  });
});

describe('configuration areas', () => {
  it('limits Governance to a Sales Manager and an Admin', () => {
    expect(labelsFor('SALES_MANAGER')).toContain('Governance');
    expect(labelsFor('ADMIN')).toContain('Governance');
    expect(labelsFor('SALES_REP')).not.toContain('Governance');
    expect(labelsFor('FINANCE_OPERATIONS')).not.toContain('Governance');
  });

  it('limits Settings to the roles that configure, since it is calibration', () => {
    expect(labelsFor('ADMIN')).toContain('Settings');
    expect(labelsFor('SALES_MANAGER')).toContain('Settings');
    // A rep's and Finance's own account details live in the sidebar instead.
    expect(labelsFor('SALES_REP')).not.toContain('Settings');
    expect(labelsFor('FINANCE_OPERATIONS')).not.toContain('Settings');
  });

  it('lets only an Admin change a setting', () => {
    expect(isReadOnly('SALES_MANAGER', '/settings')).toBe(true);
    expect(isReadOnly('ADMIN', '/settings')).toBe(false);
  });
});

describe('sales-only areas', () => {
  it('hides Deal Health from Finance, who can neither nudge nor escalate', () => {
    for (const role of ['SALES_REP', 'SALES_MANAGER', 'ADMIN'] as Role[]) {
      expect(labelsFor(role)).toContain('Deal Health');
    }
    expect(labelsFor('FINANCE_OPERATIONS')).not.toContain('Deal Health');
    expect(canAccess('FINANCE_OPERATIONS', '/deal-health')).toBe(false);
  });
});

describe('read-only asymmetries', () => {
  it('gives a rep the approvals queue to watch but not to act on', () => {
    expect(labelsFor('SALES_REP')).toContain('Approvals');
    expect(isReadOnly('SALES_REP', '/approvals')).toBe(true);
    // Reviewers act, so it is not read-only for them.
    expect(isReadOnly('SALES_MANAGER', '/approvals')).toBe(false);
    expect(isReadOnly('FINANCE_OPERATIONS', '/approvals')).toBe(false);
  });

  it('gives Finance quotations to read but not to author', () => {
    expect(labelsFor('FINANCE_OPERATIONS')).toContain('Quotations');
    expect(isReadOnly('FINANCE_OPERATIONS', '/quotations')).toBe(true);
    expect(isReadOnly('SALES_REP', '/quotations')).toBe(false);
  });

  it('marks the catalogue and customer lists read-only for non-config roles', () => {
    for (const path of ['/customers', '/catalog']) {
      expect(isReadOnly('SALES_REP', path)).toBe(true);
      expect(isReadOnly('FINANCE_OPERATIONS', path)).toBe(true);
      expect(isReadOnly('SALES_MANAGER', path)).toBe(false);
      expect(isReadOnly('ADMIN', path)).toBe(false);
    }
  });
});

describe('shared areas', () => {
  it('gives every internal role the pages the whole workflow needs', () => {
    // Billing is open to all four: a rep may issue the invoice on their own deal,
    // and Fulfillment is reachable because a rep may generate an allocation plan.
    for (const role of INTERNAL_ROLES) {
      const labels = labelsFor(role);
      for (const shared of ['Dashboard', 'Quotations', 'Billing', 'Fulfillment', 'Reports']) {
        expect(labels).toContain(shared);
      }
    }
  });

  it('gives an Admin every page in the matrix', () => {
    expect(labelsFor('ADMIN')).toHaveLength(WORKSPACE_NAV.length);
  });

  it('narrows as authority narrows', () => {
    // Admin sees the most, Finance the least — a sanity check that the matrix has
    // not drifted into giving a narrower role more than a broader one.
    expect(navFor('ADMIN').length).toBeGreaterThan(navFor('SALES_MANAGER').length);
    expect(navFor('SALES_MANAGER').length).toBeGreaterThan(navFor('SALES_REP').length);
    expect(navFor('SALES_REP').length).toBeGreaterThan(navFor('FINANCE_OPERATIONS').length);
  });
});

describe('edge cases', () => {
  it('shows nothing when there is no session', () => {
    expect(navFor(undefined)).toHaveLength(0);
    expect(canAccess(undefined, '/quotations')).toBe(false);
  });

  it('gives a portal customer no workspace page at all', () => {
    // CUSTOMER is not listed on any workspace item; the portal is a separate shell.
    expect(navFor('CUSTOMER')).toHaveLength(0);
    expect(canAccess('CUSTOMER', '/users')).toBe(false);
    expect(canAccess('CUSTOMER', '/quotations')).toBe(false);
  });

  it('matches a nested route to its parent area', () => {
    // /quotations/new and /quotations/:id must resolve to the Quotations rules.
    expect(canAccess('SALES_REP', '/quotations/new')).toBe(true);
    expect(canAccess('FINANCE_OPERATIONS', '/quotations/abc-123')).toBe(true);
    expect(isReadOnly('FINANCE_OPERATIONS', '/quotations/abc-123')).toBe(true);
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

  it('never marks a role read-only on a page it cannot reach', () => {
    for (const item of WORKSPACE_NAV) {
      for (const role of item.readOnlyFor ?? []) {
        expect(item.roles).toContain(role);
      }
    }
  });
});
