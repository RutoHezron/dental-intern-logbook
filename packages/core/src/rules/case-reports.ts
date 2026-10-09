import { getProcedureType } from '../catalogue/procedures';
import type { DatasetIndex } from '../analytics/dataset-index';
import type { CaseReport, ID, ISODate } from '../types';
import { ageOnDate, displayDate, isValidDate } from '../util/dates';
import { detectIdentifier, type Issue } from './validation';

/**
 * Case reports (KMPDC 5.x.5). The logbook gives ten rows per rotation and no
 * template (G11); these sections follow a conventional clinical case report.
 */

export const CASE_REPORTS_PER_ROTATION = 10;

export const CASE_REPORT_SECTIONS: { id: string; label: string; hint: string; required: boolean }[] = [
  { id: 'pc', label: 'Presenting complaint', hint: 'In the patient’s words, with duration', required: false },
  { id: 'hx', label: 'History', hint: 'Dental, medical, social — relevant points only', required: false },
  { id: 'ex', label: 'Examination', hint: 'Extra-oral and intra-oral findings', required: false },
  { id: 'inv', label: 'Investigations', hint: 'Radiographs, tests and what they showed', required: false },
  { id: 'dx', label: 'Diagnosis', hint: 'Final and differential diagnoses', required: true },
  { id: 'mx', label: 'Management', hint: 'Treatment provided, with dates and your level', required: true },
  { id: 'out', label: 'Outcome and follow-up', hint: 'Review findings, referral, plan', required: false },
  { id: 'disc', label: 'Discussion and learning points', hint: 'What this case teaches; link to the literature', required: true },
  { id: 'ref', label: 'References', hint: 'Optional', required: false },
];

/** Lower-case a name for use mid-sentence, keeping acronyms such as RCT or GIC. */
const inSentence = (name: string) => (/^[A-Z][a-z]/.test(name) ? name[0]!.toLowerCase() + name.slice(1) : name);

const LEVEL_WORDS = ['', 'observed', 'assisted', 'under direct supervision', 'under indirect supervision', 'independently'];

/**
 * A first draft from the visits the intern selected. It restates recorded
 * facts only — the intern writes the discussion. No patient identifiers are
 * added: age is given in years and the hospital number is left out.
 */
export function draftCaseReportFromVisits(ix: DatasetIndex, encounterIds: ID[]): Pick<CaseReport, 'title' | 'sections' | 'patientId' | 'date' | 'rotationId' | 'encounterIds'> {
  const visits = ix.encounters.filter((e) => encounterIds.includes(e.id)).sort((a, b) => a.date.localeCompare(b.date));
  if (!visits.length) return { title: '', sections: {}, patientId: null, date: '', rotationId: null, encounterIds: [] };
  const first = visits[0]!;
  const last = visits.at(-1)!;
  const patient = first.patientId ? ix.patients.get(first.patientId) : undefined;
  const who = [
    patient?.sex === 'F' ? 'Female' : patient?.sex === 'M' ? 'Male' : 'Patient',
    patient?.birthYear ? `aged ${ageOnDate(patient.birthYear, first.date)}` : null,
    patient?.systemicCondition ? 'with a recorded systemic condition' : null,
  ]
    .filter(Boolean)
    .join(', ');
  const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x?.trim())))];
  const diagnoses = uniq(visits.flatMap((v) => v.findings.filter((f) => f.isDiagnosis).map((f) => (f.site ? `${f.term} (${f.site})` : f.term))));
  const findings = uniq(visits.flatMap((v) => v.findings.filter((f) => !f.isDiagnosis).map((f) => (f.site ? `${f.term} (${f.site})` : f.term))));
  const investigations = uniq(visits.flatMap((v) => v.investigations.map((i) => (i.site ? `${i.kind} ${i.site}` : i.kind))));
  const management = visits.flatMap((v) =>
    v.procedures.map((p) => {
      const t = getProcedureType(p.procedureTypeId);
      const name = p.otherName ?? t?.name ?? p.procedureTypeId;
      const stage = p.stage && t?.stageNames ? ` (${t.stageNames[p.stage - 1] ?? `stage ${p.stage}`})` : '';
      return `${displayDate(v.date)}: ${name}${stage}${p.sites.length ? ` — ${p.sites.join(', ')}` : ''}; performed ${LEVEL_WORDS[p.level]}.`;
    }),
  );
  const outcome = uniq(visits.flatMap((v) => [v.referredTo ? `Referred to ${v.referredTo}.` : undefined, v.followUpNeeded ? `Follow-up planned after ${displayDate(v.date)}.` : undefined]));
  // Name the treatment, not the examination.
  const treatment = visits.flatMap((v) => v.procedures).find((p) => getProcedureType(p.procedureTypeId)?.category !== 'diagnosis');
  const mainProcedure = treatment ? getProcedureType(treatment.procedureTypeId)?.shortName ?? treatment.otherName : undefined;
  return {
    title: diagnoses[0] ? `${diagnoses[0].replace(/ \(.+\)$/, '')}${mainProcedure ? ` managed with ${inSentence(mainProcedure)}` : ''}` : '',
    sections: {
      pc: uniq([who ? `${who}.` : undefined, ...visits.map((v) => v.complaint)]).join(' '),
      ex: findings.join('; '),
      inv: investigations.join('; '),
      dx: diagnoses.join('; '),
      mx: management.join('\n'),
      out: outcome.join(' '),
    },
    patientId: first.patientId,
    date: last.date,
    rotationId: last.rotationId,
    encounterIds: visits.map((v) => v.id),
  };
}

/** Errors block saving (or submitting, when `forSubmission`); warnings are shown. */
export function validateCaseReport(r: CaseReport, today: ISODate, forSubmission: boolean): Issue[] {
  const issues: Issue[] = [];
  if (!r.title.trim()) issues.push({ level: 'error', code: 'no_title', ref: 'title', message: 'Give the case a short description (it is printed in the logbook).' });
  if (!isValidDate(r.date)) issues.push({ level: 'error', code: 'invalid_date', ref: 'date', message: 'Enter a valid date.' });
  else if (r.date > today) issues.push({ level: 'error', code: 'future_date', ref: 'date', message: 'The date is in the future.' });
  if (forSubmission) {
    for (const s of CASE_REPORT_SECTIONS.filter((x) => x.required)) {
      if (!r.sections[s.id]?.trim()) issues.push({ level: 'error', code: 'missing_section', ref: s.id, message: `Complete "${s.label}" before sending for verification.` });
    }
    if (!r.supervisorId) issues.push({ level: 'error', code: 'no_supervisor', ref: 'supervisor', message: 'Choose the supervisor who will verify this report.' });
  }
  for (const [id, text] of Object.entries({ title: r.title, ...r.sections })) {
    const what = detectIdentifier(text);
    if (what) {
      const label = CASE_REPORT_SECTIONS.find((s) => s.id === id)?.label ?? 'Title';
      issues.push({ level: 'warning', code: 'possible_identifier', ref: id, message: `"${label}" looks like it contains ${what}. Case reports must not identify the patient.` });
    }
  }
  return issues;
}

/** Case reports awaiting a supervisor's decision, oldest first. */
export function caseReportQueue(reports: CaseReport[], supervisorId?: ID | null): CaseReport[] {
  return reports
    .filter((r) => !r.deletedAt && r.status === 'submitted' && (supervisorId === undefined || (r.supervisorId ?? null) === supervisorId))
    .sort((a, b) => a.date.localeCompare(b.date));
}
