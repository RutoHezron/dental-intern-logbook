import { getActivityType, getProcedureType } from '../catalogue/procedures';
import type { Activity, CountingRules, Encounter, ISODate, Patient, Reflection, Rotation, RotationCode } from '../types';
import { ageOnDate, daysBetween, isValidDate } from '../util/dates';
import { isPrimaryTooth, isValidFdi } from '../util/fdi';
import { rotationForDate } from './rotations';

/**
 * Data-quality checks (brief §28, blueprint §13.1). Errors block saving;
 * warnings are shown to the intern and, where useful, to the supervisor.
 * Checks are prompts, not accusations.
 */

export type IssueLevel = 'error' | 'warning' | 'info';

export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
  /** Item the issue refers to (procedure id, field name). */
  ref?: string;
}

// ---------------------------------------------------------------------------
// Privacy guard: free text must not carry patient identifiers
// ---------------------------------------------------------------------------

const PII_PATTERNS: { re: RegExp; what: string }[] = [
  { re: /(?:\+?254|\b0)[17]\d{8}\b/, what: 'a phone number' },
  { re: /\b\d{3}[\s-]?\d{3}[\s-]?\d{3,4}\b/, what: 'a phone number' },
  { re: /\b\d{7,8}\b/, what: 'an ID number' },
  { re: /[\w.+-]+@[\w-]+\.[\w.]+/, what: 'an email address' },
  { re: /\b(?:Mr|Mrs|Ms|Miss|Mzee|Mama|Baba)\.?\s+[A-Z][a-z]+/, what: 'a person\'s name' },
  { re: /\b(?:name|named|called)\s*[:=]?\s*[A-Z][a-z]+/i, what: 'a person\'s name' },
];

/** Returns what kind of identifier a text appears to contain, or null. */
export function detectIdentifier(text: string | undefined | null): string | null {
  if (!text) return null;
  for (const p of PII_PATTERNS) if (p.re.test(text)) return p.what;
  return null;
}

function piiIssues(fields: Record<string, string | undefined>): Issue[] {
  const issues: Issue[] = [];
  for (const [field, text] of Object.entries(fields)) {
    const what = detectIdentifier(text);
    if (what) {
      issues.push({
        level: 'warning',
        code: 'possible_identifier',
        message: `"${field}" looks like it contains ${what}. Use the hospital number only — no names, phones or IDs.`,
        ref: field,
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function dateIssues(date: ISODate, today: ISODate, internship: { periodFrom: ISODate; periodTo: ISODate }, rotations: Rotation[]): Issue[] {
  const issues: Issue[] = [];
  if (!isValidDate(date)) return [{ level: 'error', code: 'invalid_date', message: 'Enter a valid date.', ref: 'date' }];
  if (date > today) issues.push({ level: 'error', code: 'future_date', message: 'The date is in the future.', ref: 'date' });
  if (date < internship.periodFrom || date > internship.periodTo) {
    issues.push({ level: 'warning', code: 'outside_internship', message: 'The date is outside the internship period.', ref: 'date' });
  } else if (!rotationForDate(rotations, date)) {
    issues.push({ level: 'warning', code: 'outside_rotation', message: 'No rotation covers this date; entries will not count toward a code.', ref: 'date' });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Encounters
// ---------------------------------------------------------------------------

export interface EncounterCheckContext {
  today: ISODate;
  /** Date the entry is being logged (defaults to today), for late-entry checks. */
  loggedOn?: ISODate;
  internship: { periodFrom: ISODate; periodTo: ISODate };
  rotations: Rotation[];
  rotation: RotationCode | null;
  patient: Patient | null;
  rules: CountingRules;
  /** Other encounters, for duplicate detection. */
  others: Encounter[];
}

export function validateEncounter(e: Encounter, ctx: EncounterCheckContext): Issue[] {
  const issues: Issue[] = [...dateIssues(e.date, ctx.today, ctx.internship, ctx.rotations)];

  if (e.procedures.length === 0 && e.findings.length === 0) {
    issues.push({ level: 'error', code: 'empty', message: 'Add at least one procedure or finding.' });
  }

  const loggedOn = ctx.loggedOn ?? ctx.today;
  if (isValidDate(e.date) && daysBetween(e.date, loggedOn) > ctx.rules.lateEntryDays) {
    issues.push({
      level: 'warning',
      code: 'late_entry',
      message: `Logged ${daysBetween(e.date, loggedOn)} days after the procedure; your supervisor will see a late-entry flag (R8).`,
    });
  }

  if (!e.patientId) {
    const needsPatient = e.procedures.some((p) => getProcedureType(p.procedureTypeId)?.mappings.length);
    if (needsPatient) {
      issues.push({ level: 'warning', code: 'no_patient', message: 'No patient number: the paper logbook needs one for each procedure row.', ref: 'patient' });
    }
  }

  const age = ctx.patient?.birthYear && isValidDate(e.date) ? ageOnDate(ctx.patient.birthYear, e.date) : null;

  for (const p of e.procedures) {
    const type = getProcedureType(p.procedureTypeId);
    if (!type) {
      issues.push({ level: 'error', code: 'unknown_procedure', message: 'Unknown procedure.', ref: p.id });
      continue;
    }
    if (!p.level) issues.push({ level: 'error', code: 'no_level', message: `${type.shortName}: choose your participation level.`, ref: p.id });
    if (type.id === 'other' && !p.otherName?.trim()) {
      issues.push({ level: 'error', code: 'other_unnamed', message: 'Name the "Other" procedure.', ref: p.id });
    }
    if (type.siteKind === 'tooth') {
      if (p.sites.length === 0) {
        issues.push({ level: 'error', code: 'no_tooth', message: `${type.shortName}: select the tooth (FDI).`, ref: p.id });
      }
      for (const s of p.sites) {
        if (!isValidFdi(s)) {
          issues.push({ level: 'error', code: 'invalid_tooth', message: `${s} is not a valid FDI tooth number.`, ref: p.id });
        } else if (age !== null && age >= 14 && isPrimaryTooth(s)) {
          issues.push({ level: 'warning', code: 'primary_tooth_adult', message: `Tooth ${s} is a primary tooth but the patient is ${age}.`, ref: p.id });
        }
      }
      const unusualVolume = type.category === 'oral_surgery' ? 6 : 8;
      if (p.sites.length > unusualVolume) {
        issues.push({
          level: 'warning',
          code: 'unusual_volume',
          message: `${p.sites.length} teeth for one ${type.shortName.toLowerCase()} — please double-check.`,
          ref: p.id,
        });
      }
    }
    if (type.stages > 1 && p.stage !== undefined && (p.stage < 1 || p.stage > type.stages)) {
      issues.push({ level: 'error', code: 'invalid_stage', message: `${type.shortName}: stage must be 1–${type.stages}.`, ref: p.id });
    }
    if (ctx.rotation && type.typicalRotations.length > 0 && !type.typicalRotations.includes(ctx.rotation) && ctx.rules.rotationScope) {
      issues.push({
        level: 'info',
        code: 'unusual_for_rotation',
        message: `${type.shortName} is unusual in the ${ctx.rotation} rotation; it is recorded as exposure but will not count toward a code (R1).`,
        ref: p.id,
      });
    }
    const paedMapping = type.mappings.some((m) => m.when.maxAgeExclusive !== undefined && m.when.rotation === ctx.rotation);
    if (paedMapping && !ctx.patient?.birthYear) {
      issues.push({ level: 'warning', code: 'paed_no_birth_year', message: 'Add the patient\'s birth year so paediatric codes can be applied (R7).', ref: 'patient' });
    }
  }

  // Duplicate detection: same patient, day, procedure and site.
  for (const other of ctx.others) {
    if (other.id === e.id || other.deletedAt || other.date !== e.date || !e.patientId || other.patientId !== e.patientId) continue;
    for (const p of e.procedures) {
      const dup = other.procedures.find(
        (q) => q.procedureTypeId === p.procedureTypeId && q.sites.join(',') === p.sites.join(',') && (q.stage ?? 1) === (p.stage ?? 1),
      );
      if (dup) {
        issues.push({
          level: 'warning',
          code: 'possible_duplicate',
          message: `A matching ${getProcedureType(p.procedureTypeId)?.shortName ?? 'procedure'} for this patient on this day is already logged.`,
          ref: p.id,
        });
      }
    }
  }

  issues.push(
    ...piiIssues({
      complaint: e.complaint,
      notes: e.notes,
      referral: e.referredTo,
      findings: e.findings.map((f) => f.term).join(' '),
      procedures: e.procedures.map((p) => `${p.notes ?? ''} ${p.otherName ?? ''}`).join(' '),
    }),
  );
  return dedupeIssues(issues);
}

export function validateActivity(a: Activity, ctx: Omit<EncounterCheckContext, 'patient' | 'others'> & { others: Activity[] }): Issue[] {
  const issues: Issue[] = [...dateIssues(a.date, ctx.today, ctx.internship, ctx.rotations)];
  const type = getActivityType(a.activityTypeId);
  if (!type) return [...issues, { level: 'error', code: 'unknown_activity', message: 'Choose an activity type.' }];
  if (type.needs === 'community_item' && !(a.communityItem && a.communityItem >= 1 && a.communityItem <= 16)) {
    issues.push({ level: 'error', code: 'community_item', message: 'Choose which community activity (1–16).' });
  }
  if (type.needs === 'community_case' && (!a.caseType || !a.caseSlot || !a.followUpStep)) {
    issues.push({ level: 'error', code: 'community_case', message: 'Choose the case type, case number and follow-up step.' });
  }
  if (type.needs === 'weekly_report' && !(a.weeklyReportNo && a.weeklyReportNo >= 1 && a.weeklyReportNo <= 8)) {
    issues.push({ level: 'error', code: 'weekly_report', message: 'Choose the weekly report number (1–8).' });
  }
  if (type.fixedLevel && a.level !== type.fixedLevel) {
    issues.push({ level: 'info', code: 'fixed_level', message: `The logbook expects level ${type.fixedLevel} for this activity.` });
  }
  const loggedOn = ctx.loggedOn ?? ctx.today;
  if (isValidDate(a.date) && daysBetween(a.date, loggedOn) > ctx.rules.lateEntryDays) {
    issues.push({ level: 'warning', code: 'late_entry', message: `Logged ${daysBetween(a.date, loggedOn)} days after the activity (R8).` });
  }
  const dup = ctx.others.find(
    (o) =>
      o.id !== a.id &&
      !o.deletedAt &&
      o.date === a.date &&
      o.activityTypeId === a.activityTypeId &&
      o.communityItem === a.communityItem &&
      o.caseType === a.caseType &&
      o.caseSlot === a.caseSlot &&
      o.followUpStep === a.followUpStep,
  );
  if (dup) issues.push({ level: 'warning', code: 'possible_duplicate', message: 'A matching activity on this day is already logged.' });
  issues.push(...piiIssues({ title: a.title, notes: a.notes }));
  return dedupeIssues(issues);
}

export function validateReflection(r: Reflection, today: ISODate): Issue[] {
  const issues: Issue[] = [];
  if (!isValidDate(r.date)) issues.push({ level: 'error', code: 'invalid_date', message: 'Enter a valid date.' });
  else if (r.date > today) issues.push({ level: 'error', code: 'future_date', message: 'The date is in the future.' });
  const text = [r.title, r.interesting, r.learned, r.challenged, r.doDifferently, r.revise, r.needExposure].join('').trim();
  if (!text) issues.push({ level: 'error', code: 'empty', message: 'Write at least a title or one reflection.' });
  issues.push(
    ...piiIssues({
      title: r.title,
      interesting: r.interesting,
      learned: r.learned,
      challenged: r.challenged,
      doDifferently: r.doDifferently,
      revise: r.revise,
      needExposure: r.needExposure,
    }),
  );
  return issues;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.level === 'error');

function dedupeIssues(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.code}|${i.ref ?? ''}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
