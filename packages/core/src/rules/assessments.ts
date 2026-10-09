import {
  criteriaFor,
  END_OF_INTERNSHIP_SECTIONS,
  MID_ROTATION_SECTIONS,
  MONTHLY_SECTIONS,
  monthlyCountFor,
  OVERALL_SECTIONS,
  type AssessmentKind,
  type RotationFormKind,
} from '../catalogue/kmpdc-forms';
import type { DatasetIndex } from '../analytics/dataset-index';
import { requirementProgress, summarizeProgress } from '../analytics/progress';
import type { Assessment, ISODate, Rotation } from '../types';
import { addDays, displayDate } from '../util/dates';
import { rotationEnd } from './rotations';
import type { Issue } from './validation';

/**
 * Assessment schedule, completeness, validation and the evidence that
 * pre-fills the supervisor's "progress in achieving logbook targets".
 */

export interface ScheduledForm {
  kind: RotationFormKind;
  sequence: number;
  due: ISODate;
}

/**
 * Default schedule (blueprint G12, configurable later): monthly meetings at
 * the end of weeks 4 and 8; mid-rotation at week 6 of 11 (week 4 of 8 for
 * community); end-of-rotation and overall assessments on the last day.
 */
export function assessmentSchedule(r: Rotation): ScheduledForm[] {
  const end = rotationEnd(r);
  const day = (n: number) => {
    const d = addDays(r.startsOn, n);
    return d > end ? end : d;
  };
  const monthly = Array.from({ length: monthlyCountFor(r.rotation) }, (_, i) => ({ kind: 'monthly' as const, sequence: i + 1, due: day(28 * (i + 1) - 1) }));
  return [
    ...monthly,
    { kind: 'mid_rotation', sequence: 1, due: day(r.rotation === 'COMM' ? 27 : 41) },
    { kind: 'end_of_rotation', sequence: 1, due: end },
    { kind: 'overall_rotation', sequence: 1, due: end },
  ];
}

export type FormStatus = 'not_started' | 'in_progress' | 'complete';

const filled = (s: string | undefined) => Boolean(s?.trim());

function requiredItems(kind: AssessmentKind): string[] {
  if (kind === 'end_of_internship') return [END_OF_INTERNSHIP_SECTIONS[0]!.items[0]!.id];
  const sections = kind === 'monthly' ? MONTHLY_SECTIONS : kind === 'mid_rotation' ? MID_ROTATION_SECTIONS : kind === 'overall_rotation' ? OVERALL_SECTIONS : [];
  return sections.flatMap((s) => s.items.map((i) => i.id));
}

export function assessmentStatus(a: Assessment | undefined, rotationCode: string): FormStatus {
  if (!a || a.deletedAt) return 'not_started';
  const answered = Object.values(a.responses).some(filled) || Object.keys(a.grades).length > 0 || Boolean(a.outcome);
  if (!answered) return 'not_started';
  if (a.kind === 'end_of_rotation') {
    const criteria = criteriaFor(rotationCode).flatMap((g) => g.criteria);
    const allGraded = criteria.every((c) => a.grades[c.id] !== undefined);
    return allGraded && a.overallGrade !== undefined && filled(a.recommendation) ? 'complete' : 'in_progress';
  }
  if (a.kind === 'completion_verification') {
    const remarks = Object.keys(a.responses).filter((k) => /^v[a-z]+$/.test(k));
    return remarks.length > 0 && remarks.every((k) => filled(a.responses[k])) ? 'complete' : 'in_progress';
  }
  const items = requiredItems(a.kind).every((id) => filled(a.responses[id]));
  if (a.kind === 'monthly' && !a.heldOn) return 'in_progress';
  if (a.kind === 'overall_rotation' || a.kind === 'end_of_internship') return items && a.outcome && (a.outcome !== 'extend' || filled(a.extendBy)) ? 'complete' : 'in_progress';
  return items ? 'complete' : 'in_progress';
}

/** Errors block saving; warnings are shown. Grades of 0 or 1 require reasons (KMPDC 5.2.2). */
export function validateAssessment(a: Assessment, rotationCode: string): Issue[] {
  const issues: Issue[] = [];
  if (a.kind === 'end_of_rotation') {
    for (const c of criteriaFor(rotationCode).flatMap((g) => g.criteria)) {
      const g = a.grades[c.id];
      if ((g === 0 || g === 1) && !filled(a.gradeRemarks[c.id])) {
        issues.push({
          level: 'error',
          code: 'grade_reason',
          ref: c.id,
          message: `"${c.label}" is graded ${g}: give the reasons and recommendations, as the logbook requires.`,
        });
      }
    }
    if ((a.overallGrade === 0 || a.overallGrade === 1) && !filled(a.recommendation)) {
      issues.push({ level: 'error', code: 'overall_reason', ref: 'overall', message: 'An overall grade of 0 or 1 needs a recommendation with reasons.' });
    }
  }
  if (a.outcome === 'extend' && !filled(a.extendBy)) {
    issues.push({ level: 'error', code: 'extend_period', ref: 'extendBy', message: 'State the extension period.' });
  }
  for (const [id, text] of Object.entries(a.responses)) {
    if (text && /(?:\+?254|\b0)[17]\d{8}\b/.test(text)) {
      issues.push({ level: 'warning', code: 'possible_identifier', ref: id, message: 'A remark looks like it contains a phone number.' });
    }
  }
  return issues;
}

/** Logbook counts for a rotation at a date: attached to the form as evidence. */
export function progressSnapshot(ix: DatasetIndex, rotation: Rotation, asOf: ISODate): NonNullable<Assessment['progressSnapshot']> {
  const list = requirementProgress(ix, asOf).filter((p) => p.requirement.rotation === rotation.rotation);
  return {
    asOf,
    codes: list.map((p) => ({ code: p.requirement.code, verified: p.verified, min: p.requirement.minCount, status: p.status })),
  };
}

/**
 * A factual draft for "Intern's progress in achieving logbook targets",
 * built from recorded counts only. The supervisor edits or replaces it.
 */
export function progressSummaryText(ix: DatasetIndex, rotation: Rotation, asOf: ISODate): string {
  const list = requirementProgress(ix, asOf).filter((p) => p.requirement.rotation === rotation.rotation);
  const s = summarizeProgress(list);
  const behind = list.filter((p) => p.status === 'behind' || p.status === 'at_risk' || p.status === 'not_met').sort((a, b) => a.pct - b.pct);
  const parts = [
    `As of ${displayDate(asOf)}: minimum met for ${s.met} of ${s.codes} codes; ${s.verifiedTowardMinimum} of ${s.minimumTotal} required entries verified.`,
  ];
  if (behind.length) {
    parts.push(`Below pace or minimum: ${behind.slice(0, 5).map((p) => `${p.requirement.code} (${p.verified}/${p.requirement.minCount})`).join(', ')}.`);
  }
  const pending = list.reduce((n, p) => n + p.pending, 0);
  if (pending) parts.push(`${pending} entries await verification.`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Readiness for the completion paperwork (5.8, 5.9)
// ---------------------------------------------------------------------------

export interface ReadinessItem {
  id: string;
  ok: boolean;
  label: string;
  detail?: string;
}

/**
 * What still stands between the intern and the KMPDC completion paperwork,
 * from recorded data. Minimums use the configured counting rules.
 */
export function completionReadiness(ix: DatasetIndex, assessments: Assessment[], asOf: ISODate): ReadinessItem[] {
  const live = assessments.filter((a) => !a.deletedAt);
  const rotations = [...ix.ds.rotations].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const name = (code: string) => ix.ds.requirementSet.rotations.find((r) => r.code === code)?.name ?? code;
  const progress = requirementProgress(ix, asOf);
  const out: ReadinessItem[] = [];

  const unfinished = rotations.filter((r) => rotationEnd(r) >= asOf);
  out.push({
    id: 'rotations',
    ok: unfinished.length === 0,
    label: 'All rotations finished',
    detail: unfinished.length ? `Still running or upcoming: ${unfinished.map((r) => name(r.rotation)).join(', ')}.` : undefined,
  });

  const missingForms: string[] = [];
  for (const r of rotations) {
    for (const f of assessmentSchedule(r)) {
      const a = live.find((x) => x.rotationId === r.id && x.kind === f.kind && x.sequence === f.sequence);
      if (assessmentStatus(a, r.rotation) !== 'complete') missingForms.push(`${r.rotation} ${f.kind.replace(/_/g, ' ')}${f.kind === 'monthly' ? ` ${f.sequence}` : ''}`);
    }
  }
  out.push({
    id: 'forms',
    ok: missingForms.length === 0,
    label: 'All rotation assessment forms complete',
    detail: missingForms.length ? `${missingForms.length} outstanding: ${missingForms.slice(0, 6).join('; ')}${missingForms.length > 6 ? '\u2026' : ''}.` : undefined,
  });

  const notCompleted = rotations.filter((r) => live.find((x) => x.rotationId === r.id && x.kind === 'overall_rotation')?.outcome !== 'completed');
  out.push({
    id: 'outcomes',
    ok: notCompleted.length === 0,
    label: 'Every rotation recorded as completed in its overall assessment',
    detail: notCompleted.length ? `Not yet recorded as completed: ${notCompleted.map((r) => name(r.rotation)).join(', ')}.` : undefined,
  });

  for (const r of rotations) {
    const short = progress.filter((p) => p.requirement.rotation === r.rotation && p.status !== 'met');
    out.push({
      id: `minimums-${r.rotation}`,
      ok: short.length === 0,
      label: `${name(r.rotation)}: logbook minimums met${ix.ds.rules.confirmed ? '' : ' (default rules)'}`,
      detail: short.length
        ? short.slice(0, 6).map((p) => `${p.requirement.code} ${p.verified}/${p.requirement.minCount}`).join(', ') + (short.length > 6 ? '\u2026' : '')
        : undefined,
    });
  }

  const open = ix.entries.filter((e) => e.status === 'submitted' || e.status === 'returned').length;
  out.push({
    id: 'pending',
    ok: open === 0,
    label: 'No entries waiting for verification or correction',
    detail: open ? `${open} entr${open === 1 ? 'y' : 'ies'} still open.` : undefined,
  });
  return out;
}
