import { describe, expect, it } from 'vitest';
import { buildRotationPrint, createVerification, ddmmyyyy, indexDataset, statusAfter, type CodeTable, type CommunityPrint, type Dataset, type RotationPrint } from '../src';
import { generateDemoDataset } from '../src/synthetic';
import { addActivity, addEncounter, emptyDataset, proc } from './fixtures';

const OPTS = { includePending: false, fillToBookRows: true, printedOn: '2026-01-10' };

function verify(ds: Dataset, filter: (code: string) => boolean, levelObserved?: 1 | 2 | 3 | 4 | 5) {
  let prev = ds.verifications.at(-1)?.hash ?? null;
  for (const e of ds.entries.filter((x) => filter(x.requirementCode))) {
    const v = createVerification(e, { verifierId: 'sup-1', decision: 'verified', levelObserved, method: 'pin' }, prev, `${e.performedOn}T16:00:00Z`, `v-${e.id}`);
    ds.verifications.push(v);
    e.status = statusAfter(v);
    prev = v.hash;
  }
}

const table = (p: RotationPrint, code: string): CodeTable => p.tables.find((t) => t.requirement.code === code)!;

describe('KMPDC logbook pages', () => {
  it('formats dates as in the paper book', () => {
    expect(ddmmyyyy('2025-11-03')).toBe('03/11/2025');
  });

  it('fills rows from verified entries in date order, at the observed level, with verification references', () => {
    const ds = emptyDataset();
    addEncounter(ds, '2025-11-05', [proc('extraction', 5, ['36'])]);
    addEncounter(ds, '2025-11-03', [proc('extraction', 5, ['46'])]);
    addEncounter(ds, '2025-11-07', [proc('extraction', 4, ['38'])]); // left unverified
    verify(ds, (c) => c === 'OMF 2', 4);
    ds.entries.find((e) => e.performedOn === '2025-11-07' && e.requirementCode === 'OMF 2')!.status = 'submitted';
    const p = buildRotationPrint(indexDataset(ds), ds.rotations[0]!.id, OPTS, 'Test Hospital') as RotationPrint;
    const t = table(p, 'OMF 2');
    expect(t.rows).toHaveLength(20); // padded to the book's 20 rows
    expect(t.filled).toBe(2);
    expect(t.rows.slice(0, 2).map((r) => [r.serial, r.date, r.level])).toEqual([
      [1, '03/11/2025', 4],
      [2, '05/11/2025', 4],
    ]);
    expect(t.rows[0]!.verificationRef).toMatch(/^[0-9a-f]{8}$/);
    expect(t.rows[2]).toMatchObject({ serial: 3, date: '' });
    expect(p.identity).toMatchObject({ internName: 'Test Intern', trainingCentre: 'Test Hospital', periodFrom: '2025-10-13', periodTo: '2025-12-28' });
  });

  it('optionally includes entries awaiting verification, marked as pending', () => {
    const ds = emptyDataset();
    addEncounter(ds, '2025-11-03', [proc('extraction', 3, ['46'])]);
    const p = buildRotationPrint(indexDataset(ds), ds.rotations[0]!.id, { ...OPTS, includePending: true }, 'X') as RotationPrint;
    expect(table(p, 'OMF 2').rows[0]).toMatchObject({ date: '03/11/2025', pending: true, verificationRef: '' });
    const strict = buildRotationPrint(indexDataset(ds), ds.rotations[0]!.id, OPTS, 'X') as RotationPrint;
    expect(table(strict, 'OMF 2').filled).toBe(0);
  });

  it('puts entries beyond the book’s rows, and codes without printed rows, on continuation sheets', () => {
    const ds = emptyDataset();
    for (let i = 0; i < 7; i++) addEncounter(ds, '2025-11-03', [proc('dry_socket', 5, ['36'])]); // OMF 3: 5 rows
    addActivity(ds, '2026-06-10', 'case_presentation', 5); // CONS 07: 0 rows
    verify(ds, () => true);
    const omf = buildRotationPrint(indexDataset(ds), ds.rotations[0]!.id, OPTS, 'X') as RotationPrint;
    expect(table(omf, 'OMF 3').rows).toHaveLength(5);
    expect(table(omf, 'OMF 3').continuation.map((r) => r.serial)).toEqual([6, 7]);
    const cons = buildRotationPrint(indexDataset(ds), ds.rotations[3]!.id, OPTS, 'X') as RotationPrint;
    expect(table(cons, 'CONS 07').rows).toHaveLength(0);
    expect(table(cons, 'CONS 07').continuation).toHaveLength(1);
  });

  it('changes the integrity code when the underlying entries change', () => {
    const ds = emptyDataset();
    addEncounter(ds, '2025-11-03', [proc('extraction', 5, ['46'])]);
    verify(ds, () => true);
    const a = buildRotationPrint(indexDataset(ds), ds.rotations[0]!.id, OPTS, 'X') as RotationPrint;
    addEncounter(ds, '2025-11-04', [proc('extraction', 5, ['36'])]);
    verify(ds, (c) => c === 'OMF 2');
    const b = buildRotationPrint(indexDataset(ds), ds.rotations[0]!.id, OPTS, 'X') as RotationPrint;
    expect(table(a, 'OMF 2').integrity).not.toBe(table(b, 'OMF 2').integrity);
    expect(table(a, 'OMF 1').integrity).toBe(table(b, 'OMF 1').integrity);
    expect(a.integrity).toMatch(/^[0-9A-F]{10}$/);
  });

  it('lays out the community logs as in 5.7.4–5.7.6', () => {
    const ds = generateDemoDataset();
    const ix = indexDataset(ds);
    const comm = ds.rotations.find((r) => r.rotation === 'COMM')!;
    const p = buildRotationPrint(ix, comm.id, OPTS, 'X') as CommunityPrint;
    expect(p.kind).toBe('community');
    expect(p.activities).toHaveLength(16);
    expect(p.activities[0]!.label).toBe('Primary school talk on oral health');
    expect(p.caseFollowUp).toHaveLength(7);
    expect(p.caseFollowUp.find((c) => c.caseType === 'tobacco')!.steps[0]!.rows).toHaveLength(4);
    expect(p.caseFollowUp.flatMap((c) => c.steps.flatMap((s) => s.rows))).toHaveLength(64);
    expect(p.weeklyReports).toHaveLength(8);
    expect(p.activities.filter((a) => a.date).length).toBeGreaterThan(10);
    expect(p.verificationLog.length).toBeGreaterThan(0);
  });
});
