import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COUNTING_RULES,
  deriveActivity,
  deriveEncounter,
  KMPDC_DENTAL_3,
  reconcileEntries,
  type Activity,
  type CountingRules,
  type Encounter,
  type EncounterProcedure,
  type LogbookEntry,
  type Patient,
} from '../src';

const adult: Patient = { id: 'p-adult', ref: 'OP-1', birthYear: 1990, createdAt: '' };
const child: Patient = { id: 'p-child', ref: 'OP-2', birthYear: 2016, createdAt: '' };
const systemic: Patient = { id: 'p-sys', ref: 'OP-3', birthYear: 1960, systemicCondition: true, createdAt: '' };

let seq = 0;
const p = (procedureTypeId: string, sites: string[] = [], extra: Partial<EncounterProcedure> = {}): EncounterProcedure => ({
  id: `proc-${++seq}`,
  procedureTypeId,
  sites,
  level: 3,
  ...extra,
});

const enc = (procedures: EncounterProcedure[], diagnosis = true): Encounter => ({
  id: 'enc-1',
  internshipId: 'int',
  rotationId: 'rot',
  date: '2026-03-01',
  patientId: 'p',
  visitType: 'new',
  findings: diagnosis ? [{ term: 'Irreversible pulpitis', isDiagnosis: true }] : [],
  investigations: [],
  procedures,
  createdAt: '',
  updatedAt: '',
});

const derive = (procs: EncounterProcedure[], rotation: string, patient: Patient | null = adult, opts: { diagnosis?: boolean; rules?: Partial<CountingRules> } = {}) =>
  deriveEncounter(enc(procs, opts.diagnosis ?? true), {
    set: KMPDC_DENTAL_3,
    rules: { ...DEFAULT_COUNTING_RULES, ...opts.rules },
    rotation,
    patient,
  });

const codes = (d: ReturnType<typeof derive>) => d.entries.map((e) => e.requirementCode);

describe('procedure → code mapping (blueprint §12.1, §12.3)', () => {
  it('"Patient attended for extraction of 36" → OMF 2 in the OMF rotation', () => {
    const d = derive([p('extraction', ['36'])], 'OMF');
    expect(codes(d)).toEqual(['OMF 2']);
    expect(d.entries[0]!.site).toBe('36');
    expect(d.entries[0]!.rule).toContain('R3');
  });

  it('extraction in the paediatric rotation → PAED 2 for a child, nothing for an adult', () => {
    expect(codes(derive([p('extraction', ['75'])], 'PAED', child))).toEqual(['PAED 2']);
    const adultResult = derive([p('extraction', ['36'])], 'PAED', adult);
    expect(adultResult.entries).toHaveLength(0);
    expect(adultResult.notes[0]!.message).toMatch(/not under 17/);
  });

  it('paediatric codes need a birth year', () => {
    const d = derive([p('pulpotomy', ['84'])], 'PAED', { id: 'x', ref: 'OP-9', createdAt: '' });
    expect(d.entries).toHaveLength(0);
    expect(d.notes[0]!.message).toMatch(/birth year/);
  });

  it('extraction during periodontology counts toward no code under R1, but with R1 off counts as OMF 2', () => {
    const scoped = derive([p('extraction', ['36'])], 'PER');
    expect(scoped.entries).toHaveLength(0);
    expect(scoped.notes[0]!.message).toMatch(/R1/);
    expect(codes(derive([p('extraction', ['36'])], 'PER', adult, { rules: { rotationScope: false } }))).toEqual(['OMF 2']);
  });

  it('counts one entry per tooth for tooth procedures (R3)', () => {
    expect(codes(derive([p('extraction', ['36', '37'])], 'OMF'))).toEqual(['OMF 2', 'OMF 2']);
  });

  it('classifies tooth-coloured restorations by FDI tooth class', () => {
    expect(codes(derive([p('composite', ['11'])], 'CONS'))).toEqual(['CONS 02']);
    expect(codes(derive([p('composite', ['36'])], 'CONS'))).toEqual(['CONS 01']);
    expect(codes(derive([p('gic', ['13', '14'])], 'CONS'))).toEqual(['CONS 02', 'CONS 01']);
    expect(codes(derive([p('amalgam', ['46'])], 'CONS'))).toEqual(['CONS 06']);
  });

  it('counts RCT once, at obturation (R4) — "Patient reviewed after RCT on 46" counts nothing', () => {
    const stage1 = derive([p('rct', ['46'], { stage: 1 })], 'CONS');
    expect(stage1.entries).toHaveLength(0);
    expect(stage1.notes[0]!.message).toMatch(/final stage/);
    expect(codes(derive([p('rct', ['46'], { stage: 3 })], 'CONS'))).toEqual(['CONS 03']);
    expect(codes(derive([p('rct', ['46'], { stage: 1 })], 'CONS', adult, { rules: { finalStageOnly: false } }))).toEqual(['CONS 03']);
  });

  it('crown and bridge counts at cementation', () => {
    expect(derive([p('crown_bridge', ['21'], { stage: 1 })], 'CONS').entries).toHaveLength(0);
    expect(codes(derive([p('crown_bridge', ['21'], { stage: 2 })], 'CONS'))).toEqual(['CONS 04']);
  });

  it('OMF 1 needs a recorded diagnosis (R5); PER 01 does not', () => {
    expect(derive([p('exam_plan')], 'OMF', adult, { diagnosis: false }).entries).toHaveLength(0);
    expect(codes(derive([p('exam_plan')], 'OMF'))).toEqual(['OMF 1']);
    expect(codes(derive([p('exam_plan')], 'PER', adult, { diagnosis: false }))).toEqual(['PER 01']);
  });

  it('scaling in a patient with a systemic condition → PER 02; otherwise PER 03', () => {
    expect(codes(derive([p('scaling_polishing')], 'PER', systemic))).toEqual(['PER 02']);
    expect(codes(derive([p('scaling_polishing')], 'PER', adult))).toEqual(['PER 03']);
    expect(codes(derive([p('scaling_polishing')], 'PER', systemic, { rules: { preferSystemicCode: false } }))).toEqual(['PER 03']);
  });

  it('counts per-visit codes once per encounter (R6)', () => {
    const d = derive([p('scaling_polishing'), p('root_planing')], 'PER', adult);
    expect(codes(d)).toEqual(['PER 03']);
    expect(d.notes.some((n) => /already counted/.test(n.message))).toBe(true);
    // Different codes in one visit are fine: OMF 1 + OMF 2.
    expect(codes(derive([p('exam_plan'), p('extraction', ['48'])], 'OMF'))).toEqual(['OMF 1', 'OMF 2']);
  });

  it('pools paediatric preventive procedures into one PAED 7 per visit', () => {
    expect(codes(derive([p('fissure_sealant', ['16', '26']), p('fluoride')], 'PAED', child))).toEqual(['PAED 7']);
  });

  it('records uncoded competencies as exposure, never as a code (G1, G2)', () => {
    const d = derive([p('partial_denture'), p('ortho_assessment')], 'CONS');
    expect(d.entries).toHaveLength(0);
    expect(d.notes.map((n) => n.uncoded)).toEqual(['PROS-2', 'ORTHO-1']);
  });

  it('never invents a diagnosis from a procedure', () => {
    const e = enc([p('extraction', ['36'])], false);
    deriveEncounter(e, { set: KMPDC_DENTAL_3, rules: DEFAULT_COUNTING_RULES, rotation: 'OMF', patient: adult });
    expect(e.findings).toEqual([]);
  });
});

describe('activity → code mapping', () => {
  const act = (activityTypeId: string, extra: Partial<Activity> = {}): Activity => ({
    id: 'a-1',
    internshipId: 'int',
    rotationId: 'rot',
    date: '2026-09-01',
    activityTypeId,
    level: 4,
    createdAt: '',
    updatedAt: '',
    ...extra,
  });
  const run = (a: Activity, rotation: string) => deriveActivity(a, { set: KMPDC_DENTAL_3, rules: DEFAULT_COUNTING_RULES, rotation });

  it('maps OMF activities without a patient (R9)', () => {
    expect(run(act('postmortem', { level: 1 }), 'OMF').entries[0]!.requirementCode).toBe('OMF 19');
    expect(run(act('emergency_call'), 'OMF').entries[0]!.requirementCode).toBe('OMF 18');
    expect(run(act('diagnostic_session'), 'OMF').entries[0]!.requirementCode).toBe('OMF 10');
  });

  it('maps case presentations to OMF 1 in OMF and CONS 07 in CONS', () => {
    expect(run(act('case_presentation'), 'OMF').entries[0]!.requirementCode).toBe('OMF 1');
    expect(run(act('case_presentation'), 'CONS').entries[0]!.requirementCode).toBe('CONS 07');
    expect(run(act('case_presentation'), 'PER').entries).toHaveLength(0);
  });

  it('maps community items, case steps and weekly reports only during COMM', () => {
    expect(run(act('community_activity', { communityItem: 3 }), 'COMM').entries[0]!.requirementCode).toBe('COMM A03');
    expect(run(act('community_case_step', { caseType: 'hiv', caseSlot: 1, followUpStep: 'genogram' }), 'COMM').entries[0]!.requirementCode).toBe('COMM C-hiv');
    expect(run(act('weekly_report', { weeklyReportNo: 2 }), 'COMM').entries[0]!.requirementCode).toBe('COMM W');
    expect(run(act('community_activity', { communityItem: 3 }), 'OMF').entries).toHaveLength(0);
  });

  it('CPD is recorded but has no code', () => {
    expect(run(act('cpd'), 'OMF').entries).toHaveLength(0);
  });
});

describe('reconciling edits with stored entries', () => {
  const base = { internshipId: 'int', rotationId: 'rot', performedOn: '2026-03-01', encounterId: 'enc-1', patientRef: 'OP-1', supervisorId: 's', status: 'submitted' as const };
  let n = 0;
  const makeId = () => `e-${++n}`;
  const first = derive([p('extraction', ['36'], { id: 'proc-x' })], 'OMF');
  const created = reconcileEntries(first.entries, [], base, 't0', makeId).create;

  it('creates entries on first save', () => {
    expect(created).toHaveLength(1);
    expect(created[0]!.status).toBe('submitted');
  });

  it('keeps the entry id when only the level changes', () => {
    const again = derive([p('extraction', ['36'], { id: 'proc-x', level: 5 })], 'OMF');
    const rec = reconcileEntries(again.entries, created, base, 't1', makeId);
    expect(rec.create).toHaveLength(0);
    expect(rec.update).toHaveLength(1);
    expect(rec.update[0]!.id).toBe(created[0]!.id);
    expect(rec.update[0]!.levelClaimed).toBe(5);
  });

  it('withdraws unverified entries that no longer apply', () => {
    const rec = reconcileEntries([], created, base, 't1', makeId);
    expect(rec.withdraw).toHaveLength(1);
    expect(rec.withdraw[0]!.status).toBe('withdrawn');
  });

  it('never changes verified entries: it reports a conflict needing a correction', () => {
    const verified: LogbookEntry[] = created.map((e) => ({ ...e, status: 'verified' }));
    const again = derive([p('extraction', ['36'], { id: 'proc-x', level: 5 })], 'OMF');
    const rec = reconcileEntries(again.entries, verified, base, 't1', makeId);
    expect(rec.update).toHaveLength(0);
    expect(rec.conflicts).toHaveLength(1);
    expect(reconcileEntries([], verified, base, 't1', makeId).conflicts).toHaveLength(1);
  });

  it('sends a fixed returned entry back for verification', () => {
    const returned: LogbookEntry[] = created.map((e) => ({ ...e, status: 'returned' }));
    const again = derive([p('extraction', ['36'], { id: 'proc-x', level: 4 })], 'OMF');
    expect(reconcileEntries(again.entries, returned, base, 't1', makeId).update[0]!.status).toBe('submitted');
  });
});
