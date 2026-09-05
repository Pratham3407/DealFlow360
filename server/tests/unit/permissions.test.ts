import { describe, expect, it } from 'vitest';
import { Role } from '../../src/generated/prisma/enums';
import { Capability, can, capabilitiesFor, isInternalRole } from '../../src/modules/auth/permissions';

describe('capability matrix (docs/RBAC.md)', () => {
  it('gives configuration authority to ADMIN only', () => {
    for (const capability of [
      Capability.PRODUCTS_CONFIGURE,
      Capability.PRICE_LISTS_CONFIGURE,
      Capability.USERS_MANAGE,
      Capability.CUSTOMERS_CONFIGURE,
    ]) {
      expect(can(Role.ADMIN, capability)).toBe(true);
      for (const role of [Role.SALES_REP, Role.SALES_MANAGER, Role.FINANCE_OPERATIONS, Role.CUSTOMER]) {
        expect(can(role, capability)).toBe(false);
      }
    }
  });

  it('shares discount and approval rule configuration with SALES_MANAGER', () => {
    for (const capability of [
      Capability.DISCOUNT_RULES_CONFIGURE,
      Capability.APPROVAL_RULES_CONFIGURE,
    ]) {
      expect(can(Role.ADMIN, capability)).toBe(true);
      expect(can(Role.SALES_MANAGER, capability)).toBe(true);
      expect(can(Role.SALES_REP, capability)).toBe(false);
      expect(can(Role.FINANCE_OPERATIONS, capability)).toBe(false);
    }
  });

  it('gives warehouse and subscription configuration to ADMIN and FINANCE_OPERATIONS', () => {
    for (const capability of [
      Capability.WAREHOUSES_CONFIGURE,
      Capability.SUBSCRIPTION_PLANS_CONFIGURE,
    ]) {
      expect(can(Role.ADMIN, capability)).toBe(true);
      expect(can(Role.FINANCE_OPERATIONS, capability)).toBe(true);
      expect(can(Role.SALES_REP, capability)).toBe(false);
      expect(can(Role.SALES_MANAGER, capability)).toBe(false);
    }
  });

  it('separates manager-level from finance-level approval', () => {
    expect(can(Role.SALES_MANAGER, Capability.APPROVALS_ACT_MANAGER)).toBe(true);
    expect(can(Role.SALES_MANAGER, Capability.APPROVALS_ACT_FINANCE)).toBe(false);

    expect(can(Role.FINANCE_OPERATIONS, Capability.APPROVALS_ACT_FINANCE)).toBe(true);
    expect(can(Role.FINANCE_OPERATIONS, Capability.APPROVALS_ACT_MANAGER)).toBe(false);
  });

  it('never lets a sales rep approve its own quotation (AT-06)', () => {
    expect(can(Role.SALES_REP, Capability.APPROVALS_ACT_MANAGER)).toBe(false);
    expect(can(Role.SALES_REP, Capability.APPROVALS_ACT_FINANCE)).toBe(false);
  });

  it('keeps approval authority away from ADMIN, preserving separation of duties', () => {
    // Recorded as "No/Optional" in docs/RBAC.md; the least-privileged reading is
    // taken so configuration authority cannot approve against its own rules.
    expect(can(Role.ADMIN, Capability.APPROVALS_ACT_MANAGER)).toBe(false);
    expect(can(Role.ADMIN, Capability.APPROVALS_ACT_FINANCE)).toBe(false);
  });

  it('never exposes margin to a customer', () => {
    expect(can(Role.CUSTOMER, Capability.MARGIN_VIEW)).toBe(false);
    for (const role of [Role.ADMIN, Role.SALES_REP, Role.SALES_MANAGER, Role.FINANCE_OPERATIONS]) {
      expect(can(role, Capability.MARGIN_VIEW)).toBe(true);
    }
  });

  it('limits the customer role to negotiating and confirming', () => {
    expect(capabilitiesFor(Role.CUSTOMER)).toEqual(
      [Capability.NEGOTIATIONS_CREATE, Capability.QUOTATIONS_CONFIRM].sort(),
    );
  });

  it('lets only a customer raise a negotiation request', () => {
    expect(can(Role.CUSTOMER, Capability.NEGOTIATIONS_CREATE)).toBe(true);
    for (const role of [Role.ADMIN, Role.SALES_REP, Role.SALES_MANAGER, Role.FINANCE_OPERATIONS]) {
      expect(can(role, Capability.NEGOTIATIONS_CREATE)).toBe(false);
    }
  });

  it('does not let a sales rep change fulfillment or billing, only observe them', () => {
    expect(can(Role.SALES_REP, Capability.FULFILLMENT_VIEW)).toBe(true);
    expect(can(Role.SALES_REP, Capability.FULFILLMENT_MANAGE)).toBe(false);
    expect(can(Role.SALES_REP, Capability.BILLING_VIEW)).toBe(true);
    expect(can(Role.SALES_REP, Capability.BILLING_MANAGE)).toBe(false);
  });

  it('classifies every role except CUSTOMER as internal', () => {
    expect(isInternalRole(Role.CUSTOMER)).toBe(false);
    for (const role of [Role.ADMIN, Role.SALES_REP, Role.SALES_MANAGER, Role.FINANCE_OPERATIONS]) {
      expect(isInternalRole(role)).toBe(true);
    }
  });

  it('returns a stable, duplicate-free capability list for every role', () => {
    for (const role of Object.values(Role)) {
      const capabilities = capabilitiesFor(role);
      expect(capabilities).toEqual([...capabilities].sort());
      expect(new Set(capabilities).size).toBe(capabilities.length);
    }
  });
});
