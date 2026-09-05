/**
 * Deal-health + reporting routes.
 *
 * Report rows are produced by the reporting service and rendered to PDF/XLS by the
 * same column definitions the JSON endpoints expose, so an export can never drift
 * from what the screen showed.
 */

import { Router } from 'express';
import { db } from '../db/client.js';
import {
  escalateEvent,
  listHealthEvents,
  nudgeEvent,
  runDealHealthSweep,
} from '../domain/dealhealth/deal-health.service.js';
import {
  exportReportPdf,
  exportReportXls,
  reportApprovals,
  reportInventory,
  reportPipeline,
  reportProducts,
  reportSales,
} from '../domain/reporting/reporting.service.js';
import { toAsync, actorFromRequest } from '../middleware/auth.js';
import { internalOnly, optionalDate, optionalString } from './helpers.js';

export const dealHealthRouter = Router();

dealHealthRouter.get('/', internalOnly(), toAsync(async (req, res) => {
  const rows = await listHealthEvents(db, {
    type: optionalString(req.query.type) as never,
    openOnly: req.query.openOnly === 'true',
  });
  res.json({ data: rows });
}));

dealHealthRouter.post('/sweep', internalOnly('SALES_MANAGER', 'ADMIN'), toAsync(async (req, res) => {
  const events = await db.transaction((tx) => runDealHealthSweep(tx, actorFromRequest(req)));
  res.json({ events });
}));

dealHealthRouter.get('/:id', internalOnly(), toAsync(async (req, res) => {
  const event = await db.query.dealHealthEvents.findFirst({
    where: (table, { eq }) => eq(table.id, String(req.params.id)),
    with: { quotation: true },
  });
  if (!event) {
    res.status(404).json({ error: { code: 'EVENT_NOT_FOUND', message: 'Deal-health event not found', details: {} } });
    return;
  }
  res.json({ event });
}));

dealHealthRouter.post(
  '/:id/nudge',
  internalOnly('SALES_REP', 'SALES_MANAGER', 'ADMIN'),
  toAsync(async (req, res) => {
    const event = await db.transaction((tx) =>
      nudgeEvent(tx, String(req.params.id), actorFromRequest(req)),
    );
    res.json({ event });
  }),
);

dealHealthRouter.post(
  '/:id/escalate',
  internalOnly('SALES_MANAGER', 'ADMIN'),
  toAsync(async (req, res) => {
    const event = await db.transaction((tx) =>
      escalateEvent(tx, String(req.params.id), actorFromRequest(req)),
    );
    res.json({ event });
  }),
);

export const reportingRouter = Router();

const rangeFromQuery = (req: { query: Record<string, unknown> }) => ({
  from: optionalDate(req.query.from),
  to: optionalDate(req.query.to),
  customerId: optionalString(req.query.customerId),
  salesRepId: optionalString(req.query.salesRepId),
  status: optionalString(req.query.status) as never,
});

interface ReportColumn {
  key: string;
  label: string;
}

const REPORT_COLUMNS: Record<string, ReportColumn[]> = {
  pipeline: [
    { key: 'quoteNumber', label: 'Quote' },
    { key: 'customer', label: 'Customer' },
    { key: 'salesRep', label: 'Sales rep' },
    { key: 'status', label: 'Status' },
    { key: 'grandTotalPaise', label: 'Total (paise)' },
    { key: 'marginBp', label: 'Margin (bp)' },
    { key: 'riskScoreBp', label: 'Risk (bp)' },
  ],
  sales: [
    { key: 'salesRepName', label: 'Sales rep' },
    { key: 'count', label: 'Quotes' },
    { key: 'netTotalPaise', label: 'Net (paise)' },
    { key: 'discountTotalPaise', label: 'Discount (paise)' },
    { key: 'marginPaise', label: 'Margin (paise)' },
  ],
  approvals: [
    { key: 'quoteNumber', label: 'Quote' },
    { key: 'level', label: 'Level' },
    { key: 'status', label: 'Status' },
    { key: 'count', label: 'Count' },
    { key: 'riskScoreBp', label: 'Risk (bp)' },
  ],
  products: [
    { key: 'productSku', label: 'SKU' },
    { key: 'productName', label: 'Product' },
    { key: 'categoryName', label: 'Category' },
    { key: 'units', label: 'Units' },
    { key: 'netTotalPaise', label: 'Net (paise)' },
  ],
  inventory: [
    { key: 'productName', label: 'Product' },
    { key: 'warehouseName', label: 'Warehouse' },
    { key: 'availableQuantity', label: 'Available' },
    { key: 'reservedQuantity', label: 'Reserved' },
    { key: 'reorderPoint', label: 'Reorder point' },
  ],
};

/** Human headings for the exported file, rather than the raw report key. */
const REPORT_TITLES: Record<string, string> = {
  pipeline: 'Quotation Pipeline',
  sales: 'Sales by Representative',
  approvals: 'Approval Activity',
  products: 'Product Performance',
  inventory: 'Inventory Position',
};

async function loadReport(report: string, req: Parameters<typeof rangeFromQuery>[0]) {  switch (report) {
    case 'inventory':
      return reportInventory(db);
    case 'approvals':
      return reportApprovals(db);
    case 'sales':
      return reportSales(db, rangeFromQuery(req));
    case 'products':
      return reportProducts(db, rangeFromQuery(req));
    case 'pipeline':
    case 'quotations':
      return reportPipeline(db, rangeFromQuery(req));
    default:
      return null;
  }
}

/** `quotations` is the name API_SPEC.md uses; `pipeline` is the internal alias. */
reportingRouter.get(['/quotations', '/pipeline'], internalOnly(), toAsync(async (req, res) => {
  res.json({ data: await reportPipeline(db, rangeFromQuery(req)) });
}));

reportingRouter.get('/sales', internalOnly(), toAsync(async (req, res) => {
  res.json({ data: await reportSales(db, rangeFromQuery(req)) });
}));

reportingRouter.get('/approvals', internalOnly(), toAsync(async (_req, res) => {
  res.json({ data: await reportApprovals(db) });
}));

reportingRouter.get('/products', internalOnly(), toAsync(async (req, res) => {
  res.json({ data: await reportProducts(db, rangeFromQuery(req)) });
}));

reportingRouter.get('/inventory', internalOnly(), toAsync(async (_req, res) => {
  res.json({ data: await reportInventory(db) });
}));

reportingRouter.get('/export', internalOnly(), toAsync(async (req, res) => {
  const report = String(req.query.report ?? 'quotations');
  const format = String(req.query.format ?? 'xls');

  if (format !== 'pdf' && format !== 'xls') {
    res.status(400).json({ error: { code: 'FORMAT_UNKNOWN', message: 'format must be pdf or xls', details: {} } });
    return;
  }

  const columns = REPORT_COLUMNS[report === 'quotations' ? 'pipeline' : report];
  const rows = columns ? await loadReport(report, req) : null;
  if (!columns || !rows) {
    res.status(400).json({
      error: {
        code: 'REPORT_UNKNOWN',
        message: `Unknown report "${report}"`,
        details: { available: Object.keys(REPORT_COLUMNS) },
      },
    });
    return;
  }

  const filename = `report-${report}-${new Date().toISOString().slice(0, 10)}.${format}`;
  const heading = REPORT_TITLES[report === 'quotations' ? 'pipeline' : report] ?? report;
  const buffer =
    format === 'pdf'
      ? await exportReportPdf(columns, rows as Record<string, unknown>[], heading)
      : await exportReportXls(columns, rows as Record<string, unknown>[], `report-${report}`);

  res.setHeader(
    'Content-Type',
    format === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}));