import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildReport,
  checkVerificationChain,
  computeStats,
  detectIdentifier,
  indexDataset,
  internshipMonths,
  internshipWeeks,
  progressTimeline,
  requirementProgress,
  rotationForDate,
  sha256,
  stableStringify,
  type Dataset,
  type DatasetIndex,
} from '../src';
import { DEMO_DEFAULTS, generateDemoDataset } from '../src/synthetic';

let ds: Dataset;
let ix: DatasetIndex;
const asOf = DEMO_DEFAULTS.asOf;

beforeAll(() => {
  ds = generateDemoDataset();
  ix = indexDataset(ds);
});

describe('synthetic demo internship (Dr Alex Mwangi)', () => {
  it('is deterministic for a seed', () => {
    const again = generateDemoDataset();
    expect(sha256(stableStringify(again))).toBe(sha256(stableStringify(ds)));
    expect(sha256(stableStringify(generateDemoDataset({ seed: 7 })))).not.toBe(sha256(stableStringify(ds)));
  });

  it('has a realistic volume of records', () => {
    expect(ds.encounters.length).toBeGreaterThan(800);
    expect(ds.entries.length).toBeGreaterThan(1000);
    expect(ds.reflections.length).toBeGreaterThan(50);
    expect(ds.rotations).toHaveLength(5);
  });

  it('stores no patient identifiers beyond the hospital number (privacy acceptance criterion)', () => {
    const allowed = new Set(['id', 'ref', 'birthYear', 'sex', 'systemicCondition', 'alerts', 'createdAt']);
    for (const p of ds.patients) {
      for (const key of Object.keys(p)) expect(allowed, `patient field ${key}`).toContain(key);
      expect(p.ref).toMatch(/^(OP|IP)-\d{2}-\d{4,5}$/);
    }
  });

  it('has no identifier-like text in any free-text field', () => {
    const texts = [
      ...ds.encounters.flatMap((e) => [e.complaint, e.notes, e.referredTo, ...e.findings.map((f) => f.term)]),
      ...ds.activities.flatMap((a) => [a.title, a.notes]),
      ...ds.reflections.flatMap((r) => [r.title, r.interesting, r.learned, r.challenged, r.doDifferently, r.revise, r.needExposure]),
    ];
    for (const t of texts) expect(detectIdentifier(t), t).toBeNull();
  });

  it('has every record inside the internship, up to asOf, and in the right rotation', () => {
    for (const e of ds.encounters) {
      expect(e.date >= ds.internship.periodFrom && e.date <= asOf).toBe(true);
      expect(rotationForDate(ds.rotations, e.date)?.id).toBe(e.rotationId);
    }
    for (const e of ds.entries) expect(ix.requirements.has(e.requirementCode), e.requirementCode).toBe(true);
  });

  it('only counts paediatric codes for patients under 17 (R7)', () => {
    const byId = new Map(ds.patients.map((p) => [p.id, p]));
    const encById = new Map(ds.encounters.map((e) => [e.id, e]));
    for (const e of ds.entries.filter((x) => x.requirementCode.startsWith('PAED') && x.encounterId)) {
      const p = byId.get(encById.get(e.encounterId!)!.patientId!)!;
      expect(Number(e.performedOn.slice(0, 4)) - p.birthYear!).toBeLessThan(17);
    }
  });

  it('has an intact verification hash chain', () => {
    expect(checkVerificationChain(ds.verifications, new Map(ds.entries.map((e) => [e.id, e])), new Map((ds.caseReports ?? []).map((r) => [r.id, r])))).toEqual([]);
  });

  it('shows realistic gaps: endodontics and crown & bridge below minimum', () => {
    const progress = requirementProgress(ix, asOf);
    const status = (code: string) => progress.find((p) => p.requirement.code === code)!.status;
    expect(status('CONS 03')).toBe('not_met');
    expect(status('CONS 04')).toBe('not_met');
    expect(status('OMF 2')).toBe('met');
    expect(status('PAED 7')).toBe('met');
  });

  it('compounds: weekly, monthly and rotation totals equal the cumulative total', () => {
    const total = computeStats(ix, ds.internship.periodFrom, asOf);
    const sum = (ranges: { from: string; to: string }[]) =>
      ranges.reduce((s, r) => s + computeStats(ix, r.from, r.to < asOf ? r.to : asOf).procedures.total, 0);
    expect(sum(internshipWeeks(ds.internship, asOf))).toBe(total.procedures.total);
    expect(sum(internshipMonths(ds.internship, asOf))).toBe(total.procedures.total);
    expect(sum(ds.rotations.map((r) => ({ from: r.startsOn, to: r.endsOn })))).toBe(total.procedures.total);
    const timeline = progressTimeline(ix, asOf);
    expect(timeline.at(-1)!.cumulativeProcedures).toBe(total.procedures.total);
  });

  it('each monthly report cumulative = previous cumulative + this month', () => {
    const months = internshipMonths(ds.internship, asOf);
    let prevCumulative = 0;
    for (const m of months) {
      const r = buildReport(ix, m, asOf);
      expect(r.cumulative.procedures.total).toBe(prevCumulative + r.stats.procedures.total);
      prevCumulative = r.cumulative.procedures.total;
    }
  });

  it('generates and analyses within a performance budget', () => {
    const t0 = performance.now();
    const fresh = indexDataset(generateDemoDataset());
    for (const m of internshipMonths(fresh.ds.internship, asOf)) buildReport(fresh, m, asOf);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
