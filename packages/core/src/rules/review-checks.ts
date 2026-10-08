import type { DatasetIndex } from '../analytics/dataset-index';
import type { ID, LogbookEntry } from '../types';
import { ageOnDate, daysBetween } from '../util/dates';

/**
 * Checks shown to a supervisor beside each entry awaiting verification
 * (blueprint §13.1). They are prompts, not accusations: each says what was
 * noticed so the supervisor can look closer.
 */

export type ReviewCheckKind = 'late' | 'outside_rotation' | 'paed_age_unknown' | 'duplicate' | 'volume' | 'level_jump';

export interface ReviewCheck {
  kind: ReviewCheckKind;
  message: string;
}

export function reviewChecks(ix: DatasetIndex, entry: LogbookEntry): ReviewCheck[] {
  const out: ReviewCheck[] = [];
  const rules = ix.ds.rules;

  const loggedOn = entry.createdAt.slice(0, 10);
  const lag = loggedOn && /^\d{4}-\d{2}-\d{2}$/.test(loggedOn) ? daysBetween(entry.performedOn, loggedOn) : 0;
  if (lag > rules.lateEntryDays) out.push({ kind: 'late', message: `Logged ${lag} days after the procedure.` });

  if (!entry.rotationId) out.push({ kind: 'outside_rotation', message: 'Date is outside every rotation.' });

  if (entry.requirementCode.startsWith('PAED') && entry.encounterId) {
    const enc = ix.encounters.find((e) => e.id === entry.encounterId);
    const p = enc?.patientId ? ix.patients.get(enc.patientId) : undefined;
    if (!p?.birthYear) out.push({ kind: 'paed_age_unknown', message: 'Paediatric code but no birth year recorded.' });
    else if (ageOnDate(p.birthYear, entry.performedOn) >= rules.paediatricMaxAge) {
      out.push({ kind: 'paed_age_unknown', message: `Patient recorded as ${ageOnDate(p.birthYear, entry.performedOn)} years old.` });
    }
  }

  const same = ix.entries.filter(
    (e) =>
      e.id !== entry.id &&
      e.requirementCode === entry.requirementCode &&
      e.performedOn === entry.performedOn &&
      e.patientRef &&
      e.patientRef === entry.patientRef &&
      (e.site ?? '') === (entry.site ?? ''),
  );
  if (same.length) out.push({ kind: 'duplicate', message: 'Another entry has the same code, patient, site and date.' });

  const sameDayCode = ix.entries.filter((e) => e.requirementCode === entry.requirementCode && e.performedOn === entry.performedOn).length;
  if (sameDayCode >= 12) out.push({ kind: 'volume', message: `${sameDayCode} ${entry.requirementCode} entries on this day.` });

  // First time at level 4–5 for this code, with no earlier verified entry at level 3 or above.
  if (entry.levelClaimed >= 4) {
    const earlier = ix.entries.filter(
      (e) => e.requirementCode === entry.requirementCode && e.performedOn < entry.performedOn && rules.completedStatuses.includes(e.status),
    );
    if (!earlier.some((e) => ix.effLevel(e) >= 3)) {
      out.push({ kind: 'level_jump', message: `First ${entry.requirementCode} entry at level ${entry.levelClaimed}, with no earlier verified entry at level 3 or above.` });
    }
  }
  return out;
}

/** Entries awaiting a supervisor's decision, oldest first, optionally for one supervisor. */
export function verificationQueue(ix: DatasetIndex, supervisorId?: ID | null): LogbookEntry[] {
  return ix.entries
    .filter((e) => e.status === 'submitted' && (supervisorId === undefined || (e.supervisorId ?? null) === supervisorId))
    .sort((a, b) => a.performedOn.localeCompare(b.performedOn) || a.createdAt.localeCompare(b.createdAt));
}
