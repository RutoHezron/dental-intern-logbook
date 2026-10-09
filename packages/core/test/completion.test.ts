import { describe, expect, it } from 'vitest';
import { assessmentStatus, completionReadiness, completionRemarkId, formSectionNumber, indexDataset, validateAssessment, type Assessment } from '../src';
import { generateDemoDataset } from '../src/synthetic';

const form = (over: Partial<Assessment>): Assessment => ({
  id: 'f1',
  internshipId: 'int',
  rotationId: null,
  kind: 'end_of_internship',
  sequence: 1,
  formVersion: 'x',
  responses: {},
  grades: {},
  gradeRemarks: {},
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('end-of-internship paperwork (5.8, 5.9)', () => {
  it('numbers the internship forms as in the book', () => {
    expect(formSectionNumber('', 'end_of_internship', '')).toBe('5.8');
    expect(formSectionNumber('', 'completion_verification', '')).toBe('5.9');
  });

  it('5.8 is complete with the coordinator’s recommendation and an outcome; extension needs a period', () => {
    expect(assessmentStatus(form({ responses: { e1: 'Recommended' } }), '')).toBe('in_progress');
    expect(assessmentStatus(form({ responses: { e1: 'Recommended' }, outcome: 'completed' }), '')).toBe('complete');
    expect(validateAssessment(form({ outcome: 'extend' }), '').map((i) => i.code)).toEqual(['extend_period']);
  });

  it('5.9 is complete when every rotation has a remark', () => {
    const responses = Object.fromEntries(['OMF', 'PAED', 'PER', 'CONS', 'COMM'].map((c) => [completionRemarkId(c), 'Completed']));
    expect(assessmentStatus(form({ kind: 'completion_verification', responses: { ...responses, vcomm: '' } }), '')).toBe('in_progress');
    expect(assessmentStatus(form({ kind: 'completion_verification', responses }), '')).toBe('complete');
  });

  it('lists what is outstanding before the completion paperwork', () => {
    const ds = generateDemoDataset();
    const items = completionReadiness(indexDataset(ds), ds.assessments ?? [], '2026-10-08');
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId.rotations!.ok).toBe(false);
    expect(byId.rotations!.detail).toMatch(/Community Dentistry/);
    expect(byId['minimums-CONS']!.ok).toBe(false);
    expect(byId['minimums-CONS']!.detail).toMatch(/CONS 03/);
    expect(byId.outcomes!.detail).toMatch(/Community Dentistry/);
    expect(byId.outcomes!.detail).not.toMatch(/Oral and Maxillofacial/);
  });
});
