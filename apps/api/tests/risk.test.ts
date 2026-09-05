/**
 * AT-03 – AT-05: the pricing ceilings and the risk engine.
 *
 * Every case is built from the seeded Gold/Acme fixture (SEED_DATA.md): Hardware
 * ceiling 15%, Services 10%, Subscriptions 15%, with approval bands at
 * 0–499bp NONE, 500–2499bp MANAGER, 2500+ MANAGER_FINANCE.
 *
 * Assertions are on the *engine's* published outputs — `effectiveCeilingBp`,
 * `violationBp`, `riskScoreBp`, `requiredApprovalLevel` — rather than on
 * hand-recomputed arithmetic, because the point of these tests is that the
 * ceiling resolution and the risk classification agree with the documented
 * policy, not that a formula was retyped correctly in the test.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, resetDatabase, sessionAs, type SeedResult, type Session } from './helpers/db.js';

const PERCENT = 100;
const pct = (n: number) => n * PERCENT;

let seeded: SeedResult;
let rep: Session;

beforeAll(async () => {
  seeded = await resetDatabase();
  rep = await sessionAs('rep@dealflow.local', DEMO_PASSWORD);
});

/** A fresh empty draft for Acme (Gold tier), so cases never contaminate each other. */
async function newAcmeDraft(): Promise<string> {
  const res = await rep.post('/api/quotations').send({ customerId: seeded.customers.acme.id });
  expect(res.status).toBe(201);
  return res.body.quote.id as string;
}

interface LineView {
  id: string;
  productName: string;
  discountBp: number;
  effectiveCeilingBp: number;
  violationBp: number;
}

interface QuoteView {
  id: string;
  status: string;
  version: number;
  riskScoreBp: number;
  requiredApprovalLevel: string;
  grandTotalPaise: number;
  marginBp: number;
  lines: LineView[];
}

async function readQuote(id: string): Promise<QuoteView> {
  const res = await rep.get(`/api/quotations/${id}`);
  expect(res.status).toBe(200);
  return res.body.quote as QuoteView;
}

async function addLine(
  quoteId: string,
  body: { productId: string; quantity: number; discountBp?: number },
): Promise<void> {
  const res = await rep.post(`/api/quotations/${quoteId}/lines`).send(body);
  expect(res.status).toBe(201);
}

describe('AT-03 discount within the tier ceiling', () => {
  it('accepts 12% on Hardware for a Gold customer with no violation and no approval', async () => {
    const quoteId = await newAcmeDraft();
    await addLine(quoteId, {
      productId: seeded.products.laptop.id,
      quantity: 20,
      discountBp: pct(12),
    });

    const quote = await readQuote(quoteId);
    const line = quote.lines[0];

    expect(line).toBeDefined();
    // The Gold–Hardware rule is the most specific match, so 15% is the ceiling.
    expect(line!.effectiveCeilingBp).toBe(pct(15));
    expect(line!.discountBp).toBe(pct(12));
    expect(line!.violationBp).toBe(0);

    // No breach anywhere means the engine has nothing to escalate.
    expect(quote.riskScoreBp).toBe(0);
    expect(quote.requiredApprovalLevel).toBe('NONE');
  });

  it('treats a discount exactly at the ceiling as compliant', async () => {
    const quoteId = await newAcmeDraft();
    await addLine(quoteId, {
      productId: seeded.products.laptop.id,
      quantity: 5,
      discountBp: pct(15),
    });

    const quote = await readQuote(quoteId);
    // Boundary case: the ceiling is inclusive, so 15% of 15% is not a breach.
    expect(quote.lines[0]!.violationBp).toBe(0);
    expect(quote.requiredApprovalLevel).toBe('NONE');
  });

  it('submits straight to APPROVED when nothing breaches', async () => {
    const quoteId = await newAcmeDraft();
    await addLine(quoteId, {
      productId: seeded.products.laptop.id,
      quantity: 3,
      discountBp: pct(10),
    });

    const submit = await rep.post(`/api/quotations/${quoteId}/confirm`).send({});
    expect(submit.status).toBe(200);
    // requiredLevel NONE is an engine decision, not a bypass — the quote is
    // approved without a rung being created.
    expect(submit.body.quote.status).toBe('APPROVED');

    const approvals = await rep.get(`/api/approvals?quotationId=${quoteId}&onlyPending=false`);
    expect(approvals.body.data).toHaveLength(0);
  });
});

describe('AT-04 discount over the category ceiling', () => {
  it('flags an 18% service discount as an 8-point violation and requires Manager approval', async () => {
    const quoteId = await newAcmeDraft();
    // A large compliant hardware line so the breaching line is a minority of value.
    await addLine(quoteId, {
      productId: seeded.products.laptop.id,
      quantity: 20,
      discountBp: pct(12),
    });
    await addLine(quoteId, {
      productId: seeded.products.setup.id,
      quantity: 5,
      discountBp: pct(18),
    });

    const quote = await readQuote(quoteId);
    const service = quote.lines.find((l) => l.productName === seeded.products.setup.name);
    const hardware = quote.lines.find((l) => l.productName === seeded.products.laptop.name);

    expect(service).toBeDefined();
    // Gold–Services caps at 10%, which is stricter than the 12% global services
    // backstop; the strictest applicable ceiling must win.
    expect(service!.effectiveCeilingBp).toBe(pct(10));
    expect(service!.violationBp).toBe(pct(8));

    // The compliant line is untouched by its neighbour's breach.
    expect(hardware!.violationBp).toBe(0);

    expect(quote.riskScoreBp).toBeGreaterThan(0);
    expect(quote.requiredApprovalLevel).toBe('MANAGER');
  });

  it('raises exactly one Manager rung on submit and blocks sending until it clears', async () => {
    const quoteId = await newAcmeDraft();
    await addLine(quoteId, { productId: seeded.products.laptop.id, quantity: 20, discountBp: pct(12) });
    await addLine(quoteId, { productId: seeded.products.setup.id, quantity: 5, discountBp: pct(18) });

    const submit = await rep.post(`/api/quotations/${quoteId}/confirm`).send({});
    expect(submit.status).toBe(200);
    expect(submit.body.quote.status).toBe('PENDING_APPROVAL');

    const approvals = await rep.get(`/api/approvals?quotationId=${quoteId}`);
    const rungs = approvals.body.data as Array<{ level: string; sequence: number; status: string }>;
    expect(rungs).toHaveLength(1);
    expect(rungs[0]!.level).toBe('MANAGER');
    expect(rungs[0]!.status).toBe('PENDING');

    // A quote awaiting approval is not sendable.
    const send = await rep.post(`/api/quotations/${quoteId}/send`).send({});
    expect(send.status).toBe(400);
    expect(send.body.error.code).toBe('QUOTE_NOT_APPROVED');
  });

  it('matches the seeded canonical quote, which is the documented AT-04 fixture', async () => {
    const canonical = await readQuote(seeded.quotations.canonical.id);
    const service = canonical.lines.find((l) => l.productName === seeded.products.setup.name);

    expect(service!.violationBp).toBe(pct(8));
    expect(canonical.riskScoreBp).toBe(seeded.canonicalRisk.riskScoreBp);
    expect(canonical.requiredApprovalLevel).toBe(seeded.canonicalRisk.requiredLevel);
  });
});

describe('AT-05 risk blends every violation, not just the worst line', () => {
  it('scores two breaching lines above either one alone', async () => {
    // Baseline: only the services line breaches.
    const oneBreachId = await newAcmeDraft();
    await addLine(oneBreachId, { productId: seeded.products.laptop.id, quantity: 10, discountBp: pct(12) });
    await addLine(oneBreachId, { productId: seeded.products.setup.id, quantity: 10, discountBp: pct(18) });
    const oneBreach = await readQuote(oneBreachId);

    // Same shape, but now the hardware line breaches by a smaller margin too.
    const twoBreachId = await newAcmeDraft();
    await addLine(twoBreachId, { productId: seeded.products.laptop.id, quantity: 10, discountBp: pct(18) });
    await addLine(twoBreachId, { productId: seeded.products.setup.id, quantity: 10, discountBp: pct(18) });
    const twoBreach = await readQuote(twoBreachId);

    const hardware = twoBreach.lines.find((l) => l.productName === seeded.products.laptop.name);
    const service = twoBreach.lines.find((l) => l.productName === seeded.products.setup.name);

    // Both lines individually over their own ceiling: 18% vs 15% and 18% vs 10%.
    expect(hardware!.violationBp).toBe(pct(3));
    expect(service!.violationBp).toBe(pct(8));

    // The worst single breach is 8 points in both quotes. If risk were
    // "severity of the worst line" the two scores would be equal; breadth and
    // exposure have to lift the second one.
    expect(twoBreach.riskScoreBp).toBeGreaterThan(oneBreach.riskScoreBp);
  });

  it('weights a breach on a high-value line above the same breach on a small one', async () => {
    // The breaching service line is a large share of quote value.
    const heavyId = await newAcmeDraft();
    await addLine(heavyId, { productId: seeded.products.laptop.id, quantity: 1, discountBp: pct(12) });
    await addLine(heavyId, { productId: seeded.products.setup.id, quantity: 40, discountBp: pct(18) });
    const heavy = await readQuote(heavyId);

    // Identical breach, but now a minority of quote value.
    const lightId = await newAcmeDraft();
    await addLine(lightId, { productId: seeded.products.laptop.id, quantity: 40, discountBp: pct(12) });
    await addLine(lightId, { productId: seeded.products.setup.id, quantity: 1, discountBp: pct(18) });
    const light = await readQuote(lightId);

    const heavyService = heavy.lines.find((l) => l.productName === seeded.products.setup.name);
    const lightService = light.lines.find((l) => l.productName === seeded.products.setup.name);
    expect(heavyService!.violationBp).toBe(lightService!.violationBp);

    // Same severity, same breadth — only exposure differs, so it must move the score.
    expect(heavy.riskScoreBp).toBeGreaterThan(light.riskScoreBp);
  });

  it('escalates to MANAGER_FINANCE once the blended score crosses the band', async () => {
    const quoteId = await newAcmeDraft();
    // Deep breaches across both categories, on the whole quote's value.
    await addLine(quoteId, { productId: seeded.products.laptop.id, quantity: 20, discountBp: pct(45) });
    await addLine(quoteId, { productId: seeded.products.setup.id, quantity: 10, discountBp: pct(50) });

    const quote = await readQuote(quoteId);
    expect(quote.riskScoreBp).toBeGreaterThanOrEqual(2_500);
    expect(quote.requiredApprovalLevel).toBe('MANAGER_FINANCE');
  });

  it('counts the order-level discount toward risk even when every line is compliant', async () => {
    const quoteId = await newAcmeDraft();
    await addLine(quoteId, { productId: seeded.products.laptop.id, quantity: 10, discountBp: pct(10) });

    const before = await readQuote(quoteId);
    expect(before.riskScoreBp).toBe(0);

    const patch = await rep.patch(`/api/quotations/${quoteId}`).send({ orderDiscountBp: pct(25) });
    expect(patch.status).toBe(200);

    const after = await readQuote(quoteId);
    // No line breaches its ceiling, yet a 25% order-level discount is an
    // exception in its own right and has to register.
    expect(after.lines.every((l) => l.violationBp === 0)).toBe(true);
    expect(after.riskScoreBp).toBeGreaterThan(0);
    expect(after.version).toBeGreaterThan(before.version);
  });
});

describe('ceiling resolution', () => {
  it('applies the Subscriptions ceiling to a recurring line', async () => {
    const quoteId = await newAcmeDraft();
    await addLine(quoteId, { productId: seeded.products.support.id, quantity: 20, discountBp: pct(15) });

    const quote = await readQuote(quoteId);
    expect(quote.lines[0]!.effectiveCeilingBp).toBe(pct(15));
    expect(quote.lines[0]!.violationBp).toBe(0);
  });

  it('gives a Silver customer a stricter hardware ceiling than a Gold one', async () => {
    // Northwind is Silver: Hardware caps at 10%, not Gold's 15%.
    const draft = await rep.post('/api/quotations').send({ customerId: seeded.customers.northwind.id });
    expect(draft.status).toBe(201);
    const quoteId = draft.body.quote.id as string;

    await addLine(quoteId, { productId: seeded.products.laptop.id, quantity: 5, discountBp: pct(12) });

    const quote = await readQuote(quoteId);
    expect(quote.lines[0]!.effectiveCeilingBp).toBe(pct(10));
    // The same 12% that was compliant for Gold breaches by 2 points here.
    expect(quote.lines[0]!.violationBp).toBe(pct(2));
    // The breach registers, but a single 2-point exception on a one-line quote
    // scores inside the 0–499bp band, so policy does not demand a reviewer.
    // Detecting the breach and escalating it are deliberately separate decisions.
    expect(quote.riskScoreBp).toBeGreaterThan(0);
    expect(quote.riskScoreBp).toBeLessThan(500);
    expect(quote.requiredApprovalLevel).toBe('NONE');
  });

  it('escalates the same Silver breach once it is deep enough', async () => {
    const draft = await rep.post('/api/quotations').send({ customerId: seeded.customers.northwind.id });
    const quoteId = draft.body.quote.id as string;
    await addLine(quoteId, { productId: seeded.products.laptop.id, quantity: 5, discountBp: pct(30) });

    const quote = await readQuote(quoteId);
    expect(quote.lines[0]!.violationBp).toBe(pct(20));
    expect(quote.riskScoreBp).toBeGreaterThanOrEqual(500);
    expect(quote.requiredApprovalLevel).not.toBe('NONE');
  });

  it('snapshots the ceiling on the line so a later rule change is not retroactive', async () => {
    const quoteId = await newAcmeDraft();
    await addLine(quoteId, { productId: seeded.products.laptop.id, quantity: 10, discountBp: pct(12) });

    const before = await readQuote(quoteId);
    expect(before.lines[0]!.effectiveCeilingBp).toBe(pct(15));

    // Tighten the Gold–Hardware ceiling under the live quote.
    const admin = await sessionAs('admin@dealflow.local', DEMO_PASSWORD);
    const rules = await admin.get('/api/discount-rules');
    const goldHardware = (rules.body.data as Array<{ id: string; name: string }>).find(
      (r) => r.name === 'Gold — Hardware',
    );
    expect(goldHardware).toBeDefined();
    const patch = await admin.patch(`/api/discount-rules/${goldHardware!.id}`).send({
      maxDiscountBp: pct(5),
    });
    expect(patch.status).toBe(200);

    // Untouched quote still carries the ceiling it was evaluated against.
    const stillOld = await readQuote(quoteId);
    expect(stillOld.lines[0]!.effectiveCeilingBp).toBe(pct(15));
    expect(stillOld.lines[0]!.violationBp).toBe(0);

    // Recalculation is what adopts the new policy, which is what makes the
    // change auditable rather than silent.
    const recalc = await rep.post(`/api/quotations/${quoteId}/recalculate`).send({});
    expect(recalc.status).toBe(200);

    const after = await readQuote(quoteId);
    expect(after.lines[0]!.effectiveCeilingBp).toBe(pct(5));
    expect(after.lines[0]!.violationBp).toBe(pct(7));
  });
});
