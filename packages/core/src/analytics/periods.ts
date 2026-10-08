import type { ID, ISODate, Internship, Rotation, RequirementSet } from '../types';
import { addDays, addMonths, displayDate, displayMonth, displayShortDate, endOfMonth, minDate, startOfIsoWeek, startOfMonth } from '../util/dates';
import { rotationEnd } from '../rules/rotations';

/**
 * Reporting periods. By default weeks and months count from the internship
 * start ("Week 1", "Month 3"), as interns and supervisors talk about them;
 * calendar weeks and months are available too.
 */

export type PeriodKind = 'day' | 'week' | 'month' | 'calendar_week' | 'calendar_month' | 'rotation' | 'internship' | 'custom';

export interface Period {
  kind: PeriodKind;
  /** 1-based index for internship weeks/months. */
  index?: number;
  rotationId?: ID;
  label: string;
  sublabel: string;
  from: ISODate;
  to: ISODate;
}

const rangeLabel = (from: ISODate, to: ISODate) =>
  from.slice(0, 4) === to.slice(0, 4) ? `${displayShortDate(from)} – ${displayDate(to)}` : `${displayDate(from)} – ${displayDate(to)}`;

export function internshipWeek(internship: Internship, index: number): Period {
  const from = addDays(internship.periodFrom, (index - 1) * 7);
  const to = addDays(from, 6);
  return { kind: 'week', index, label: `Week ${index}`, sublabel: rangeLabel(from, to), from, to };
}

export function internshipMonth(internship: Internship, index: number): Period {
  const from = addMonths(internship.periodFrom, index - 1);
  const to = addDays(addMonths(internship.periodFrom, index), -1);
  return { kind: 'month', index, label: `Month ${index}`, sublabel: rangeLabel(from, to), from, to };
}

export function calendarWeek(date: ISODate): Period {
  const from = startOfIsoWeek(date);
  const to = addDays(from, 6);
  return { kind: 'calendar_week', label: `Week of ${displayShortDate(from)}`, sublabel: rangeLabel(from, to), from, to };
}

export function calendarMonth(date: ISODate): Period {
  const from = startOfMonth(date);
  const to = endOfMonth(date);
  return { kind: 'calendar_month', label: displayMonth(from), sublabel: rangeLabel(from, to), from, to };
}

export function rotationPeriod(r: Rotation, set: RequirementSet): Period {
  const name = set.rotations.find((x) => x.code === r.rotation)?.name ?? r.rotation;
  const to = rotationEnd(r);
  return { kind: 'rotation', rotationId: r.id, label: name, sublabel: rangeLabel(r.startsOn, to), from: r.startsOn, to };
}

export function internshipPeriod(internship: Internship): Period {
  return {
    kind: 'internship',
    label: 'Whole internship',
    sublabel: rangeLabel(internship.periodFrom, internship.periodTo),
    from: internship.periodFrom,
    to: internship.periodTo,
  };
}

export function dayPeriod(date: ISODate): Period {
  return { kind: 'day', label: displayDate(date), sublabel: displayDate(date), from: date, to: date };
}

export function customPeriod(from: ISODate, to: ISODate): Period {
  return { kind: 'custom', label: 'Custom period', sublabel: rangeLabel(from, to), from, to };
}

/** Number of internship weeks/months that have started by a date. */
export function weekIndexOn(internship: Internship, date: ISODate): number {
  const days = Math.floor((Date.parse(date) - Date.parse(internship.periodFrom)) / 86_400_000);
  return Math.max(1, Math.floor(days / 7) + 1);
}

export function monthIndexOn(internship: Internship, date: ISODate): number {
  let i = 1;
  while (addMonths(internship.periodFrom, i) <= date) i++;
  return i;
}

/** All internship weeks from the start up to (and including) the week containing `upTo`. */
export function internshipWeeks(internship: Internship, upTo: ISODate): Period[] {
  const last = weekIndexOn(internship, minDate(upTo, internship.periodTo));
  return Array.from({ length: last }, (_, i) => internshipWeek(internship, i + 1));
}

export function internshipMonths(internship: Internship, upTo: ISODate): Period[] {
  const last = monthIndexOn(internship, minDate(upTo, internship.periodTo));
  return Array.from({ length: last }, (_, i) => internshipMonth(internship, i + 1));
}

/** The previous period of the same kind and length, or null at the start. */
export function previousPeriod(p: Period, internship: Internship, rotations: Rotation[], set: RequirementSet): Period | null {
  switch (p.kind) {
    case 'week':
      return p.index && p.index > 1 ? internshipWeek(internship, p.index - 1) : null;
    case 'month':
      return p.index && p.index > 1 ? internshipMonth(internship, p.index - 1) : null;
    case 'calendar_week':
      return calendarWeek(addDays(p.from, -7));
    case 'calendar_month':
      return calendarMonth(addDays(p.from, -1));
    case 'day':
      return dayPeriod(addDays(p.from, -1));
    case 'rotation': {
      const sorted = [...rotations].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
      const i = sorted.findIndex((r) => r.id === p.rotationId);
      return i > 0 ? rotationPeriod(sorted[i - 1]!, set) : null;
    }
    default:
      return null;
  }
}
