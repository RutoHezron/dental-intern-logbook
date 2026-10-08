import {
  criteriaFor,
  MID_ROTATION_SECTIONS,
  MONTHLY_SECTIONS,
  monthlyCountFor,
  OVERALL_SECTIONS,
  type AssessmentKind,
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
  kind: AssessmentKind;
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
  const items = requiredItems(a.kind).every((id) => filled(a.responses[id]));
  if (a.kind === 'monthly' && !a.heldOn) return 'in_progress';
  if (a.kind === 'overall_rotation') return items && a.outcome && (a.outcome !== 'extend' || filled(a.extendBy)) ? 'complete' : 'in_progress';
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
  if (a.kind === 'overall_rotation' && a.outcome === 'extend' && !filled(a.extendBy)) {
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
