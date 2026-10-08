import { describe, expect, it } from 'vitest';
import {
  buildPortfolio,
  buildReport,
  computeStats,
  createVerification,
  generateInsights,
  indexDataset,
  internshipMonth,
  internshipMonths,
  internshipWeek,
  internshipWeeks,
  logbookCsv,
  monthIndexOn,
  previousPeriod,
  requirementProgress,
  snapshotMatches,
  snapshotReport,
  statusAfter,
  weekIndexOn,
  type Dataset,
  type LogbookEntry,
} from '../src';
import { addActivity, addEncounter, addPatient, emptyDataset, proc } from './fixtures';

function verifyAll(ds: Dataset, filter: (e: LogbookEntry) => boolean = () => true, levelObserved?: 1 | 2 | 3 | 4 | 5) {
  let prev: string | null = ds.verifications.at(-1)?.hash ?? null;
  for (const e of ds.entries.filter(filter)) {
    const v = createVerification(e, { verifierId: 'sup-1', decision: 'verified', levelObserved, method: 'pin' }, prev, `${e.performedOn}T16:00:00Z`, `v-${e.id}`);
    ds.verifications.push(v);
    e.status = statusAfter(v);
    prev = v.hash;
  }
}

describe('periods', () => {
  const ds = emptyDataset();
  it('numbers weeks and months from the internship start', () => {
    expect(internshipWeek(ds.internship, 1)).toMatchObject({ from: '2025-10-13', to: '2025-10-19', label: 'Week 1' });
    expect(internshipMonth(ds.internship, 3)).toMatchObject({ from: '2025-12-13', to: '2026-01-12', label: 'Month 3' });
    expect(weekIndexOn(ds.internship, '2025-10-20')).toBe(2);
    expect(monthIndexOn(ds.internship, '2026-10-11')).toBe(12);
    expect(internshipWeeks(ds.internship, '2026-12-31')).toHaveLength(52);
    expect(internshipMonths(ds.internship, '2026-12-31')).toHaveLength(12);
  });

  it('finds the previous period of the same kind', () => {
    expect(previousPeriod(internshipMonth(ds.internship, 1), ds.internship, ds.rotations, ds.requirementSet)).toBeNull();
    expect(previousPeriod(internshipMonth(ds.internship, 2), ds.internship, ds.rotations, ds.requirementSet)?.label).toBe('Month 1');
  });
});

describe('statistics', () => {
  it('counts exposure by level, category and rotation', () => {
    const ds = emptyDataset();
    addEncounter(ds, '2025-10-14', [proc('exam_plan', 3), proc('extraction', 4, ['36', '46'])]);
    addEncounter(ds, '2025-10-15', [proc('extraction', 1, ['48'])], { visitType: 'emergency' });
    addActivity(ds, '2025-10-16', 'postmortem', 1);
    const s = computeStats(indexDataset(ds), '2025-10-13', '2025-10-19');
    expect(s.encounters).toBe(2);
    expect(s.patientsSeen).toBe(2);
    expect(s.procedures.total).toBe(4); // exam + 2 teeth + 1 tooth
    expect(s.procedures.byLevel).toEqual({ 1: 1, 2: 0, 3: 1, 4: 2, 5: 0 });
    expect(s.procedures.performed).toBe(3);
    expect(s.procedures.observed).toBe(1);
    expect(s.emergencies).toBe(1);
    expect(s.byCategory.oral_surgery).toBe(3);
    expect(s.byRotation.OMF).toBe(4);
    expect(s.byCode['OMF 2']).toEqual({ logged: 3, verified: 0 });
    expect(s.byCode['OMF 19']).toEqual({ logged: 1, verified: 0 });
    expect(s.activeDays).toBe(3);
  });

  it('counts a returning patient once', () => {
    const ds = emptyDataset();
    const p = addPatient(ds);
    addEncounter(ds, '2025-10-14', [proc('exam_plan', 3)], { patient: p });
    addEncounter(ds, '2025-10-15', [proc('extraction', 3, ['36'])], { patient: p, visitType: 'review' });
    const s = computeStats(indexDataset(ds), '2025-10-13', '2025-10-19');
    expect(s.patientsSeen).toBe(1);
    expect(s.newPatients).toBe(1);
    expect(s.followUps).toBe(1);
  });

  it('ignores deleted encounters and withdrawn entries', () => {
    const ds = emptyDataset();
    const e = addEncounter(ds, '2025-10-14', [proc('extraction', 3, ['36'])]);
    e.deletedAt = '2025-10-14T13:00:00Z';
    ds.entries.forEach((x) => (x.status = 'withdrawn'));
    const s = computeStats(indexDataset(ds), '2025-10-13', '2025-10-19');
    expect(s.encounters).toBe(0);
    expect(s.entries.logged).toBe(0);
  });
});

describe('logbook progress', () => {
  it('separates logged, verified and at-expected-level counts', () => {
    const ds = emptyDataset();
    for (let i = 0; i < 6; i++) addEncounter(ds, '2025-10-20', [proc('extraction', 5, [`3${(i % 8) + 1}`])]);
    verifyAll(ds, (e) => ds.entries.indexOf(e) < 4); // 4 verified
    // Supervisor observes level 4 on the first: no longer at expected level 5.
    ds.verifications[0] = createVerification(ds.entries[0]!, { verifierId: 'sup-1', decision: 'verified', levelObserved: 4, method: 'pin' }, null, '2025-10-20T16:00:00Z', 'v-x');
    const p = requirementProgress(indexDataset(ds), '2025-10-25').find((x) => x.requirement.code === 'OMF 2')!;
    expect(p.logged).toBe(6);
    expect(p.verified).toBe(4);
    expect(p.pending).toBe(2);
    expect(p.atExpectedLevel).toBe(3);
    expect(p.remaining).toBe(16);
    expect(p.highestVerifiedLevel).toBe(5);
  });

  it('marks codes met, behind, upcoming and not met', () => {
    const ds = emptyDataset();
    for (let i = 0; i < 20; i++) addEncounter(ds, '2025-10-20', [proc('extraction', 5, ['36'])]);
    verifyAll(ds);
    const ix = indexDataset(ds);
    const during = requirementProgress(ix, '2025-11-20');
    expect(during.find((p) => p.requirement.code === 'OMF 2')!.status).toBe('met');
    expect(during.find((p) => p.requirement.code === 'OMF 9')!.status).toBe('behind');
    expect(during.find((p) => p.requirement.code === 'PAED 2')!.status).toBe('upcoming');
    const after = requirementProgress(ix, '2026-01-10');
    expect(after.find((p) => p.requirement.code === 'OMF 9')!.status).toBe('not_met');
  });

  it('forecasts from pace during a rotation', () => {
    const ds = emptyDataset();
    // 10 extractions in the first 14 days of a 77-day rotation → pace forecast ≈ 55.
    for (let i = 0; i < 10; i++) addEncounter(ds, '2025-10-20', [proc('extraction', 3, ['36'])]);
    const p = requirementProgress(indexDataset(ds), '2025-10-26').find((x) => x.requirement.code === 'OMF 2')!;
    expect(p.forecast).toBe(55);
    expect(p.status).toBe('on_track');
  });
});

describe('compounding reports', () => {
  function sampleInternship() {
    const ds = emptyDataset();
    const days = ['2025-10-14', '2025-10-22', '2025-11-05', '2025-11-20', '2025-12-03', '2026-01-08', '2026-01-20'];
    days.forEach((d, i) => {
      addEncounter(ds, d, [proc('exam_plan', 3), proc('extraction', ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5, ['36'])]);
      if (i % 2 === 0) addEncounter(ds, d, [proc('composite', 3, ['11'])]);
    });
    verifyAll(ds);
    return indexDataset(ds);
  }

  it('weekly and monthly totals add up to the cumulative total', () => {
    const ix = sampleInternship();
    const asOf = '2026-01-31';
    const total = computeStats(ix, ix.ds.internship.periodFrom, asOf).procedures.total;
    const weekly = internshipWeeks(ix.ds.internship, asOf).reduce((s, w) => s + computeStats(ix, w.from, w.to).procedures.total, 0);
    const monthly = internshipMonths(ix.ds.internship, asOf).reduce((s, m) => s + computeStats(ix, m.from, m.to).procedures.total, 0);
    expect(weekly).toBe(total);
    expect(monthly).toBe(total);
  });

  it('a monthly report carries period, cumulative and previous-period figures', () => {
    const ix = sampleInternship();
    const r = buildReport(ix, internshipMonth(ix.ds.internship, 2), '2026-01-31');
    expect(r.stats.procedures.total).toBe(5); // 13 Nov–12 Dec: 20 Nov, 3 Dec (+composite on 3 Dec)
    expect(r.cumulative.procedures.total).toBe(r.previousStats!.procedures.total + r.stats.procedures.total);
    // Month 1 (13 Oct–12 Nov): 14 Oct (3), 22 Oct (2), 5 Nov (3) = 8.
    expect(r.deltas.find((d) => d.key === 'procedures')).toMatchObject({ current: 5, previous: 8, change: -3 });
    expect(r.codeGains.find((g) => g.code === 'OMF 2')?.gained).toBe(2);
    expect(r.partial).toBe(false);
  });

  it('a report for a period still in progress is marked partial and counts only to asOf', () => {
    const ix = sampleInternship();
    const r = buildReport(ix, internshipMonth(ix.ds.internship, 4), '2026-01-15');
    expect(r.partial).toBe(true);
    expect(r.through).toBe('2026-01-15');
  });

  it('snapshots detect later changes to the underlying data', () => {
    const ix = sampleInternship();
    const month = internshipMonth(ix.ds.internship, 1);
    const snap = snapshotReport(buildReport(ix, month, '2026-01-31'), 'snap-1', '2025-11-13T10:00:00Z');
    expect(snapshotMatches(snap, buildReport(ix, month, '2026-01-31'))).toBe(true);
    addEncounter(ix.ds, '2025-10-30', [proc('extraction', 3, ['46'])]);
    expect(snapshotMatches(snap, buildReport(indexDataset(ix.ds), month, '2026-01-31'))).toBe(false);
  });

  it('exports the logbook as CSV with one row per entry', () => {
    const ix = sampleInternship();
    const csv = logbookCsv(ix, { rotationCode: 'OMF' });
    const lines = csv.split('\r\n');
    expect(lines[0]).toMatch(/^Code,Description,Rotation,Date,Patient No\./);
    expect(lines.length - 1).toBe(ix.entries.filter((e) => ix.rotationCode(e.rotationId) === 'OMF').length);
  });
});

describe('insights and portfolio', () => {
  it('words gaps as recorded exposure and never claims competence', () => {
    const ds = emptyDataset();
    for (let i = 0; i < 3; i++) addEncounter(ds, '2025-10-20', [proc('extraction', 2, ['36'])]);
    verifyAll(ds);
    const ix = indexDataset(ds);
    const insights = generateInsights(ix, { asOf: '2026-01-15' });
    const text = insights.map((i) => i.text).join(' ');
    expect(text).toMatch(/exposure appears limited based on recorded activities/i);
    expect(text).not.toMatch(/\bcompetent\b|\bcertif/i);
    for (const i of insights) expect(i.evidence.length).toBeGreaterThan(0);
  });

  it('builds a portfolio whose draft reflection cites recorded figures', () => {
    const ds = emptyDataset();
    addEncounter(ds, '2025-10-20', [proc('extraction', 5, ['36'])]);
    verifyAll(ds);
    // The day after the internship ends: every rotation is complete.
    const pf = buildPortfolio(indexDataset(ds), '2026-10-12');
    expect(pf.totals.procedures.total).toBe(1);
    expect(pf.disclaimer).toMatch(/not, on their own, proof of competence/);
    expect(pf.draftReflection[0]!.text).toContain('1 procedure across 1 patient, in 5 completed rotations');
    for (const s of pf.draftReflection) expect(s.evidence).toBeTruthy();
    expect(pf.rotations.map((r) => r.status)).toEqual(['completed', 'completed', 'completed', 'completed', 'completed']);
  });
});
