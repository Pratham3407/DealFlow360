import { describe, expect, it } from 'vitest';
import { Prisma } from '../../src/generated/prisma/client';
import { resolveUnitPriceFrom } from '../../src/modules/pricing/priceResolution';

describe('unit price resolution order', () => {
  it('prefers a matching price-list entry over the base price', () => {
    const resolved = resolveUnitPriceFrom({
      basePrice: '80000.00',
      priceListPrice: '72000.00',
      priceListId: 'pl-gold',
      variantExtraPrice: null,
    });

    expect(resolved.unitPrice.toFixed(2)).toBe('72000.00');
    expect(resolved.source).toBe('PRICE_LIST');
    expect(resolved.priceListId).toBe('pl-gold');
  });

  it('falls back to base price when the list holds no entry for the product', () => {
    // A price list is a set of overrides, not a catalogue, so a miss is normal.
    const resolved = resolveUnitPriceFrom({
      basePrice: '80000.00',
      priceListPrice: null,
      priceListId: 'pl-gold',
      variantExtraPrice: null,
    });

    expect(resolved.unitPrice.toFixed(2)).toBe('80000.00');
    expect(resolved.source).toBe('BASE_PRICE');
    // No list decided the price, so none is reported.
    expect(resolved.priceListId).toBeNull();
  });

  it('adds the variant uplift on top of a price-list price', () => {
    const resolved = resolveUnitPriceFrom({
      basePrice: '80000.00',
      priceListPrice: '72000.00',
      priceListId: 'pl-gold',
      variantExtraPrice: '9000.00',
    });

    expect(resolved.unitPrice.toFixed(2)).toBe('81000.00');
    expect(resolved.source).toBe('PRICE_LIST');
    expect(resolved.variantExtraPrice.toFixed(2)).toBe('9000.00');
  });

  it('adds the variant uplift on top of a base price', () => {
    const resolved = resolveUnitPriceFrom({
      basePrice: '80000.00',
      priceListPrice: null,
      priceListId: null,
      variantExtraPrice: '9000.00',
    });

    expect(resolved.unitPrice.toFixed(2)).toBe('89000.00');
    expect(resolved.source).toBe('BASE_PRICE');
  });

  it('treats a zero price-list price as a real override, not a miss', () => {
    // A free-of-charge item is a legitimate commercial decision; falling back to
    // base price here would silently charge for it.
    const resolved = resolveUnitPriceFrom({
      basePrice: '80000.00',
      priceListPrice: '0.00',
      priceListId: 'pl-gold',
      variantExtraPrice: null,
    });

    expect(resolved.unitPrice.toFixed(2)).toBe('0.00');
    expect(resolved.source).toBe('PRICE_LIST');
  });

  it('reports a zero uplift when no variant is chosen', () => {
    const resolved = resolveUnitPriceFrom({
      basePrice: '10000.00',
      priceListPrice: null,
      priceListId: null,
      variantExtraPrice: null,
    });

    expect(resolved.variantExtraPrice.toFixed(2)).toBe('0.00');
  });

  it('accepts Prisma.Decimal inputs as well as strings', () => {
    const resolved = resolveUnitPriceFrom({
      basePrice: new Prisma.Decimal('7500.00'),
      priceListPrice: null,
      priceListId: null,
      variantExtraPrice: new Prisma.Decimal('250.50'),
    });

    expect(resolved.unitPrice.toFixed(2)).toBe('7750.50');
  });

  it('rounds the combined price to two decimal places', () => {
    const resolved = resolveUnitPriceFrom({
      basePrice: '100.005',
      priceListPrice: null,
      priceListId: null,
      variantExtraPrice: '0.001',
    });

    // Rounded once here, so the stored snapshot is exactly what arithmetic uses.
    expect(resolved.unitPrice.toFixed(2)).toBe('100.01');
  });

  it('keeps exact decimals rather than drifting like binary floating point', () => {
    const resolved = resolveUnitPriceFrom({
      basePrice: '0.10',
      priceListPrice: null,
      priceListId: null,
      variantExtraPrice: '0.20',
    });

    expect(resolved.unitPrice.toFixed(2)).toBe('0.30');
  });
});
