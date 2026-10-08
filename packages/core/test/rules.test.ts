import { describe, expect, it } from 'vitest';
import {
  buildRotationCalendar,
  checkRotationCalendar,
  checkVerificationChain,
  createVerification,
  DEFAULT_COUNTING_RULES,
  detectIdentifier,
  effectiveLevel,
  hasErrors,
  KMPDC_DENTAL_3,
  latestVerifications,
  rotationForDate,
  validateActivity,
  validateEncounter,
  validateReflection,
  type Encounter,
  type LogbookEntry,
  type Rotation,
  type Verification,
} from '../src';

describe('rotation calendar', () => {
  let i = 0;
  const rotations = buildRotationCalendar(KMPDC_DENTAL_3, 'int', '2025-10-13', ['OMF', 'PAED', 'PER', 'CONS', 'COMM'], () => `r${++i}`);

  it('builds 52 contiguous weeks', () => {
    expect(rotations.map((r) => [r.rotation, r.startsOn, r.endsOn])).toEqual([
      ['OMF', '2025-10-13', '2025-12-28'],
      ['PAED', '2025-12-29', '2026-03-15'],
      ['PER', '2026-03-16', '2026-05-31'],
      ['CONS', '2026-06-01', '2026-08-16'],
      ['COMM', '2026-08-17', '2026-10-11'],
    ]);
    expect(checkRotationCalendar(rotations, '2025-10-13')).toEqual([]);
  });

  it('assigns rotations by date at the boundaries', () => {
    expect(rotationForDate(rotations, '2025-12-28')?.rotation).toBe('OMF');
    expect(rotationForDate(rotations, '2025-12-29')?.rotation).toBe('PAED');
    expect(rotationForDate(rotations, '2025-10-12')).toBeNull();
    expect(rotationForDate(rotations, '2026-10-12')).toBeNull();
  });

  it('honours extensions', () => {
    const extended: Rotation[] = rotations.map((r) => (r.rotation === 'COMM' ? { ...r, extendedByDays: 14 } : r));
    expect(rotationForDate(extended, '2026-10-20')?.rotation).toBe('COMM');
  });

  it('detects overlaps and gaps', () => {
    const broken: Rotation[] = [
      { ...rotations[0]!, endsOn: '2026-01-05' },
      { ...rotations[1]! },
      { ...rotations[2]!, startsOn: '2026-03-25' },
    ];
    const kinds = checkRotationCalendar(broken, '2025-10-13').map((x) => x.kind);
    expect(kinds).toContain('overlap');
    expect(kinds).toContain('gap');
  });
});

describe('verification chain', () => {
  const entry = (id: string, level: 1 | 2 | 3 | 4 | 5 = 3): LogbookEntry => ({
    id,
    internshipId: 'int',
    requirementCode: 'OMF 2',
    rotationId: 'r',
    performedOn: '2025-11-01',
    patientRef: 'OP-1',
    site: '36',
    levelClaimed: level,
    status: 'submitted',
    rule: 'R3',
    createdAt: '',
    updatedAt: '',
  });
  const e1 = entry('e1', 4);
  const e2 = entry('e2');
  const v1 = createVerification(e1, { verifierId: 's', decision: 'verified', levelObserved: 3, method: 'pin' }, null, '2025-11-01T15:00:00Z', 'v1');
  const v2 = createVerification(e2, { verifierId: 's', decision: 'verified', method: 'pin' }, v1.hash, '2025-11-02T15:00:00Z', 'v2');
  const entries = new Map([
    ['e1', e1],
    ['e2', e2],
  ]);

  it('validates an intact chain', () => {
    expect(checkVerificationChain([v2, v1], entries)).toEqual([]);
  });

  it('detects an entry edited after verification', () => {
    const tampered = new Map(entries);
    tampered.set('e1', { ...e1, levelClaimed: 5 });
    expect(checkVerificationChain([v1, v2], tampered)).toEqual([{ verificationId: 'v1', problem: 'hash_mismatch' }]);
  });

  it('detects an altered or removed verification', () => {
    const altered: Verification = { ...v1, levelObserved: 5 };
    expect(checkVerificationChain([altered, v2], entries).map((p) => p.problem)).toContain('hash_mismatch');
    expect(checkVerificationChain([v2], entries).map((p) => p.problem)).toContain('broken_link');
  });

  it("uses the supervisor's observed level over the intern's claim (R2)", () => {
    const latest = latestVerifications([v1, v2]);
    expect(effectiveLevel(e1, latest)).toBe(3);
    expect(effectiveLevel(e2, latest)).toBe(3);
  });

  it('requires a comment when returning an entry', () => {
    expect(() => createVerification(e1, { verifierId: 's', decision: 'returned', method: 'pin' }, null, 't', 'v')).toThrow(/comment/);
  });
});

describe('data-quality checks', () => {
  let i = 0;
  const rotations = buildRotationCalendar(KMPDC_DENTAL_3, 'int', '2025-10-13', ['OMF', 'PAED', 'PER', 'CONS', 'COMM'], () => `r${++i}`);
  const base = (over: Partial<Encounter> = {}): Encounter => ({
    id: 'enc',
    internshipId: 'int',
    rotationId: rotations[0]!.id,
    date: '2025-11-03',
    patientId: 'p1',
    visitType: 'new',
    findings: [],
    investigations: [],
    procedures: [{ id: 'pr1', procedureTypeId: 'extraction', sites: ['36'], level: 3 }],
    createdAt: '',
    updatedAt: '',
    ...over,
  });
  const ctx = {
    today: '2025-11-03',
    internship: { periodFrom: '2025-10-13', periodTo: '2026-10-11' },
    rotations,
    rotation: 'OMF',
    patient: { id: 'p1', ref: 'OP-1', birthYear: 1990, createdAt: '' },
    rules: DEFAULT_COUNTING_RULES,
    others: [] as Encounter[],
  };
  const codes = (e: Encounter, over: Partial<typeof ctx> = {}) => validateEncounter(e, { ...ctx, ...over }).map((x) => x.code);

  it('accepts a normal entry without errors', () => {
    expect(hasErrors(validateEncounter(base(), ctx))).toBe(false);
  });

  it('rejects future dates, missing teeth and invalid FDI numbers', () => {
    expect(codes(base({ date: '2025-11-04' }))).toContain('future_date');
    expect(codes(base({ procedures: [{ id: 'x', procedureTypeId: 'extraction', sites: [], level: 3 }] }))).toContain('no_tooth');
    expect(codes(base({ procedures: [{ id: 'x', procedureTypeId: 'extraction', sites: ['19'], level: 3 }] }))).toContain('invalid_tooth');
  });

  it('rejects an empty encounter', () => {
    expect(codes(base({ procedures: [] }))).toContain('empty');
  });

  it('warns on dates outside the internship', () => {
    expect(codes(base({ date: '2025-10-01' }))).toContain('outside_internship');
  });

  it('flags late entries (R8)', () => {
    expect(codes(base({ date: '2025-10-28' }))).toContain('late_entry');
    expect(codes(base({ date: '2025-11-01' }))).not.toContain('late_entry');
  });

  it('detects likely duplicates', () => {
    expect(codes(base(), { others: [base({ id: 'other' })] })).toContain('possible_duplicate');
    expect(codes(base(), { others: [base({ id: 'other', procedures: [{ id: 'y', procedureTypeId: 'extraction', sites: ['46'], level: 3 }] })] })).not.toContain(
      'possible_duplicate',
    );
  });

  it('flags procedures unusual for the rotation', () => {
    expect(codes(base({ procedures: [{ id: 'x', procedureTypeId: 'scaling_polishing', sites: [], level: 3 }] }))).toContain('unusual_for_rotation');
  });

  it('flags primary teeth recorded for adults', () => {
    expect(codes(base({ procedures: [{ id: 'x', procedureTypeId: 'extraction', sites: ['75'], level: 3 }] }))).toContain('primary_tooth_adult');
  });

  it('warns when free text appears to contain patient identifiers', () => {
    expect(detectIdentifier('Call 0712345678 tomorrow')).toBe('a phone number');
    expect(detectIdentifier('Seen with Mrs Wanjiku')).toBe("a person's name");
    expect(detectIdentifier('ID 12345678')).toBe('an ID number');
    expect(detectIdentifier('Tooth 36 extracted, socket healing')).toBeNull();
    expect(detectIdentifier('OP-26-04417')).toBeNull();
    expect(codes(base({ notes: 'Patient name: Kamau, phone +254712345678' }))).toContain('possible_identifier');
  });

  it('validates community activities need their item', () => {
    const act = { id: 'a', internshipId: 'int', rotationId: null, date: '2025-11-03', activityTypeId: 'community_activity', level: 4 as const, createdAt: '', updatedAt: '' };
    const res = validateActivity(act, { ...ctx, others: [] });
    expect(res.map((x) => x.code)).toContain('community_item');
  });

  it('requires some text in a reflection', () => {
    const r = { id: 'r', internshipId: 'int', date: '2025-11-03', title: '', tags: [], sharedWithSupervisor: false, createdAt: '', updatedAt: '' };
    expect(hasErrors(validateReflection(r, '2025-11-03'))).toBe(true);
    expect(hasErrors(validateReflection({ ...r, title: 'Difficult extraction' }, '2025-11-03'))).toBe(false);
  });
});
