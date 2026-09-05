import { describe, expect, it } from 'vitest';
import {
  bandForRisk,
  validateApprovalBands,
  type ApprovalBand,
} from '../../src/modules/approvalConfig/approvalBands';

/** The seeded configuration from AGENTS.md: [0,4) NONE, [4,15) MANAGER, [15,inf) MANAGER_FINANCE. */
const VALID_BANDS: ApprovalBand[] = [
  { id: 'none', name: 'No approval required', minimumRisk: '0', maximumRisk: '4', requiredLevel: 'NONE', active: true },
  { id: 'mgr', name: 'Sales Manager approval', minimumRisk: '4', maximumRisk: '15', requiredLevel: 'MANAGER', active: true },
  { id: 'fin', name: 'Sales Manager then Finance approval', minimumRisk: '15', maximumRisk: null, requiredLevel: 'MANAGER_FINANCE', active: true },
];

function kinds(bands: ApprovalBand[]): string[] {
  return validateApprovalBands(bands).map((problem) => problem.kind);
}

describe('approval band validation (docs/BUSINESS_RULES.md 4)', () => {
  it('accepts the seeded configuration', () => {
    expect(validateApprovalBands(VALID_BANDS)).toEqual([]);
  });

  it('accepts bands supplied out of order', () => {
    expect(validateApprovalBands([...VALID_BANDS].reverse())).toEqual([]);
  });

  it('rejects an empty set, because no score could route', () => {
    expect(kinds([])).toEqual(['EMPTY']);
    expect(kinds(VALID_BANDS.map((band) => ({ ...band, active: false })))).toEqual(['EMPTY']);
  });

  it('rejects a set that does not start at zero', () => {
    const bands = VALID_BANDS.map((band) =>
      band.id === 'none' ? { ...band, minimumRisk: '1' } : band,
    );
    expect(kinds(bands)).toContain('DOES_NOT_START_AT_ZERO');
  });

  it('detects a gap between two bands', () => {
    const bands = VALID_BANDS.map((band) =>
      band.id === 'mgr' ? { ...band, minimumRisk: '6' } : band,
    );
    const problems = validateApprovalBands(bands);
    expect(problems.map((p) => p.kind)).toContain('GAP');
    expect(problems.find((p) => p.kind === 'GAP')?.message).toContain('does not route anywhere');
  });

  it('detects an overlap between two bands', () => {
    const bands = VALID_BANDS.map((band) =>
      band.id === 'mgr' ? { ...band, minimumRisk: '3' } : band,
    );
    expect(kinds(bands)).toContain('OVERLAP');
  });

  it('detects a missing unbounded top band', () => {
    const bands = VALID_BANDS.map((band) =>
      band.id === 'fin' ? { ...band, maximumRisk: '100' } : band,
    );
    expect(kinds(bands)).toContain('UNBOUNDED_MISSING');
  });

  it('detects an unbounded band that is not last, since later bands become unreachable', () => {
    const bands = VALID_BANDS.map((band) =>
      band.id === 'none' ? { ...band, maximumRisk: null } : band,
    );
    expect(kinds(bands)).toContain('OVERLAP');
  });

  it('detects an inverted band', () => {
    const bands = VALID_BANDS.map((band) =>
      band.id === 'mgr' ? { ...band, minimumRisk: '15', maximumRisk: '4' } : band,
    );
    expect(kinds(bands)).toContain('INVERTED');
  });

  it('detects a zero-width band', () => {
    const bands = VALID_BANDS.map((band) =>
      band.id === 'mgr' ? { ...band, minimumRisk: '4', maximumRisk: '4' } : band,
    );
    expect(kinds(bands)).toContain('INVERTED');
  });

  it('reports the gap left by deactivating a middle band', () => {
    // The common configuration mistake: switching off the manager band silently
    // leaves 4-15 routing nowhere.
    const bands = VALID_BANDS.map((band) =>
      band.id === 'mgr' ? { ...band, active: false } : band,
    );
    expect(kinds(bands)).toContain('GAP');
  });

  it('ignores deactivated bands when they do not create a hole', () => {
    const bands: ApprovalBand[] = [
      ...VALID_BANDS,
      { id: 'retired', name: 'Retired', minimumRisk: '50', maximumRisk: '60', requiredLevel: 'MANAGER', active: false },
    ];
    expect(validateApprovalBands(bands)).toEqual([]);
  });

  it('reports every problem at once, so a fix can be made in one pass', () => {
    const bands: ApprovalBand[] = [
      { id: 'a', name: 'A', minimumRisk: '2', maximumRisk: '4', requiredLevel: 'NONE', active: true },
      { id: 'b', name: 'B', minimumRisk: '6', maximumRisk: '10', requiredLevel: 'MANAGER', active: true },
    ];
    const problems = kinds(bands);
    expect(problems).toContain('DOES_NOT_START_AT_ZERO');
    expect(problems).toContain('GAP');
    expect(problems).toContain('UNBOUNDED_MISSING');
  });

  it('accepts a single unbounded band covering everything', () => {
    expect(
      validateApprovalBands([
        { id: 'all', name: 'Everything', minimumRisk: '0', maximumRisk: null, requiredLevel: 'MANAGER', active: true },
      ]),
    ).toEqual([]);
  });

  it('accepts fractional boundaries that meet exactly', () => {
    expect(
      validateApprovalBands([
        { id: 'a', name: 'A', minimumRisk: '0', maximumRisk: '3.5000', requiredLevel: 'NONE', active: true },
        { id: 'b', name: 'B', minimumRisk: '3.5', maximumRisk: null, requiredLevel: 'MANAGER', active: true },
      ]),
    ).toEqual([]);
  });
});

describe('band lookup for a risk score', () => {
  it('routes the reference scores from AGENTS.md', () => {
    // Canonical quote: Setup Service at 18% against a 10% ceiling scores ~8.2.
    expect(bandForRisk(VALID_BANDS, '8.2')?.requiredLevel).toBe('MANAGER');
    // Customer counters to 30% on that line: ~20.
    expect(bandForRisk(VALID_BANDS, '20')?.requiredLevel).toBe('MANAGER_FINANCE');
  });

  it('treats a band as half-open, so the lower bound belongs to it', () => {
    expect(bandForRisk(VALID_BANDS, '4')?.id).toBe('mgr');
    expect(bandForRisk(VALID_BANDS, '3.9999')?.id).toBe('none');
    expect(bandForRisk(VALID_BANDS, '15')?.id).toBe('fin');
    expect(bandForRisk(VALID_BANDS, '14.9999')?.id).toBe('mgr');
  });

  it('routes zero risk to no approval', () => {
    expect(bandForRisk(VALID_BANDS, '0')?.requiredLevel).toBe('NONE');
  });

  it('routes an extreme score to the unbounded band', () => {
    expect(bandForRisk(VALID_BANDS, '100')?.requiredLevel).toBe('MANAGER_FINANCE');
  });

  it('skips deactivated bands', () => {
    const bands = VALID_BANDS.map((band) =>
      band.id === 'mgr' ? { ...band, active: false } : band,
    );
    // 8.2 falls in the deactivated band, so nothing matches - which is exactly
    // why the validator refuses to allow this configuration to be saved.
    expect(bandForRisk(bands, '8.2')).toBeNull();
  });

  it('returns null when no band covers the score', () => {
    const bands: ApprovalBand[] = [
      { id: 'a', name: 'A', minimumRisk: '10', maximumRisk: '20', requiredLevel: 'MANAGER', active: true },
    ];
    expect(bandForRisk(bands, '5')).toBeNull();
    expect(bandForRisk(bands, '25')).toBeNull();
  });
});
