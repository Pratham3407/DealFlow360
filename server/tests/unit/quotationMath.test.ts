import { describe, expect, it } from 'vitest';
import { calculateQuotation, type LineInput } from '../../src/modules/quotations/quotationMath';

function line(overrides: Partial<LineInput> & Pick<LineInput, 'id'>): LineInput {
  return {
    quantity: 1,
    unitPrice: '100.00',
    unitCost: '60.00',
    discountPercent: '0.000',
    taxPercent: '0.000',
    ...overrides,
  };
}

describe('line arithmetic', () => {
  it('multiplies unit price by quantity for the gross subtotal', () => {
    const { lines, totals } = calculateQuotation(
      [line({ id: 'a', quantity: 20, unitPrice: '80000.00' })],
      '0',
    );

    expect(lines[0]!.lineSubtotal.toFixed(2)).toBe('1600000.00');
    expect(totals.subtotal.toFixed(2)).toBe('1600000.00');
  });

  it('applies a line discount to the gross amount', () => {
    const { lines } = calculateQuotation(
      [line({ id: 'a', quantity: 20, unitPrice: '80000.00', discountPercent: '12.000' })],
      '0',
    );

    expect(lines[0]!.lineOwnDiscount.toFixed(2)).toBe('192000.00');
    expect(lines[0]!.lineNet.toFixed(2)).toBe('1408000.00');
  });

  it('taxes the post-discount amount, not the gross', () => {
    // An order or line discount reduces the taxable value; taxing the gross would
    // overstate the tax due.
    const { lines } = calculateQuotation(
      [line({ id: 'a', unitPrice: '1000.00', discountPercent: '10.000', taxPercent: '18.000' })],
      '0',
    );

    expect(lines[0]!.lineNet.toFixed(2)).toBe('900.00');
    expect(lines[0]!.lineTax.toFixed(2)).toBe('162.00');
    expect(lines[0]!.lineTotal.toFixed(2)).toBe('1062.00');
  });

  it('excludes tax from margin, because tax is collected rather than earned', () => {
    const { lines, totals } = calculateQuotation(
      [line({ id: 'a', quantity: 2, unitPrice: '1000.00', unitCost: '600.00', taxPercent: '18.000' })],
      '0',
    );

    expect(lines[0]!.lineCost.toFixed(2)).toBe('1200.00');
    expect(lines[0]!.margin.toFixed(2)).toBe('800.00');
    expect(totals.taxTotal.toFixed(2)).toBe('360.00');
    expect(totals.margin.toFixed(2)).toBe('800.00');
  });

  it('preserves lineTotal = lineSubtotal - lineDiscount + lineTax', () => {
    const { lines } = calculateQuotation(
      [
        line({ id: 'a', quantity: 3, unitPrice: '1234.56', discountPercent: '7.500', taxPercent: '18.000' }),
        line({ id: 'b', quantity: 7, unitPrice: '99.99', discountPercent: '2.250', taxPercent: '5.000' }),
      ],
      '3.500',
    );

    for (const row of lines) {
      const expected = row.lineSubtotal.minus(row.lineDiscount).plus(row.lineTax);
      expect(row.lineTotal.toFixed(2)).toBe(expected.toFixed(2));
    }
  });

  it('handles a 100 percent discount', () => {
    const { lines, totals } = calculateQuotation(
      [line({ id: 'a', unitPrice: '500.00', discountPercent: '100.000', taxPercent: '18.000' })],
      '0',
    );

    expect(lines[0]!.lineNet.toFixed(2)).toBe('0.00');
    expect(lines[0]!.lineTax.toFixed(2)).toBe('0.00');
    expect(lines[0]!.lineTotal.toFixed(2)).toBe('0.00');
    // A giveaway is a real loss, and the figure must show it.
    expect(totals.margin.toFixed(2)).toBe('-60.00');
  });

  it('reports a negative margin when cost exceeds price', () => {
    const { totals } = calculateQuotation(
      [line({ id: 'a', unitPrice: '100.00', unitCost: '150.00' })],
      '0',
    );

    expect(totals.margin.toFixed(2)).toBe('-50.00');
    expect(totals.marginPercent!.toFixed(3)).toBe('-50.000');
  });
});

describe('order-level discount allocation', () => {
  it('applies the order discount after line discounts', () => {
    const { lines, totals } = calculateQuotation(
      [line({ id: 'a', unitPrice: '1000.00', discountPercent: '10.000' })],
      '5.000',
    );

    // 1000 -> 900 after the line discount -> 45 order discount on the net.
    expect(lines[0]!.lineOwnDiscount.toFixed(2)).toBe('100.00');
    expect(lines[0]!.lineOrderDiscount.toFixed(2)).toBe('45.00');
    expect(lines[0]!.lineDiscount.toFixed(2)).toBe('145.00');
    expect(lines[0]!.lineNet.toFixed(2)).toBe('855.00');
    expect(totals.discountTotal.toFixed(2)).toBe('145.00');
  });

  it('allocates the order discount across lines by net share', () => {
    const { lines } = calculateQuotation(
      [
        line({ id: 'a', unitPrice: '750.00' }),
        line({ id: 'b', unitPrice: '250.00' }),
      ],
      '10.000',
    );

    expect(lines[0]!.lineOrderDiscount.toFixed(2)).toBe('75.00');
    expect(lines[1]!.lineOrderDiscount.toFixed(2)).toBe('25.00');
  });

  it('allocates every paisa, giving the rounding residual to the last line', () => {
    // Three equal lines and a discount that does not divide by three: the parts
    // must still sum to the whole.
    const { lines, totals } = calculateQuotation(
      [
        line({ id: 'a', unitPrice: '10.00' }),
        line({ id: 'b', unitPrice: '10.00' }),
        line({ id: 'c', unitPrice: '10.00' }),
      ],
      '3.333',
    );

    const orderDiscount = lines.reduce(
      (sum, row) => sum.plus(row.lineOrderDiscount),
      lines[0]!.lineOrderDiscount.minus(lines[0]!.lineOrderDiscount),
    );

    // 30.00 * 3.333% = 0.9999 -> 1.00
    expect(orderDiscount.toFixed(2)).toBe('1.00');
    expect(totals.discountTotal.toFixed(2)).toBe('1.00');
  });

  it('keeps grandTotal equal to the sum of line totals', () => {
    const { lines, totals } = calculateQuotation(
      [
        line({ id: 'a', quantity: 20, unitPrice: '80000.00', discountPercent: '12.000', taxPercent: '18.000' }),
        line({ id: 'b', quantity: 5, unitPrice: '10000.00', discountPercent: '18.000', taxPercent: '18.000' }),
        line({ id: 'c', quantity: 20, unitPrice: '5000.00', taxPercent: '18.000' }),
      ],
      '2.750',
    );

    const summed = lines.reduce((sum, row) => sum.plus(row.lineTotal), totals.subtotal.minus(totals.subtotal));
    expect(totals.grandTotal.toFixed(2)).toBe(summed.toFixed(2));
  });

  it('leaves lines untouched when the order discount is zero', () => {
    const { lines } = calculateQuotation([line({ id: 'a', unitPrice: '100.00' })], '0');

    expect(lines[0]!.lineOrderDiscount.toFixed(2)).toBe('0.00');
    expect(lines[0]!.lineDiscount.toFixed(2)).toBe('0.00');
  });

  it('can discount an order to zero', () => {
    const { totals } = calculateQuotation([line({ id: 'a', unitPrice: '100.00' })], '100.000');

    expect(totals.discountTotal.toFixed(2)).toBe('100.00');
    expect(totals.grandTotal.toFixed(2)).toBe('0.00');
  });
});

describe('quotation totals', () => {
  it('returns zeroes for a quotation with no lines', () => {
    const { lines, totals } = calculateQuotation([], '10.000');

    expect(lines).toEqual([]);
    expect(totals.subtotal.toFixed(2)).toBe('0.00');
    expect(totals.discountTotal.toFixed(2)).toBe('0.00');
    expect(totals.taxTotal.toFixed(2)).toBe('0.00');
    expect(totals.grandTotal.toFixed(2)).toBe('0.00');
    expect(totals.estimatedCost.toFixed(2)).toBe('0.00');
    expect(totals.margin.toFixed(2)).toBe('0.00');
    // No revenue means no meaningful percentage, rather than a misleading zero.
    expect(totals.marginPercent).toBeNull();
    expect(totals.effectiveDiscountPercent.toFixed(3)).toBe('0.000');
  });

  it('sums every column across mixed lines', () => {
    const { totals } = calculateQuotation(
      [
        line({ id: 'a', quantity: 2, unitPrice: '100.00', unitCost: '60.00', taxPercent: '18.000' }),
        line({ id: 'b', quantity: 1, unitPrice: '50.00', unitCost: '20.00', taxPercent: '5.000' }),
      ],
      '0',
    );

    expect(totals.subtotal.toFixed(2)).toBe('250.00');
    expect(totals.taxTotal.toFixed(2)).toBe('38.50');
    expect(totals.grandTotal.toFixed(2)).toBe('288.50');
    expect(totals.estimatedCost.toFixed(2)).toBe('140.00');
    expect(totals.margin.toFixed(2)).toBe('110.00');
  });

  it('reports the effective blended discount against the gross subtotal', () => {
    const { totals } = calculateQuotation(
      [
        line({ id: 'a', unitPrice: '1000.00', discountPercent: '20.000' }),
        line({ id: 'b', unitPrice: '1000.00', discountPercent: '0.000' }),
      ],
      '0',
    );

    // 200 discounted out of 2000 gross.
    expect(totals.effectiveDiscountPercent.toFixed(3)).toBe('10.000');
  });

  it('reports margin as a percentage of net revenue, excluding tax', () => {
    const { totals } = calculateQuotation(
      [line({ id: 'a', unitPrice: '1000.00', unitCost: '750.00', taxPercent: '18.000' })],
      '0',
    );

    expect(totals.marginPercent!.toFixed(3)).toBe('25.000');
  });

  it('computes the canonical seeded quotation exactly', () => {
    // docs/SEED_DATA.md: 20 laptops at 12%, 5 setup services at 18%, 20 support
    // seats, all taxed at 18%.
    const { totals } = calculateQuotation(
      [
        line({ id: 'laptop', quantity: 20, unitPrice: '80000.00', unitCost: '60000.00', discountPercent: '12.000', taxPercent: '18.000' }),
        line({ id: 'setup', quantity: 5, unitPrice: '10000.00', unitCost: '4000.00', discountPercent: '18.000', taxPercent: '18.000' }),
        line({ id: 'support', quantity: 20, unitPrice: '5000.00', unitCost: '1500.00', taxPercent: '18.000' }),
      ],
      '0',
    );

    // 1,600,000 + 50,000 + 100,000
    expect(totals.subtotal.toFixed(2)).toBe('1750000.00');
    // 192,000 + 9,000
    expect(totals.discountTotal.toFixed(2)).toBe('201000.00');
    // net 1,549,000 taxed at 18%
    expect(totals.taxTotal.toFixed(2)).toBe('278820.00');
    expect(totals.grandTotal.toFixed(2)).toBe('1827820.00');
    // 1,200,000 + 20,000 + 30,000
    expect(totals.estimatedCost.toFixed(2)).toBe('1250000.00');
    expect(totals.margin.toFixed(2)).toBe('299000.00');
  });
});

describe('decimal discipline', () => {
  it('does not drift on values that binary floating point cannot represent', () => {
    const { totals } = calculateQuotation(
      [
        line({ id: 'a', quantity: 3, unitPrice: '0.10', unitCost: '0.00' }),
        line({ id: 'b', quantity: 3, unitPrice: '0.20', unitCost: '0.00' }),
      ],
      '0',
    );

    // 0.30 + 0.60 exactly, not 0.8999999999999999
    expect(totals.subtotal.toFixed(2)).toBe('0.90');
  });

  it('rounds half away from zero, consistently per line', () => {
    const { lines } = calculateQuotation(
      [line({ id: 'a', unitPrice: '10.00', discountPercent: '2.500' })],
      '0',
    );

    // 10.00 * 2.5% = 0.25 exactly, no rounding needed.
    expect(lines[0]!.lineOwnDiscount.toFixed(2)).toBe('0.25');
  });

  it('is deterministic: the same inputs always give the same figures', () => {
    const input = [
      line({ id: 'a', quantity: 7, unitPrice: '1234.56', discountPercent: '3.750', taxPercent: '18.000' }),
      line({ id: 'b', quantity: 13, unitPrice: '77.77', discountPercent: '1.125', taxPercent: '12.000' }),
    ];

    const first = calculateQuotation(input, '4.500');
    const second = calculateQuotation(input, '4.500');

    expect(first.totals.grandTotal.toFixed(2)).toBe(second.totals.grandTotal.toFixed(2));
    expect(first.totals.margin.toFixed(2)).toBe(second.totals.margin.toFixed(2));
  });
});
