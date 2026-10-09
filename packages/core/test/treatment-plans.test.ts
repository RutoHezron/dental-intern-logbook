import { describe, expect, it } from 'vitest';
import {
  applyEncounterToPlan,
  dueSoon,
  handoverList,
  indexDataset,
  orderedOpenItems,
  patientBrief,
  planProgress,
  stageText,
  type PlanItem,
  type TreatmentPlan,
} from '../src';
import { addEncounter, addPatient, emptyDataset, proc } from './fixtures';

const item = (over: Partial<PlanItem>): PlanItem => ({ id: Math.random().toString(36).slice(2), phase: 'definitive', procedureTypeId: 'rct', sites: ['46'], status: 'planned', ...over });

function setup() {
  const ds = emptyDataset();
  const p = addPatient(ds, { birthYear: 1991, sex: 'F', systemicCondition: true, alerts: ['Hypertension'] });
  const plan: TreatmentPlan = {
    id: 'plan-1',
    internshipId: ds.internship.id,
    patientId: p.id,
    createdOn: '2026-06-02',
    status: 'active',
    items: [
      item({ id: 'rct', procedureTypeId: 'rct', sites: ['46'], dueOn: '2026-06-09' }),
      item({ id: 'comp', procedureTypeId: 'composite', sites: ['36'], phase: 'disease_control' }),
      item({ id: 'scale', procedureTypeId: 'scaling_polishing', sites: [], phase: 'urgent' }),
      item({ id: 'review', procedureTypeId: 'exam_plan', sites: [], phase: 'review', dueOn: '2026-08-01' }),
    ],
    createdAt: '',
    updatedAt: '',
  };
  return { ds, p, plan };
}

describe('treatment plans', () => {
  it('orders open items by phase, then due date', () => {
    const { plan } = setup();
    expect(orderedOpenItems(plan).map((i) => i.id)).toEqual(['scale', 'comp', 'rct', 'review']);
  });

  it('records a visit against matching items: stages in progress, final stage completes', () => {
    const { ds, p, plan } = setup();
    const v1 = addEncounter(ds, '2026-06-02', [proc('rct', 4, ['46'], { stage: 1 }), proc('composite', 4, ['36'])], { patient: p });
    const u1 = applyEncounterToPlan(plan, v1);
    expect(u1.changes).toEqual(['RCT 46: stage 1 of 3 done (Access & extirpation); next: Cleaning & shaping', 'Composite 36: completed']);
    const rct = u1.plan.items.find((i) => i.id === 'rct')!;
    expect(rct).toMatchObject({ status: 'in_progress', stageDone: 1 });
    expect(stageText(rct)).toMatch(/stage 1 of 3/);
    expect(plan.items.find((i) => i.id === 'rct')!.status).toBe('planned'); // input not mutated

    const v2 = addEncounter(ds, '2026-06-16', [proc('rct', 4, ['46'], { stage: 3 })], { patient: p });
    const u2 = applyEncounterToPlan(u1.plan, v2);
    expect(u2.plan.items.find((i) => i.id === 'rct')).toMatchObject({ status: 'completed', completedOn: '2026-06-16', stageDone: 3 });
    // The plan itself stays active: closing it is the clinician's decision.
    expect(u2.plan.status).toBe('active');
    expect(planProgress(u2.plan)).toEqual({ done: 2, open: 2, total: 4 });
  });

  it('ignores visits for other teeth and procedures not in the plan', () => {
    const { ds, p, plan } = setup();
    const v = addEncounter(ds, '2026-06-02', [proc('rct', 4, ['11'], { stage: 3 }), proc('amalgam', 4, ['47'])], { patient: p });
    expect(applyEncounterToPlan(plan, v).changes).toEqual([]);
  });

  it('builds a next-visit brief from the record and the plan', () => {
    const { ds, p, plan } = setup();
    const v = addEncounter(ds, '2026-06-02', [proc('rct', 4, ['46'], { stage: 1 })], { patient: p });
    const updated = applyEncounterToPlan(plan, v).plan;
    const b = patientBrief(indexDataset(ds), p.id, [updated], '2026-06-12')!;
    expect(b.headline).toBe('Female · 35 years · systemic condition recorded');
    expect(b.lastVisit).toMatchObject({ date: '2026-06-02', summary: 'RCT 46 (stage 1)' });
    expect(b.inProgress).toEqual([{ label: 'RCT 46', detail: 'stage 1 of 3 done (Access & extirpation); next: Cleaning & shaping' }]);
    expect(b.next.map((n) => n.label)).toEqual(['Scaling', 'Composite 36', 'Exam + plan']);
    expect(b.alerts).toEqual(['Hypertension']);
  });

  it('lists items due soon or overdue, and treatment in progress', () => {
    const { ds, plan } = setup();
    const due = dueSoon(indexDataset(ds), [plan], '2026-06-10');
    expect(due.map((d) => [d.item.id, d.overdue])).toEqual([['rct', true]]);
  });

  it('hands over patients whose last visit was in the rotation and whose treatment is unfinished', () => {
    const { ds, p, plan } = setup();
    addEncounter(ds, '2026-06-02', [proc('rct', 4, ['46'], { stage: 1 })], { patient: p });
    const cons = ds.rotations.find((r) => r.rotation === 'CONS')!;
    const ix = indexDataset(ds);
    expect(handoverList(ix, [plan], cons).map((r) => r.patient?.id)).toEqual([p.id]);
    expect(handoverList(ix, [{ ...plan, status: 'completed' }], cons)).toEqual([]);
    expect(handoverList(ix, [plan], ds.rotations.find((r) => r.rotation === 'PER')!)).toEqual([]);
  });

  it('a review is completed by a later visit, not by the visit where the plan was agreed', () => {
    const { ds, p, plan } = setup();
    const same = addEncounter(ds, '2026-06-02', [proc('exam_plan', 3)], { patient: p });
    expect(applyEncounterToPlan(plan, same).changes).toEqual([]);
    const later = addEncounter(ds, '2026-08-03', [proc('exam_plan', 4)], { patient: p, visitType: 'review' });
    expect(applyEncounterToPlan(plan, later).changes).toEqual(['Exam + plan: completed']);
  });
});
