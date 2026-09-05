import { describe, expect, it } from 'vitest';
import {
  resolveEffectiveCeiling,
  violationPoints,
  type CeilingRule,
} from '../../src/modules/pricing/discountRules';

const GOLD = 'tier-gold';
const SILVER = 'tier-silver';
const SERVICES = 'cat-services';
const HARDWARE = 'cat-hardware';

function rule(overrides: Partial<CeilingRule> & Pick<CeilingRule, 'id'>): CeilingRule {
  return {
    customerTierId: GOLD,
    categoryId: null,
    maximumDiscount: '15.000',
    priority: 0,
    active: true,
    ...overrides,
  };
}

describe('effective ceiling resolution (docs/BUSINESS_RULES.md 1)', () => {
  it('falls back to the tier default when no rule exists', () => {
    expect(
      resolveEffectiveCeiling({
        rules: [],
        customerTierId: GOLD,
        categoryId: HARDWARE,
        tierDefaultCeiling: '15',
      }),
    ).toEqual({ maximumDiscount: '15.000', source: 'TIER_DEFAULT', ruleId: null });
  });

  it('uses a tier-wide rule when no category rule matches', () => {
    const rules = [rule({ id: 'r1', maximumDiscount: '12.5' })];

    expect(
      resolveEffectiveCeiling({
        rules,
        customerTierId: GOLD,
        categoryId: HARDWARE,
        tierDefaultCeiling: '15',
      }),
    ).toEqual({ maximumDiscount: '12.500', source: 'TIER_RULE', ruleId: 'r1' });
  });

  it('prefers the category rule over the tier-wide rule - the AT-04 arrangement', () => {
    const rules = [
      rule({ id: 'tier-wide', maximumDiscount: '15' }),
      rule({ id: 'services', categoryId: SERVICES, maximumDiscount: '10', priority: 10 }),
    ];

    const resolved = resolveEffectiveCeiling({
      rules,
      customerTierId: GOLD,
      categoryId: SERVICES,
      tierDefaultCeiling: '15',
    });

    expect(resolved).toEqual({
      maximumDiscount: '10.000',
      source: 'CATEGORY_RULE',
      ruleId: 'services',
    });
    // 18% requested against that 10% ceiling is the documented 8-point violation.
    expect(violationPoints('18', resolved.maximumDiscount)).toBe('8.000');
  });

  it('keeps category precedence even when the tier-wide rule has higher priority', () => {
    // Specificity wins outright; priority only breaks ties at equal specificity.
    const rules = [
      rule({ id: 'tier-wide', maximumDiscount: '25', priority: 999 }),
      rule({ id: 'services', categoryId: SERVICES, maximumDiscount: '10', priority: 0 }),
    ];

    expect(
      resolveEffectiveCeiling({
        rules,
        customerTierId: GOLD,
        categoryId: SERVICES,
        tierDefaultCeiling: '15',
      }).ruleId,
    ).toBe('services');
  });

  it('ignores rules belonging to another tier', () => {
    const rules = [
      rule({ id: 'silver-services', customerTierId: SILVER, categoryId: SERVICES, maximumDiscount: '2' }),
    ];

    expect(
      resolveEffectiveCeiling({
        rules,
        customerTierId: GOLD,
        categoryId: SERVICES,
        tierDefaultCeiling: '15',
      }),
    ).toEqual({ maximumDiscount: '15.000', source: 'TIER_DEFAULT', ruleId: null });
  });

  it('ignores rules for a different category', () => {
    const rules = [rule({ id: 'hardware', categoryId: HARDWARE, maximumDiscount: '20' })];

    expect(
      resolveEffectiveCeiling({
        rules,
        customerTierId: GOLD,
        categoryId: SERVICES,
        tierDefaultCeiling: '15',
      }).source,
    ).toBe('TIER_DEFAULT');
  });

  it('ignores deactivated rules', () => {
    const rules = [
      rule({ id: 'services', categoryId: SERVICES, maximumDiscount: '5', active: false }),
      rule({ id: 'tier-wide', maximumDiscount: '15' }),
    ];

    expect(
      resolveEffectiveCeiling({
        rules,
        customerTierId: GOLD,
        categoryId: SERVICES,
        tierDefaultCeiling: '99',
      }).ruleId,
    ).toBe('tier-wide');
  });

  it('ignores category rules entirely when resolving the tier-wide ceiling', () => {
    const rules = [
      rule({ id: 'services', categoryId: SERVICES, maximumDiscount: '2' }),
      rule({ id: 'tier-wide', maximumDiscount: '15' }),
    ];

    expect(
      resolveEffectiveCeiling({
        rules,
        customerTierId: GOLD,
        categoryId: null,
        tierDefaultCeiling: '99',
      }).ruleId,
    ).toBe('tier-wide');
  });

  it('breaks a priority tie in favour of the stricter ceiling', () => {
    // Should not occur - a partial unique index prevents duplicates - but the
    // result must not depend on row order if it ever does.
    const rules = [
      rule({ id: 'b', categoryId: SERVICES, maximumDiscount: '12', priority: 5 }),
      rule({ id: 'a', categoryId: SERVICES, maximumDiscount: '8', priority: 5 }),
    ];

    expect(
      resolveEffectiveCeiling({
        rules,
        customerTierId: GOLD,
        categoryId: SERVICES,
        tierDefaultCeiling: '15',
      }).maximumDiscount,
    ).toBe('8.000');
  });

  it('prefers higher priority before comparing ceilings', () => {
    const rules = [
      rule({ id: 'low', categoryId: SERVICES, maximumDiscount: '5', priority: 1 }),
      rule({ id: 'high', categoryId: SERVICES, maximumDiscount: '20', priority: 9 }),
    ];

    expect(
      resolveEffectiveCeiling({
        rules,
        customerTierId: GOLD,
        categoryId: SERVICES,
        tierDefaultCeiling: '15',
      }).ruleId,
    ).toBe('high');
  });

  it('is order independent', () => {
    const rules = [
      rule({ id: 'tier-wide', maximumDiscount: '15' }),
      rule({ id: 'services', categoryId: SERVICES, maximumDiscount: '10', priority: 10 }),
    ];

    const forward = resolveEffectiveCeiling({
      rules,
      customerTierId: GOLD,
      categoryId: SERVICES,
      tierDefaultCeiling: '15',
    });
    const reversed = resolveEffectiveCeiling({
      rules: [...rules].reverse(),
      customerTierId: GOLD,
      categoryId: SERVICES,
      tierDefaultCeiling: '15',
    });

    expect(forward).toEqual(reversed);
  });

  it('normalises every result to three decimals', () => {
    expect(
      resolveEffectiveCeiling({
        rules: [],
        customerTierId: GOLD,
        categoryId: null,
        tierDefaultCeiling: '7.5',
      }).maximumDiscount,
    ).toBe('7.500');
  });
});

describe('violation points (docs/BUSINESS_RULES.md 2)', () => {
  it('is zero when the discount is within the ceiling', () => {
    expect(violationPoints('12', '15')).toBe('0.000');
  });

  it('is zero exactly at the ceiling - the boundary is compliant', () => {
    expect(violationPoints('15', '15')).toBe('0.000');
  });

  it('is the excess in percentage points', () => {
    expect(violationPoints('18', '10')).toBe('8.000');
    expect(violationPoints('30', '10')).toBe('20.000');
  });

  it('keeps fractional points exactly, without float drift', () => {
    expect(violationPoints('10.3', '10.1')).toBe('0.200');
    expect(violationPoints('0.3', '0.1')).toBe('0.200');
  });
});
