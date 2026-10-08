import type { ISODate } from '../types';

/**
 * Calendar-date arithmetic on "YYYY-MM-DD" strings, done in UTC so results
 * never depend on the device time zone.
 */

const DAY_MS = 86_400_000;

export function parseDate(d: ISODate): number {
  const [y, m, day] = d.split('-').map(Number);
  if (!y || !m || !day) throw new Error(`Invalid ISO date: ${d}`);
  return Date.UTC(y, m - 1, day);
}

export function formatDate(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isValidDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return formatDate(parseDate(d)) === d;
}

export function addDays(d: ISODate, n: number): ISODate {
  return formatDate(parseDate(d) + n * DAY_MS);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(d: ISODate): number {
  return (new Date(parseDate(d)).getUTCDay() + 6) % 7;
}

export function isWeekend(d: ISODate): boolean {
  return weekday(d) >= 5;
}

export function startOfIsoWeek(d: ISODate): ISODate {
  return addDays(d, -weekday(d));
}

export function addMonths(d: ISODate, n: number): ISODate {
  const dt = new Date(parseDate(d));
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + n;
  const day = dt.getUTCDate();
  // Clamp to the last day of the target month (31 Jan + 1 month = 28/29 Feb).
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return formatDate(Date.UTC(y, m, Math.min(day, last)));
}

export function startOfMonth(d: ISODate): ISODate {
  return d.slice(0, 8) + '01';
}

export function endOfMonth(d: ISODate): ISODate {
  return addDays(addMonths(startOfMonth(d), 1), -1);
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

export function inRange(d: ISODate, from: ISODate, to: ISODate): boolean {
  return d >= from && d <= to;
}

/** Age on a date from birth year only. Without a birth date this can overstate age by up to a year. */
export function ageOnDate(birthYear: number, d: ISODate): number {
  return Number(d.slice(0, 4)) - birthYear;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "13 Oct 2025" */
export function displayDate(d: ISODate): string {
  const [y, m, day] = d.split('-');
  return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** "13 Oct" */
export function displayShortDate(d: ISODate): string {
  const [, m, day] = d.split('-');
  return `${Number(day)} ${MONTHS[Number(m) - 1]}`;
}

/** "Oct 2025" */
export function displayMonth(d: ISODate): string {
  const [y, m] = d.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

/** Local calendar date: "today" is what the intern sees on the wall clock. */
export function todayISO(now: Date = new Date()): ISODate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
