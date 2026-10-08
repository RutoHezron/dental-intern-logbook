import { describe, expect, it } from 'vitest';
import {
  assessmentSchedule,
  assessmentStatus,
  CLINICAL_CRITERIA,
  COMMUNITY_CRITERIA,
  formSectionNumber,
  FORMS_VERSION,
  fromWire,
  indexDataset,
  progressSnapshot,
  progressSummaryText,
  toWire,
  validateAssessment,
  type Assessment,
} from '../src';
import { addEncounter, emptyDataset, proc } from './fixtures';

const base = (over: Partial<Assessment> = {}): Assessment => ({
  id: 'a1',
  internshipId: 'int-1',
  rotationId: 'r1',
  kind: 'end_of_rotation',
  sequence: 1,
  formVersion: FORMS_VERSION,
  responses: {},
  grades: {},
  gradeRemarks: {},
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('KMPDC assessment forms', () => {
  it('transcribes 14 graded criteria for clinical and community evaluations', () => {
    expect(CLINICAL_CRITERIA.flatMap((g) => g.criteria)).toHaveLength(14);
    expect(COMMUNITY_CRITERIA.flatMap((g) => g.criteria)).toHaveLength(14);
    expect(COMMUNITY_CRITERIA[1]!.title).toMatch(/Application of community dentistry/);
  });

  it('numbers forms as in the book', () => {
    expect(formSectionNumber('5.3', 'monthly', 'OMF')).toBe('5.3.6.1');
    expect(formSectionNumber('5.3', 'overall_rotation', 'OMF')).toBe('5.3.7');
    expect(formSectionNumber('5.7', 'end_of_rotation', 'COMM')).toBe('5.7.7.3');
    expect(formSectionNumber('5.7', 'overall_rotation', 'COMM')).toBe('5.7.8');
  });

  it('schedules two monthly meetings per clinical rotation and one for community', () => {
    const ds = emptyDataset();
    const omf = assessmentSchedule(ds.rotations[0]!);
    expect(omf.map((f) => [f.kind, f.sequence, f.due])).toEqual([
      ['monthly', 1, '2025-11-09'],
      ['monthly', 2, '2025-12-07'],
      ['mid_rotation', 1, '2025-11-23'],
      ['end_of_rotation', 1, '2025-12-28'],
      ['overall_rotation', 1, '2025-12-28'],
    ]);
    expect(assessmentSchedule(ds.rotations[4]!).filter((f) => f.kind === 'monthly')).toHaveLength(1);
  });

  it('requires reasons for grades of 0 or 1 (KMPDC 5.2.2)', () => {
    const a = base({ grades: { k1: 1, s4: 0, p1: 3 }, gradeRemarks: { k1: 'Needs revision of anatomy' } });
    const issues = validateAssessment(a, 'OMF');
    expect(issues.map((i) => i.ref)).toEqual(['s4']);
    expect(validateAssessment(base({ overallGrade: 1 }), 'OMF').map((i) => i.code)).toContain('overall_reason');
    expect(validateAssessment(base({ kind: 'overall_rotation', outcome: 'extend' }), 'OMF').map((i) => i.code)).toEqual(['extend_period']);
  });

  it('tracks completeness', () => {
    expect(assessmentStatus(undefined, 'OMF')).toBe('not_started');
    const all = Object.fromEntries(CLINICAL_CRITERIA.flatMap((g) => g.criteria).map((c) => [c.id, 3 as const]));
    expect(assessmentStatus(base({ grades: { k1: 3 } }), 'OMF')).toBe('in_progress');
    expect(assessmentStatus(base({ grades: all, overallGrade: 3, recommendation: 'Completed satisfactorily' }), 'OMF')).toBe('complete');
    const monthly = base({ kind: 'monthly', responses: { a1: 'x', a2: 'x', a3: 'x', a4: 'x', a5: 'x', b1: 'x', b2: 'x', b3: 'x', b4: 'x', c1: 'x', c2: 'x', c3: 'x' } });
    expect(assessmentStatus(monthly, 'OMF')).toBe('in_progress'); // no meeting date yet
    expect(assessmentStatus({ ...monthly, heldOn: '2025-11-09' }, 'OMF')).toBe('complete');
  });

  it('drafts the supervisor’s progress remark from recorded counts only', () => {
    const ds = emptyDataset();
    for (let i = 0; i < 3; i++) addEncounter(ds, '2025-10-20', [proc('extraction', 4, ['36'])]);
    const ix = indexDataset(ds);
    const text = progressSummaryText(ix, ds.rotations[0]!, '2025-11-09');
    expect(text).toMatch(/^As of 9 Nov 2025: minimum met for 0 of 19 codes/);
    expect(text).toMatch(/3 entries await verification/);
    const snap = progressSnapshot(ix, ds.rotations[0]!, '2025-11-09');
    expect(snap.codes.find((c) => c.code === 'OMF 2')).toEqual({ code: 'OMF 2', verified: 0, min: 20, status: 'behind' });
  });

  it('keeps form answers intact across the wire', () => {
    const a = base({ grades: { k1: 2 }, gradeRemarks: { k1: 'Good' }, responses: { b2: 'On track' }, progressSnapshot: { asOf: '2025-11-09', codes: [{ code: 'OMF 2', verified: 3, min: 20, status: 'behind' }] } });
    const round = fromWire<Assessment>(toWire(a));
    expect(round.grades).toEqual({ k1: 2 });
    expect(round.gradeRemarks).toEqual({ k1: 'Good' });
    expect(round.responses).toEqual({ b2: 'On track' });
    expect(round.progressSnapshot).toEqual(a.progressSnapshot);
  });
});
