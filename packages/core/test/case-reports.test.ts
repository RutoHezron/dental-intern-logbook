import { describe, expect, it } from 'vitest';
import {
  buildRotationPrint,
  caseReportQueue,
  checkVerificationChain,
  createCaseReportVerification,
  draftCaseReportFromVisits,
  indexDataset,
  validateCaseReport,
  type CaseReport,
  type RotationPrint,
} from '../src';
import { generateDemoDataset } from '../src/synthetic';
import { addEncounter, addPatient, emptyDataset, proc } from './fixtures';

const report = (over: Partial<CaseReport> = {}): CaseReport => ({
  id: 'cr-1',
  internshipId: 'int-1',
  rotationId: 'rot-1',
  date: '2025-11-10',
  title: 'Irreversible pulpitis managed with extraction',
  patientId: null,
  encounterIds: [],
  sections: { dx: 'Irreversible pulpitis 36', mx: 'Extraction 36', disc: 'Learned to plan sectioning early.' },
  status: 'draft',
  supervisorId: 'sup-1',
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('case reports', () => {
  it('drafts the facts from linked visits without copying the hospital number', () => {
    const ds = emptyDataset();
    const p = addPatient(ds, { ref: 'OP-25-77777', birthYear: 1980, sex: 'F' });
    const e1 = addEncounter(ds, '2025-11-03', [proc('exam_plan', 3), proc('extraction', 4, ['36'])], { patient: p });
    e1.complaint = 'Pain lower left for 3 days';
    e1.investigations.push({ kind: 'IOPA', site: '36' });
    const e2 = addEncounter(ds, '2025-11-10', [proc('dry_socket', 3, ['36'])], { patient: p, visitType: 'review' });
    const d = draftCaseReportFromVisits(indexDataset(ds), [e2.id, e1.id]);
    expect(d.title).toBe('Dental caries managed with extraction');
    expect(d.sections.pc).toMatch(/^Female, aged 45\. Pain lower left for 3 days/);
    expect(d.sections.inv).toBe('IOPA 36');
    expect(d.sections.mx).toContain('3 Nov 2025: Extraction (forceps / elevator) — 36; performed under indirect supervision.');
    expect(d.sections.mx).toContain('10 Nov 2025: Dry socket (alveolar osteitis) management — 36; performed under direct supervision.');
    expect(d.date).toBe('2025-11-10');
    expect(JSON.stringify(d.sections)).not.toContain('OP-25-77777');
    expect(d.sections.disc).toBeUndefined(); // the intern writes the discussion
  });

  it('needs diagnosis, management, discussion and a supervisor before sending for verification', () => {
    expect(validateCaseReport(report(), '2025-11-12', true)).toEqual([]);
    const missing = validateCaseReport(report({ sections: {}, supervisorId: null }), '2025-11-12', true).map((i) => i.ref);
    expect(missing).toEqual(['dx', 'mx', 'disc', 'supervisor']);
    // A draft can be saved incomplete.
    expect(validateCaseReport(report({ sections: {} }), '2025-11-12', false)).toEqual([]);
    expect(validateCaseReport(report({ title: ' ' }), '2025-11-12', false).map((i) => i.code)).toEqual(['no_title']);
  });

  it('warns when a report looks like it identifies the patient', () => {
    const issues = validateCaseReport(report({ sections: { pc: 'Mrs Achieng, phone 0722123456' } }), '2025-11-12', false);
    expect(issues.map((i) => i.code)).toContain('possible_identifier');
  });

  it('chains case report verifications with entry verifications and detects later edits', () => {
    const r = report({ status: 'submitted' });
    const v = createCaseReportVerification(r, { verifierId: 'sup-1', decision: 'verified', method: 'pin' }, null, '2025-11-12T10:00:00Z', 'v1');
    expect(v.caseReportId).toBe('cr-1');
    expect(v.entryId).toBeUndefined();
    expect(checkVerificationChain([v], new Map(), new Map([[r.id, r]]))).toEqual([]);
    const edited = { ...r, sections: { ...r.sections, disc: 'Rewritten later' } };
    expect(checkVerificationChain([v], new Map(), new Map([[r.id, edited]]))).toEqual([{ verificationId: 'v1', problem: 'hash_mismatch' }]);
    expect(() => createCaseReportVerification(r, { verifierId: 's', decision: 'returned', method: 'pin' }, null, 't', 'v2')).toThrow(/comment/);
  });

  it('queues submitted reports per supervisor, oldest first', () => {
    const q = caseReportQueue([report({ id: 'a', status: 'submitted', date: '2025-11-12' }), report({ id: 'b', status: 'submitted', date: '2025-11-01' }), report({ id: 'c', status: 'draft' })], 'sup-1');
    expect(q.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('fills the printed Log of Case Reports with verified reports', () => {
    const ds = generateDemoDataset();
    const omf = ds.rotations[0]!;
    const p = buildRotationPrint(indexDataset(ds), omf.id, { includePending: false, fillToBookRows: true, printedOn: '2026-10-09' }, 'X') as RotationPrint;
    const verified = (ds.caseReports ?? []).filter((r) => r.rotationId === omf.id && r.status === 'verified');
    expect(verified.length).toBeGreaterThanOrEqual(7);
    expect(p.caseReports.length).toBeGreaterThanOrEqual(10);
    expect(p.caseReports.filter((r) => r.title).length).toBe(verified.length);
    expect(p.caseReports[0]!.verificationRef).toMatch(/^[0-9a-f]{8}$/);
    expect(p.verificationLog.some((l) => l.code === 'Case report')).toBe(true);
  });
});
