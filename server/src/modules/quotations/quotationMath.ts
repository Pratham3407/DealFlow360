import { Prisma } from '../../generated/prisma/client';
import { MONEY_SCALE } from '../../http/fields';

/**
 * Quotation arithmetic — the single definition of how a quotation adds up.
 *
 * Pure: plain data in, plain data out, no database access, no I/O. That makes
 * every formula exhaustively unit testable, and it means the risk engine, the
 * billing engine and any preview all read one implementation rather than
 * three that drift.
 *
 * Order of operations (docs/BUSINESS_RULES.md 6, and fixed here so no other
 * module invents a different one):
 *
 *   per line
 *     lineSubtotal     = unitPrice × quantity                       (gross)
 *     ownDiscount      = lineSubtotal × discountPercent / 100
 *     netAfterOwn      = lineSubtotal − ownDiscount
 *
 *   order-level discount, allocated across lines by net share
 *     orderShare_i     = netAfterOwn_i × orderDiscountPercent / 100
 *     netFinal_i       = netAfterOwn_i − orderShare_i
 *
 *   per line, continued
 *     lineDiscount     = ownDiscount + orderShare        (stored combined)
 *     lineTax          = netFinal × taxPercent / 100
 *     lineTotal        = netFinal + lineTax
 *     margin           = netFinal − (unitCost × quantity)
 *
 *   quotation
 *     subtotal         = Σ lineSubtotal
 *     discountTotal    = Σ lineDiscount
 *     taxTotal         = Σ lineTax
 *     grandTotal       = Σ lineTotal
 *     estimatedCost    = Σ (unitCost × quantity)
 *     margin           = (grandTotal − taxTotal) − estimatedCost
 *
 * Two consequences worth stating, because they are decisions rather than
 * arithmetic:
 *
 *   - Tax applies to the post-discount amount. An order-level trade discount
 *     reduces the taxable value; taxing before discounting would overstate tax.
 *   - Margin excludes tax. Tax is collected on behalf of the authority, not
 *     earned, so it cannot contribute to margin.
 *
 * Every figure is rounded to 2 dp per line and then summed, so Σ lineTotal
 * equals grandTotal exactly and a client can verify the arithmetic. The
 * order-discount allocation gives its rounding residual to the last line, so the
 * allocated shares sum to the order discount to the paisa.
 */

const HUNDRED = new Prisma.Decimal(100);
const ZERO = new Prisma.Decimal(0);

/** One line's commercial inputs. Snapshotted values, not catalogue lookups. */
export interface LineInput {
  id: string;
  quantity: number;
  unitPrice: Prisma.Decimal | string;
  unitCost: Prisma.Decimal | string;
  /** Percent 0-100. */
  discountPercent: Prisma.Decimal | string;
  /** Percent 0-100. */
  taxPercent: Prisma.Decimal | string;
}

export interface LineTotals {
  id: string;
  /** Gross, before any discount. */
  lineSubtotal: Prisma.Decimal;
  /** Line-level discount plus this line's share of the order-level discount. */
  lineDiscount: Prisma.Decimal;
  /** The line-level portion alone, for explanation and reporting. */
  lineOwnDiscount: Prisma.Decimal;
  /** This line's allocated share of the order-level discount. */
  lineOrderDiscount: Prisma.Decimal;
  /** Taxable value: gross less all discounts. */
  lineNet: Prisma.Decimal;
  lineTax: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  lineCost: Prisma.Decimal;
  margin: Prisma.Decimal;
}

export interface QuotationTotals {
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
  estimatedCost: Prisma.Decimal;
  margin: Prisma.Decimal;
  /** Effective blended discount as a percentage of subtotal. Zero when subtotal is zero. */
  effectiveDiscountPercent: Prisma.Decimal;
  /** Margin as a percentage of net revenue. Null when net revenue is zero. */
  marginPercent: Prisma.Decimal | null;
}

export interface CalculationResult {
  lines: LineTotals[];
  totals: QuotationTotals;
}

function money(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(MONEY_SCALE);
}

/**
 * Calculate a whole quotation.
 *
 * `orderDiscountPercent` is applied to the sum of line nets and allocated back to
 * lines proportionally, so that no line can be discounted below zero and the
 * quotation total matches the sum of its lines.
 */
export function calculateQuotation(
  lines: readonly LineInput[],
  orderDiscountPercent: Prisma.Decimal | string,
): CalculationResult {
  const orderDiscount = new Prisma.Decimal(orderDiscountPercent);

  // Pass 1: gross, own discount, net before the order-level discount.
  const stage = lines.map((line) => {
    const quantity = new Prisma.Decimal(line.quantity);
    const unitPrice = new Prisma.Decimal(line.unitPrice);
    const unitCost = new Prisma.Decimal(line.unitCost);

    const lineSubtotal = money(unitPrice.times(quantity));
    const ownDiscount = money(lineSubtotal.times(new Prisma.Decimal(line.discountPercent)).dividedBy(HUNDRED));

    return {
      id: line.id,
      taxPercent: new Prisma.Decimal(line.taxPercent),
      lineSubtotal,
      ownDiscount,
      netAfterOwn: lineSubtotal.minus(ownDiscount),
      lineCost: money(unitCost.times(quantity)),
    };
  });

  const netBeforeOrderDiscount = stage.reduce((sum, line) => sum.plus(line.netAfterOwn), ZERO);
  const orderDiscountAmount = money(netBeforeOrderDiscount.times(orderDiscount).dividedBy(HUNDRED));

  // Pass 2: allocate the order-level discount by net share. The last line absorbs
  // the rounding residual so the parts sum to the whole exactly.
  let allocated = ZERO;
  const shares = stage.map((line, index) => {
    if (orderDiscountAmount.isZero() || netBeforeOrderDiscount.isZero()) return ZERO;

    if (index === stage.length - 1) return orderDiscountAmount.minus(allocated);

    const share = money(orderDiscountAmount.times(line.netAfterOwn).dividedBy(netBeforeOrderDiscount));
    allocated = allocated.plus(share);
    return share;
  });

  // Pass 3: tax, total and margin on the fully discounted net.
  const resultLines: LineTotals[] = stage.map((line, index) => {
    const orderShare = shares[index] ?? ZERO;
    const lineNet = line.netAfterOwn.minus(orderShare);
    const lineTax = money(lineNet.times(line.taxPercent).dividedBy(HUNDRED));

    return {
      id: line.id,
      lineSubtotal: line.lineSubtotal,
      lineDiscount: line.ownDiscount.plus(orderShare),
      lineOwnDiscount: line.ownDiscount,
      lineOrderDiscount: orderShare,
      lineNet,
      lineTax,
      lineTotal: lineNet.plus(lineTax),
      lineCost: line.lineCost,
      margin: lineNet.minus(line.lineCost),
    };
  });

  const subtotal = resultLines.reduce((sum, line) => sum.plus(line.lineSubtotal), ZERO);
  const discountTotal = resultLines.reduce((sum, line) => sum.plus(line.lineDiscount), ZERO);
  const taxTotal = resultLines.reduce((sum, line) => sum.plus(line.lineTax), ZERO);
  const grandTotal = resultLines.reduce((sum, line) => sum.plus(line.lineTotal), ZERO);
  const estimatedCost = resultLines.reduce((sum, line) => sum.plus(line.lineCost), ZERO);
  const netRevenue = grandTotal.minus(taxTotal);

  return {
    lines: resultLines,
    totals: {
      subtotal: money(subtotal),
      discountTotal: money(discountTotal),
      taxTotal: money(taxTotal),
      grandTotal: money(grandTotal),
      estimatedCost: money(estimatedCost),
      margin: money(netRevenue.minus(estimatedCost)),
      effectiveDiscountPercent: subtotal.isZero()
        ? ZERO
        : discountTotal.dividedBy(subtotal).times(HUNDRED).toDecimalPlaces(3),
      marginPercent: netRevenue.isZero()
        ? null
        : netRevenue.minus(estimatedCost).dividedBy(netRevenue).times(HUNDRED).toDecimalPlaces(3),
    },
  };
}

/**
 * Fields whose change is a material commercial change.
 *
 * A material change bumps `Quotation.version`, which invalidates any approval
 * tied to the previous version (AGENTS.md §11). Notes and validity dates are
 * deliberately absent: they do not alter what is being sold or for how much.
 */
export const MATERIAL_LINE_FIELDS = [
  'productId',
  'variantId',
  'quantity',
  'unitPrice',
  'unitCost',
  'discountPercent',
  'taxPercent',
] as const;

export const MATERIAL_QUOTATION_FIELDS = ['customerId', 'orderDiscountPercent'] as const;
