/**
 * PDF and spreadsheet export.
 *
 * The PDF path had two geometry defects that made wide reports unreadable: column
 * widths were floored at 60pt and then had gutters added, so a seven-column report
 * ran past the right margin and cells printed over their neighbours; and every row
 * advanced a fixed 14pt, so any wrapped value was overwritten by the row below.
 *
 * These tests assert the geometry rather than eyeballing the output — every text
 * op must sit inside the printable area, and no two baselines may be closer than
 * a line of type.
 */

import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { exportReportPdf, exportReportXls } from '../src/domain/reporting/reporting.service.js';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 36;
const RIGHT_EDGE = A4_WIDTH - MARGIN;

interface TextOp {
  x: number;
  /** Distance from the top of the page, which is how the renderer positions text. */
  y: number;
  size: number;
  text: string;
}

/**
 * Pull positioned text out of a PDF's content stream.
 *
 * pdfkit writes each cell as `1 0 0 1 <x> <y> Tm` followed by a hex-encoded `TJ`,
 * inside a flipped coordinate system, so `y` is converted back to top-down.
 */
function textOps(pdf: Buffer): TextOp[] {
  const raw = pdf.toString('latin1');
  const ops: TextOp[] = [];

  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string;
    try {
      body = zlib.inflateSync(Buffer.from(match[1]!, 'latin1')).toString('latin1');
    } catch {
      continue;
    }

    let x: number | null = null;
    let y: number | null = null;
    let size = 0;

    for (const line of body.split('\n')) {
      const tm = /^1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm$/.exec(line.trim());
      if (tm) {
        x = Number(tm[1]);
        y = A4_HEIGHT - Number(tm[2]);
        continue;
      }
      const tf = /^\/F\d+ ([\d.]+) Tf$/.exec(line.trim());
      if (tf) {
        size = Number(tf[1]);
        continue;
      }
      if (line.startsWith('[<') && line.trimEnd().endsWith('TJ') && x !== null && y !== null) {
        const text = [...line.matchAll(/<([0-9a-fA-F]+)>/g)]
          .map((h) => Buffer.from(h[1]!, 'hex').toString('latin1'))
          .join('');
        ops.push({ x, y, size, text });
      }
    }
  }

  return ops;
}

const WIDE_COLUMNS = [
  { key: 'quoteNumber', label: 'Quote' },
  { key: 'customer', label: 'Customer' },
  { key: 'salesRep', label: 'Sales rep' },
  { key: 'status', label: 'Status' },
  { key: 'grandTotalPaise', label: 'Total (paise)' },
  { key: 'marginBp', label: 'Margin (bp)' },
  { key: 'riskScoreBp', label: 'Risk (bp)' },
];

const WIDE_ROWS = Array.from({ length: 12 }, (_, i) => ({
  quoteNumber: `Q${String(i + 1).padStart(4, '0')}`,
  customer: i % 3 === 0 ? 'Acme Corporation International Holdings Limited' : 'Northwind Traders',
  salesRep: 'Sales Rep',
  status: i % 2 === 0 ? 'PENDING_APPROVAL' : 'UNDER_NEGOTIATION',
  grandTotalPaise: 178_628_400 + i * 1_000,
  marginBp: 1_653,
  riskScoreBp: 742,
}));

describe('PDF export geometry', () => {
  it('keeps every cell inside the printable width', async () => {
    const pdf = await exportReportPdf(WIDE_COLUMNS, WIDE_ROWS, 'Quotation Pipeline');
    const ops = textOps(pdf);
    expect(ops.length).toBeGreaterThan(0);

    for (const op of ops) {
      expect(op.x).toBeGreaterThanOrEqual(MARGIN - 1);
      expect(op.x).toBeLessThanOrEqual(RIGHT_EDGE);
      /*
       * Helvetica averages roughly 0.5em per glyph across mixed-case text, so
       * 0.52 is a close upper bound without needing the font metrics. It is
       * tight enough to catch a column that has run off the page — the defect
       * here was tens of points of overflow, not fractions.
       */
      const estimatedRight = op.x + op.text.length * op.size * 0.52;
      expect(estimatedRight).toBeLessThanOrEqual(RIGHT_EDGE + 2);
    }
  });

  it('never places two baselines closer together than a line of type', async () => {
    const pdf = await exportReportPdf(WIDE_COLUMNS, WIDE_ROWS, 'Quotation Pipeline');
    const ops = textOps(pdf);

    const baselines = [...new Set(ops.map((o) => Math.round(o.y * 100) / 100))].sort((a, b) => a - b);
    const smallestFont = Math.min(...ops.map((o) => o.size));

    for (const [a, b] of baselines.slice(0, -1).map((v, i) => [v, baselines[i + 1]!] as const)) {
      const gap = b - a;
      // A gap smaller than the font size means the two rows are drawing over
      // each other, which is exactly the overlap this replaced.
      expect(gap).toBeGreaterThanOrEqual(smallestFont - 0.5);
    }
  });

  it('wraps a long value onto its own lines without colliding with the next row', async () => {
    const columns = [
      { key: 'name', label: 'Name' },
      { key: 'note', label: 'Note' },
    ];
    const rows = [
      { name: 'First', note: 'A deliberately long note that has to wrap across several lines inside a narrow column to prove the row grows.' },
      { name: 'Second', note: 'Short.' },
    ];

    const pdf = await exportReportPdf(columns, rows, 'Wrapping');
    const ops = textOps(pdf);

    const firstRow = ops.find((o) => o.text.startsWith('First'));
    const secondRow = ops.find((o) => o.text.startsWith('Second'));
    expect(firstRow).toBeDefined();
    expect(secondRow).toBeDefined();

    // The wrapped note occupies more than one line, so the following row must be
    // pushed well past a single line height rather than a fixed 14pt.
    expect(secondRow!.y - firstRow!.y).toBeGreaterThan(firstRow!.size * 2);
  });

  it('paginates and repeats the header rather than running off the page', async () => {
    const many = Array.from({ length: 90 }, (_, i) => ({ ...WIDE_ROWS[0]!, quoteNumber: `Q${i}` }));
    const pdf = await exportReportPdf(WIDE_COLUMNS, many, 'Long Report');

    const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pageCount).toBeGreaterThan(1);

    const ops = textOps(pdf);
    // Header label appears once per page.
    const headerHits = ops.filter((o) => o.text === 'Customer').length;
    expect(headerHits).toBe(pageCount);

    for (const op of ops) {
      expect(op.y).toBeLessThanOrEqual(A4_HEIGHT - MARGIN + 1);
    }
  });

  it('renders an empty result set without throwing', async () => {
    const pdf = await exportReportPdf(WIDE_COLUMNS, [], 'Empty');
    expect(pdf.byteLength).toBeGreaterThan(0);
    const ops = textOps(pdf);
    expect(ops.some((o) => o.text.includes('No rows'))).toBe(true);
  });

  it('formats paise and basis points for a human reader', async () => {
    const pdf = await exportReportPdf(
      [
        { key: 'grandTotalPaise', label: 'Total (paise)' },
        { key: 'marginBp', label: 'Margin (bp)' },
      ],
      [{ grandTotalPaise: 12_345_600, marginBp: 1_653 }],
      'Formatting',
    );
    const text = textOps(pdf).map((o) => o.text).join(' ');
    // 12,345,600 paise is ₹123,456.00, grouped the Indian way by the en-IN
    // locale the rest of the app formats with; 1653bp is 16.53%.
    expect(text).toContain('1,23,456.00');
    expect(text).toContain('16.53%');
  });
});

describe('XLS export', () => {
  it('produces a workbook rather than failing on the CommonJS interop', async () => {
    // Regression guard: `await import('exceljs')` puts the constructor on the
    // interop default, and reading it off the namespace threw at runtime.
    const buffer = await exportReportXls(WIDE_COLUMNS, WIDE_ROWS, 'report-pipeline');
    expect(buffer.byteLength).toBeGreaterThan(0);
    // XLSX is a zip; the local file header is the signature.
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  });
});
