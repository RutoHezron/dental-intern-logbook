import type { ID, ISODate, Rotation, RotationCode, RequirementSet } from '../types';
import { addDays, daysBetween } from '../util/dates';

/** Last day of a rotation including any extension. */
export function rotationEnd(r: Rotation): ISODate {
  return addDays(r.endsOn, r.extendedByDays);
}

/** The rotation in effect on a date, used to assign entries automatically (manual override allowed). */
export function rotationForDate(rotations: Rotation[], date: ISODate): Rotation | null {
  for (const r of rotations) {
    if (date >= r.startsOn && date <= rotationEnd(r)) return r;
  }
  return null;
}

export function rotationCodeFor(rotations: Rotation[], rotationId: ID | null | undefined): RotationCode | null {
  if (!rotationId) return null;
  return rotations.find((r) => r.id === rotationId)?.rotation ?? null;
}

/**
 * Build a consecutive rotation calendar from an internship start date and a
 * rotation order, using each rotation's default length from the requirement set.
 */
export function buildRotationCalendar(
  set: RequirementSet,
  internshipId: ID,
  start: ISODate,
  order: RotationCode[],
  makeId: () => ID,
): Rotation[] {
  let cursor = start;
  return order.map((code) => {
    const def = set.rotations.find((r) => r.code === code);
    if (!def) throw new Error(`Unknown rotation ${code}`);
    const startsOn = cursor;
    const endsOn = addDays(startsOn, def.weeks * 7 - 1);
    cursor = addDays(endsOn, 1);
    return { id: makeId(), internshipId, rotation: code, startsOn, endsOn, extendedByDays: 0 };
  });
}

export interface RotationCalendarIssue {
  kind: 'overlap' | 'gap' | 'invalid_range' | 'outside_internship';
  message: string;
  rotationIds: ID[];
}

/** Check a calendar for overlaps, gaps and ranges outside the internship period. */
export function checkRotationCalendar(rotations: Rotation[], periodFrom: ISODate): RotationCalendarIssue[] {
  const issues: RotationCalendarIssue[] = [];
  const sorted = [...rotations].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  for (const r of sorted) {
    if (r.endsOn < r.startsOn) {
      issues.push({ kind: 'invalid_range', message: `${r.rotation} ends before it starts.`, rotationIds: [r.id] });
    }
    // Extensions may legitimately run past the planned end date, so only an early start is flagged.
    if (r.startsOn < periodFrom) {
      issues.push({ kind: 'outside_internship', message: `${r.rotation} starts before the internship.`, rotationIds: [r.id] });
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const gap = daysBetween(rotationEnd(prev), cur.startsOn);
    if (gap <= 0) {
      issues.push({ kind: 'overlap', message: `${prev.rotation} and ${cur.rotation} overlap.`, rotationIds: [prev.id, cur.id] });
    } else if (gap > 1) {
      issues.push({
        kind: 'gap',
        message: `${gap - 1} day(s) between ${prev.rotation} and ${cur.rotation} with no rotation.`,
        rotationIds: [prev.id, cur.id],
      });
    }
  }
  return issues;
}

/** Fraction of a rotation elapsed on a date, clamped to 0–1. */
export function rotationProgress(r: Rotation, on: ISODate): number {
  const total = daysBetween(r.startsOn, rotationEnd(r)) + 1;
  const done = daysBetween(r.startsOn, on) + 1;
  return Math.max(0, Math.min(1, done / total));
}
