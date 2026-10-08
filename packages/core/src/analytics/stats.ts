import { CATEGORY_LABELS, getActivityType, getProcedureType, RADIOGRAPH_KINDS } from '../catalogue/procedures';
import type { ISODate, Level, ProcedureCategory, ReflectionTag } from '../types';
import { PENDING_STATUSES } from '../rules/counting';
import type { DatasetIndex } from './dataset-index';

/**
 * Activity statistics for a date range. "Procedures" are exposure counts:
 * one per tooth for tooth procedures, one per procedure otherwise, every
 * stage included. Logbook-code counts (which follow the counting rules) are
 * reported separately under `entries` and `byCode`.
 */

export type LevelCounts = Record<Level, number>;
export const emptyLevels = (): LevelCounts => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

export interface ProcedureStat {
  id: string;
  name: string;
  category: ProcedureCategory;
  total: number;
  byLevel: LevelCounts;
}

export interface PeriodStats {
  from: ISODate;
  to: ISODate;
  activeDays: number;
  encounters: number;
  patientsSeen: number;
  newPatients: number;
  followUps: number;
  emergencies: number;
  referrals: number;
  radiographs: number;
  investigations: number;
  theatre: number;
  outreach: number;
  academic: number;
  activities: number;
  diagnoses: { term: string; count: number }[];
  procedures: {
    total: number;
    byLevel: LevelCounts;
    observed: number;
    assisted: number;
    /** Levels 3–5: carried out the whole procedure. */
    performed: number;
    /** Levels 3–4. */
    supervised: number;
    /** Level 5. */
    independent: number;
  };
  byCategory: Partial<Record<ProcedureCategory, number>>;
  byProcedure: ProcedureStat[];
  /** Procedures by rotation code ("—" for none). */
  byRotation: Record<string, number>;
  entries: { logged: number; verified: number; pending: number; returned: number };
  byCode: Record<string, { logged: number; verified: number }>;
  reflections: { count: number; byTag: Partial<Record<ReflectionTag, number>> };
}

const inside = (d: ISODate, from: ISODate, to: ISODate) => d >= from && d <= to;

export function computeStats(ix: DatasetIndex, from: ISODate, to: ISODate): PeriodStats {
  const days = new Set<string>();
  const patients = new Set<string>();
  let anonymousEncounters = 0;
  const s: PeriodStats = {
    from,
    to,
    activeDays: 0,
    encounters: 0,
    patientsSeen: 0,
    newPatients: 0,
    followUps: 0,
    emergencies: 0,
    referrals: 0,
    radiographs: 0,
    investigations: 0,
    theatre: 0,
    outreach: 0,
    academic: 0,
    activities: 0,
    diagnoses: [],
    procedures: { total: 0, byLevel: emptyLevels(), observed: 0, assisted: 0, performed: 0, supervised: 0, independent: 0 },
    byCategory: {},
    byProcedure: [],
    byRotation: {},
    entries: { logged: 0, verified: 0, pending: 0, returned: 0 },
    byCode: {},
    reflections: { count: 0, byTag: {} },
  };
  const diag = new Map<string, number>();
  const byProc = new Map<string, ProcedureStat>();

  for (const e of ix.encounters) {
    if (!inside(e.date, from, to)) continue;
    s.encounters++;
    days.add(e.date);
    if (e.patientId) patients.add(e.patientId);
    else anonymousEncounters++;
    if (e.visitType === 'new') s.newPatients++;
    if (e.visitType === 'review' || e.visitType === 'continuing') s.followUps++;
    if (e.visitType === 'emergency' || e.setting === 'emergency') s.emergencies++;
    if (e.referredTo?.trim()) s.referrals++;
    if (e.setting === 'theatre') s.theatre++;
    if (e.setting === 'outreach') s.outreach++;
    for (const inv of e.investigations) {
      s.investigations++;
      if (RADIOGRAPH_KINDS.includes(inv.kind)) s.radiographs++;
    }
    for (const f of e.findings) {
      if (f.isDiagnosis) diag.set(f.term, (diag.get(f.term) ?? 0) + 1);
    }
    const rot = ix.rotationCode(e.rotationId) ?? '—';
    for (const p of e.procedures) {
      const type = getProcedureType(p.procedureTypeId);
      const units = type?.siteKind === 'tooth' ? Math.max(1, p.sites.length) : 1;
      const id = type?.id ?? p.procedureTypeId;
      const name = type?.id === 'other' && p.otherName ? p.otherName : type?.shortName ?? id;
      const key = type?.id === 'other' ? `other:${name}` : id;
      const category = type?.category ?? 'general';
      s.procedures.total += units;
      s.procedures.byLevel[p.level] += units;
      s.byCategory[category] = (s.byCategory[category] ?? 0) + units;
      s.byRotation[rot] = (s.byRotation[rot] ?? 0) + units;
      let stat = byProc.get(key);
      if (!stat) {
        stat = { id: key, name, category, total: 0, byLevel: emptyLevels() };
        byProc.set(key, stat);
      }
      stat.total += units;
      stat.byLevel[p.level] += units;
    }
  }

  for (const a of ix.activities) {
    if (!inside(a.date, from, to)) continue;
    s.activities++;
    days.add(a.date);
    const type = getActivityType(a.activityTypeId);
    if (a.activityTypeId === 'ward_theatre') s.theatre++;
    if (a.activityTypeId === 'emergency_call') s.emergencies++;
    if (type?.group === 'academic') s.academic++;
    if (type?.group === 'community' && a.activityTypeId !== 'weekly_report') s.outreach++;
  }

  for (const e of ix.entries) {
    if (!inside(e.performedOn, from, to)) continue;
    const verified = e.status === 'verified' || e.status === 'locked';
    s.entries.logged++;
    if (verified) s.entries.verified++;
    if (PENDING_STATUSES.includes(e.status)) s.entries.pending++;
    if (e.status === 'returned') s.entries.returned++;
    const c = (s.byCode[e.requirementCode] ??= { logged: 0, verified: 0 });
    c.logged++;
    if (verified) c.verified++;
  }

  for (const r of ix.ds.reflections) {
    if (r.deletedAt || !inside(r.date, from, to)) continue;
    s.reflections.count++;
    for (const t of r.tags) s.reflections.byTag[t] = (s.reflections.byTag[t] ?? 0) + 1;
  }

  const bl = s.procedures.byLevel;
  s.procedures.observed = bl[1];
  s.procedures.assisted = bl[2];
  s.procedures.supervised = bl[3] + bl[4];
  s.procedures.independent = bl[5];
  s.procedures.performed = bl[3] + bl[4] + bl[5];
  s.patientsSeen = patients.size + anonymousEncounters;
  s.activeDays = days.size;
  s.diagnoses = [...diag.entries()].map(([term, count]) => ({ term, count })).sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
  s.byProcedure = [...byProc.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return s;
}

export const categoryLabel = (c: ProcedureCategory) => CATEGORY_LABELS[c];

/** Headline metrics compared between two periods. */
export const HEADLINE_METRICS: { key: string; label: string; get: (s: PeriodStats) => number }[] = [
  { key: 'patients', label: 'Patients seen', get: (s) => s.patientsSeen },
  { key: 'procedures', label: 'Procedures', get: (s) => s.procedures.total },
  { key: 'performed', label: 'Performed (L3–5)', get: (s) => s.procedures.performed },
  { key: 'independent', label: 'Independent (L5)', get: (s) => s.procedures.independent },
  { key: 'assisted', label: 'Assisted (L2)', get: (s) => s.procedures.assisted },
  { key: 'observed', label: 'Observed (L1)', get: (s) => s.procedures.observed },
  { key: 'emergencies', label: 'Emergencies', get: (s) => s.emergencies },
  { key: 'referrals', label: 'Referrals', get: (s) => s.referrals },
  { key: 'radiographs', label: 'Radiographs', get: (s) => s.radiographs },
  { key: 'verified', label: 'Logbook entries verified', get: (s) => s.entries.verified },
];

export interface Delta {
  key: string;
  label: string;
  current: number;
  previous: number;
  change: number;
  /** Relative change, null when previous is 0. */
  pct: number | null;
}

export function compareStats(current: PeriodStats, previous: PeriodStats): Delta[] {
  return HEADLINE_METRICS.map((m) => {
    const c = m.get(current);
    const p = m.get(previous);
    return { key: m.key, label: m.label, current: c, previous: p, change: c - p, pct: p === 0 ? null : (c - p) / p };
  });
}
