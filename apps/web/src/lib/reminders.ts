import {
  daysBetween,
  internshipMonth,
  internshipWeek,
  isWeekend,
  monthIndexOn,
  rotationEnd,
  weekIndexOn,
  type DatasetIndex,
  type ISODate,
} from '@logbook/core';

/**
 * In-app reminders (brief §15), computed from the data each time the app
 * opens. Push notifications come later; these never leave the device.
 */

export interface Reminder {
  id: string;
  tone: 'neutral' | 'warning' | 'serious';
  text: string;
  to?: string;
  action?: string;
}

export function computeReminders(ix: DatasetIndex, today: ISODate, now: Date = new Date()): Reminder[] {
  const out: Reminder[] = [];
  const { internship, rotations } = ix.ds;
  if (today < internship.periodFrom) {
    out.push({ id: 'not-started', tone: 'neutral', text: `Your internship starts in ${daysBetween(today, internship.periodFrom)} days.` });
    return out;
  }
  const inInternship = today <= internship.periodTo;

  const returned = ix.entries.filter((e) => e.status === 'returned');
  if (returned.length) {
    out.push({
      id: 'returned',
      tone: 'serious',
      text: `${returned.length} logbook entr${returned.length === 1 ? 'y was' : 'ies were'} returned by your supervisor. Fix and resubmit.`,
      to: '/logbook?status=returned',
      action: 'Review',
    });
  }

  const loggedToday = ix.encounters.some((e) => e.date === today) || ix.activities.some((a) => a.date === today);
  if (inInternship && !loggedToday && !isWeekend(today) && now.getHours() >= 15) {
    out.push({ id: 'end-of-day', tone: 'neutral', text: 'Nothing logged today yet. Add today\'s patients before you forget the details.', to: '/log', action: 'Log now' });
  }

  const stale = ix.entries.filter((e) => e.status === 'submitted' && daysBetween(e.performedOn, today) > 7).length;
  if (stale) {
    out.push({ id: 'stale', tone: 'warning', text: `${stale} entr${stale === 1 ? 'y has' : 'ies have'} waited more than a week for verification. Consider asking your supervisor for a sign-off session.` });
  }

  for (const r of rotations) {
    const left = daysBetween(today, rotationEnd(r));
    const name = ix.ds.requirementSet.rotations.find((x) => x.code === r.rotation)?.name ?? r.rotation;
    if (r.startsOn <= today && left >= 0 && left <= 14) {
      out.push({
        id: `ends-${r.id}`,
        tone: left <= 7 ? 'warning' : 'neutral',
        text: left === 0 ? `Today is the last day of ${name}.` : `Your ${name} rotation ends in ${left} day${left === 1 ? '' : 's'}.`,
        to: `/logbook?rotation=${r.rotation}&view=codes`,
        action: 'See gaps',
      });
    }
    const until = daysBetween(today, r.startsOn);
    if (until > 0 && until <= 7) out.push({ id: `starts-${r.id}`, tone: 'neutral', text: `${name} starts in ${until} day${until === 1 ? '' : 's'}.` });
  }

  if (inInternship) {
    const m = monthIndexOn(internship, today);
    const monthStart = internshipMonth(internship, m).from;
    if (m > 1 && daysBetween(monthStart, today) <= 6) {
      out.push({ id: `month-${m - 1}`, tone: 'neutral', text: `Your Month ${m - 1} report is ready for review.`, to: `/reports/view?kind=month&index=${m - 1}`, action: 'Open' });
    }
    const w = weekIndexOn(internship, today);
    const weekEnd = internshipWeek(internship, w).to;
    if (daysBetween(today, weekEnd) <= 2) {
      out.push({ id: `week-${w}`, tone: 'neutral', text: `Your Week ${w} report is ready to review.`, to: `/reports/view?kind=week&index=${w}`, action: 'Open' });
    }
    const lastReflection = ix.ds.reflections.filter((r) => !r.deletedAt).reduce<string | null>((max, r) => (max && max > r.date ? max : r.date), null);
    if (!lastReflection || daysBetween(lastReflection, today) > 7) {
      out.push({ id: 'diary', tone: 'neutral', text: 'No reflection this week. What is one thing you learned?', to: '/diary/new', action: 'Write' });
    }
  }
  return out;
}
