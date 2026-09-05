/**
 * Reporting (PRD §19).
 *
 * Aggregate views over quotations and approvals are plain SQL sums here; the
 * money discipline of the rest of the platform carries over (integer paise, all
 * totals derived from already-persisted line math, never recomputed float).
 *
 * PDF and XLS export are streamed from the same row data the JSON endpoints
 * return, so the UI and the export can never disagree about a number.
 */

import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import {
  approvalInstances,
  inventory,
  products,
  quotationLines,
  quotations,
  users,
  warehouses,
} from '@/db/schema/index.js';
import type { DbExecutor } from '@/db/client.js';
import type { QuotationStatus } from '@dealflow/shared';

export interface ReportRange {
  from?: Date;
  to?: Date;
  customerId?: string;
  salesRepId?: string;
  status?: QuotationStatus;
}

function rangeWhere(table: typeof quotations, f: ReportRange) {
  return and(
    f.from ? gte(table.createdAt, f.from) : undefined,
    f.to ? lte(table.createdAt, f.to) : undefined,
    f.customerId ? eq(table.customerId, f.customerId) : undefined,
    f.salesRepId ? eq(table.salesRepId, f.salesRepId) : undefined,
    f.status ? eq(table.status, f.status) : undefined,
  );
}

export async function reportPipeline(exec: DbExecutor, f: ReportRange = {}) {
  const rows = await exec
    .select({
      quote: quotations,
      customerName: sql<string>`coalesce(c.name, '')`,
      customerCode: sql<string>`coalesce(c.code, '')`,
      salesRepName: sql<string>`coalesce(u.name, 'Unassigned')`,
    })
    .from(quotations)
    .leftJoin(sql`customers c`, sql`c.id = ${quotations.customerId}`)
    .leftJoin(sql`users u`, sql`u.id = ${quotations.salesRepId}`)
    .where(rangeWhere(quotations, f))
    .orderBy(desc(quotations.createdAt));

  const lineCounts = await exec
    .select({ quotationId: quotationLines.quotationId, count: sql<number>`count(*)` })
    .from(quotationLines)
    .groupBy(quotationLines.quotationId);
  const lineCountByQuote = new Map(lineCounts.map((l) => [l.quotationId, Number(l.count)]));

  return rows.map(({ quote, customerName, customerCode, salesRepName }) => ({
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    customer: customerName,
    customerCode,
    salesRep: salesRepName,
    status: quote.status,
    version: quote.version,
    grandTotalPaise: quote.grandTotalPaise,
    discountTotalPaise: quote.discountTotalPaise,
    estimatedCostPaise: quote.estimatedCostPaise ?? 0,
    marginPaise: quote.grandTotalPaise - (quote.estimatedCostPaise ?? 0),
    marginBp:
      quote.grandTotalPaise > 0
        ? Math.round(((quote.grandTotalPaise - (quote.estimatedCostPaise ?? 0)) / quote.grandTotalPaise) * 10_000)
        : 0,
    riskScoreBp: quote.riskScoreBp,
    lines: lineCountByQuote.get(quote.id) ?? 0,
    createdAt: quote.createdAt,
    sentAt: quote.sentAt,
    confirmedAt: quote.confirmedAt,
    approvedAt: quote.approvedAt,
  }));
}

export async function reportSales(exec: DbExecutor, f: ReportRange = {}) {
  const rows = await exec
    .select({
      salesRepId: quotations.salesRepId,
      salesRepName: users.name,
      count: sql<number>`count(*)`,
      netTotal: sql<number>`coalesce(sum(${quotations.grandTotalPaise}), 0)`,
      discountTotal: sql<number>`coalesce(sum(${quotations.discountTotalPaise}), 0)`,
      costTotal: sql<number>`coalesce(sum(${quotations.estimatedCostPaise}), 0)`,
    })
    .from(quotations)
    .leftJoin(users, eq(users.id, quotations.salesRepId))
    .where(rangeWhere(quotations, f))
    .groupBy(quotations.salesRepId, users.name)
    .orderBy(desc(sql`coalesce(sum(${quotations.grandTotalPaise}), 0)`));

  return rows.map((row) => ({
    salesRepId: row.salesRepId,
    salesRepName: row.salesRepName ?? 'Unassigned',
    count: Number(row.count),
    netTotalPaise: Number(row.netTotal),
    discountTotalPaise: Number(row.discountTotal),
    costTotalPaise: Number(row.costTotal ?? 0),
    marginPaise: Number(row.netTotal) - Number(row.costTotal ?? 0),
  }));
}

export async function reportApprovals(exec: DbExecutor, f: ReportRange = {}) {
  const rows = await exec
    .select({
      quoteId: approvalInstances.quotationId,
      quoteNumber: quotations.quoteNumber,
      level: approvalInstances.level,
      status: approvalInstances.status,
      count: sql<number>`count(*)`,
      riskScoreBp: sql<number>`max(${approvalInstances.riskScoreBp})`,
    })
    .from(approvalInstances)
    .innerJoin(quotations, eq(quotations.id, approvalInstances.quotationId))
    .where(rangeWhere(quotations, f))
    .groupBy(approvalInstances.quotationId, quotations.quoteNumber, approvalInstances.level, approvalInstances.status)
    .orderBy(desc(sql`count(*)`));

  return rows.map((row) => ({ ...row, count: Number(row.count), riskScoreBp: Number(row.riskScoreBp) }));
}

export async function reportProducts(exec: DbExecutor, f: ReportRange = {}) {
  const where = rangeWhere(quotations, f);
  const rows = await exec
    .select({
      productId: quotationLines.productId,
      productName: quotationLines.productName,
      productSku: quotationLines.productSku,
      categoryName: quotationLines.categoryName,
      units: sql<number>`sum(${quotationLines.quantity})`,
      netTotal: sql<number>`sum(${quotationLines.netAmountPaise})`,
      discountTotal: sql<number>`sum(${quotationLines.discountAmountPaise} + ${quotationLines.orderDiscountAmountPaise})`,
      lineCount: sql<number>`count(*)`,
    })
    .from(quotationLines)
    .innerJoin(quotations, eq(quotations.id, quotationLines.quotationId))
    .where(where ?? undefined)
    .groupBy(quotationLines.productId, quotationLines.productName, quotationLines.productSku, quotationLines.categoryName)
    .orderBy(desc(sql`sum(${quotationLines.netAmountPaise})`));

  return rows.map((row) => ({
    ...row,
    units: Number(row.units),
    netTotalPaise: Number(row.netTotal),
    discountTotalPaise: Number(row.discountTotal),
    lineCount: Number(row.lineCount),
  }));
}

/**
 * Stock on hand per product per warehouse.
 *
 * Joined to names rather than returning bare ids: this report is exported to
 * spreadsheets that people read, and a grid of UUIDs is not a report.
 */
export async function reportInventory(exec: DbExecutor) {
  const rows = await exec
    .select({
      productId: inventory.productId,
      productName: products.name,
      productSku: products.sku,
      warehouseId: inventory.warehouseId,
      warehouseName: warehouses.name,
      warehouseCode: warehouses.code,
      availableQuantity: inventory.availableQuantity,
      reservedQuantity: inventory.reservedQuantity,
      reorderPoint: inventory.reorderPoint,
    })
    .from(inventory)
    .innerJoin(products, eq(products.id, inventory.productId))
    .innerJoin(warehouses, eq(warehouses.id, inventory.warehouseId))
    .orderBy(asc(products.name), asc(warehouses.name));

  return rows.map((row) => ({
    ...row,
    belowReorderPoint: row.availableQuantity <= row.reorderPoint,
  }));
}

export async function exportReportXls<T extends Record<string, unknown>>(columns: { key: string; label: string }[], rows: T[], title: string): Promise<Buffer> {
  // exceljs is CommonJS, so the constructor lives on the interop default rather
  // than on the namespace — same shape as the pdfkit import below.
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(title);

  sheet.addRow([title]);
  sheet.addRow(columns.map((c) => c.label));
  for (const row of rows) {
    sheet.addRow(columns.map((c) => row[c.key] ?? ''));
  }
  sheet.views = [{ state: 'frozen', ySplit: 2 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Render a report as a paginated PDF table.
 *
 * The previous implementation overlapped its own text for two reasons, both
 * fixed here. Column widths were computed with a `Math.max(60, …)` floor and then
 * had a per-column gutter added on top, so once a report had more than about
 * eight columns the row was wider than the page and cells printed over their
 * neighbours. And every row advanced a fixed 14pt regardless of content, so any
 * value that wrapped to a second line was written over by the row beneath it.
 *
 * Widths are now proportional to the printable area with the gutters subtracted
 * first, and each cell is measured with `heightOfString` so the row advances by
 * whatever its tallest cell actually needs.
 */
export async function exportReportPdf<T extends Record<string, unknown>>(
  columns: { key: string; label: string }[],
  rows: T[],
  title: string,
): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;

  const MARGIN = 36;
  const PAGE_WIDTH = 595.28; // A4 portrait
  const PAGE_HEIGHT = 841.89;
  const GUTTER = 8;
  const FONT_SIZE = 8.5;
  const LINE_GAP = 2;
  const CELL_PAD = 4;

  const printable = PAGE_WIDTH - MARGIN * 2;
  const usable = printable - GUTTER * Math.max(0, columns.length - 1);

  /**
   * Weight the columns rather than dividing evenly: an identifier or a name needs
   * the room, a count does not, and an even split is what forced the old floor.
   */
  const weightFor = (col: { key: string; label: string }): number => {
    const key = col.key.toLowerCase();
    if (key.includes('name') || key.includes('customer') || key.includes('product')) return 2.2;
    if (key.includes('sku') || key.includes('number') || key.includes('quote')) return 1.5;
    if (key.includes('status') || key.includes('level') || key.includes('category')) return 1.3;
    return 1;
  };
  const weights = columns.map(weightFor);
  const weightTotal = weights.reduce((a, b) => a + b, 0);
  const colWidths = weights.map((w) => Math.floor((usable * w) / weightTotal));

  const colX: number[] = [];
  let cursor = MARGIN;
  for (const width of colWidths) {
    colX.push(cursor);
    cursor += width + GUTTER;
  }

  /** Right-align anything that is a magnitude, so columns of digits line up. */
  const isNumeric = (key: string, value: unknown): boolean => {
    if (typeof value === 'number') return true;
    const k = key.toLowerCase();
    return k.endsWith('paise') || k.endsWith('bp') || k === 'count' || k === 'units' || k === 'quantity';
  };

  /** Paise and basis points are stored as integers; print them as people read them. */
  const formatCell = (key: string, value: unknown): string => {
    if (value === null || value === undefined) return '—';
    const k = key.toLowerCase();
    if (typeof value === 'number' && k.endsWith('paise')) {
      return (value / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (typeof value === 'number' && k.endsWith('bp')) return `${(value / 100).toFixed(2)}%`;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  };

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const bottomLimit = PAGE_HEIGHT - MARGIN;
    let y = MARGIN;

    const drawTitle = () => {
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000');
      doc.text(title, MARGIN, y, { width: printable, align: 'left' });
      y = doc.y + 2;
      doc.font('Helvetica').fontSize(7.5).fillColor('#666666');
      doc.text(`${rows.length} row${rows.length === 1 ? '' : 's'} · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, MARGIN, y, { width: printable });
      y = doc.y + 8;
    };

    const drawHeader = () => {
      doc.font('Helvetica-Bold').fontSize(FONT_SIZE).fillColor('#000000');
      const heights = columns.map((col, i) =>
        doc.heightOfString(col.label, { width: colWidths[i]! - CELL_PAD, lineGap: LINE_GAP }),
      );
      const rowHeight = Math.max(...heights);

      columns.forEach((col, i) => {
        doc.text(col.label, colX[i]!, y, {
          width: colWidths[i]! - CELL_PAD,
          lineGap: LINE_GAP,
          align: isNumeric(col.key, undefined) ? 'right' : 'left',
        });
      });

      y += rowHeight + 4;
      doc.moveTo(MARGIN, y).lineTo(MARGIN + printable, y).lineWidth(0.8).strokeColor('#333333').stroke();
      y += 5;
      doc.font('Helvetica').fillColor('#000000');
    };

    drawTitle();
    drawHeader();

    if (rows.length === 0) {
      doc.font('Helvetica-Oblique').fontSize(9).fillColor('#666666');
      doc.text('No rows matched the selected filters.', MARGIN, y, { width: printable });
      doc.end();
      return;
    }

    rows.forEach((row, rowIndex) => {
      const cells = columns.map((col, i) => {
        const raw = formatCell(col.key, row[col.key]);
        return {
          text: raw,
          width: colWidths[i]! - CELL_PAD,
          x: colX[i]!,
          align: (isNumeric(col.key, row[col.key]) ? 'right' : 'left') as 'left' | 'right',
        };
      });

      doc.font('Helvetica').fontSize(FONT_SIZE);
      // Measure before drawing: the row is as tall as its tallest wrapped cell.
      const rowHeight = Math.max(
        ...cells.map((c) => doc.heightOfString(c.text, { width: c.width, lineGap: LINE_GAP })),
      );

      if (y + rowHeight > bottomLimit) {
        doc.addPage();
        y = MARGIN;
        drawHeader();
      }

      // Zebra banding makes a wide table readable without vertical rules.
      if (rowIndex % 2 === 1) {
        doc.rect(MARGIN - 2, y - 2, printable + 4, rowHeight + 3).fillColor('#f2f4f7').fill();
      }

      doc.fillColor('#000000').font('Helvetica').fontSize(FONT_SIZE);
      for (const cell of cells) {
        doc.text(cell.text, cell.x, y, { width: cell.width, lineGap: LINE_GAP, align: cell.align });
      }

      y += rowHeight + 3;
    });

    doc.end();
  });
}