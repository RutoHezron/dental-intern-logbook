import { getProcedureType, PROCEDURE_TYPES } from '../catalogue/procedures';
import type { ISODate, Level, Requirement, Rotation, UncodedCompetency } from '../types';
import { rotationEnd } from '../rules/rotations';
import { daysBetween } from '../util/dates';
import type { DatasetIndex } from './dataset-index';
import { emptyLevels, type LevelCounts } from './stats';

/**
 * Logbook progress per requirement code (blueprint §6.2, §12.4) and the
 * competency matrix (brief §6–7).
 *
 * Three numbers are always kept apart: logged (claimed), verified (signed)
 * and at expected level (verified, using the supervisor's observed level).
 * Counts measure recorded exposure — never certify competence.
 */

export type ProgressStatus = 'met' | 'on_track' | 'at_risk' | 'behind' | 'not_met' | 'upcoming' | 'no_rotation';

export interface RequirementProgress {
  requirement: Requirement;
  rotation: Rotation | null;
  logged: number;
  verified: number;
  pending: number;
  returned: number;
  atExpectedLevel: number;
  remaining: number;
  /** Verified ÷ minimum, capped at 1. */
  pct: number;
  /** Effective levels across logged entries. */
  levels: LevelCounts;
  /** Highest effective level among verified entries; 0 = no verified exposure. */
  highestVerifiedLevel: Level | 0;
  /** Projected logged count at rotation end at the current pace (null if too early or finished). */
  forecast: number | null;
  status: ProgressStatus;
  lastOn: ISODate | null;
}

const MIN_DAYS_FOR_FORECAST = 7;

export function requirementProgress(ix: DatasetIndex, asOf: ISODate, filter?: { rotationCode?: string }): RequirementProgress[] {
  const rots = [...ix.rotations.values()];
  const byCode = new Map<string, RequirementProgress>();
  for (const req of ix.ds.requirementSet.requirements) {
    if (filter?.rotationCode && req.rotation !== filter.rotationCode) continue;
    byCode.set(req.code, {
      requirement: req,
      rotation: rots.find((r) => r.rotation === req.rotation) ?? null,
      logged: 0,
      verified: 0,
      pending: 0,
      returned: 0,
      atExpectedLevel: 0,
      remaining: req.minCount,
      pct: req.minCount === 0 ? 1 : 0,
      levels: emptyLevels(),
      highestVerifiedLevel: 0,
      forecast: null,
      status: 'upcoming',
      lastOn: null,
    });
  }
  const completed = ix.ds.rules.completedStatuses;
  for (const e of ix.entries) {
    if (e.performedOn > asOf) continue;
    const p = byCode.get(e.requirementCode);
    if (!p) continue;
    const lvl = ix.effLevel(e);
    p.logged++;
    p.levels[lvl]++;
    p.lastOn = e.performedOn;
    if (completed.includes(e.status)) {
      p.verified++;
      if (lvl >= p.requirement.expectedLevel) p.atExpectedLevel++;
      if (lvl > p.highestVerifiedLevel) p.highestVerifiedLevel = lvl;
    } else {
      p.pending++;
      if (e.status === 'returned') p.returned++;
    }
  }
  for (const p of byCode.values()) {
    const min = p.requirement.minCount;
    p.remaining = Math.max(0, min - p.verified);
    p.pct = min === 0 ? 1 : Math.min(1, p.verified / min);
    p.status = statusFor(p, asOf);
  }
  return [...byCode.values()];
}

function statusFor(p: RequirementProgress, asOf: ISODate): ProgressStatus {
  const min = p.requirement.minCount;
  if (p.verified >= min) return 'met';
  const r = p.rotation;
  if (!r) return 'no_rotation';
  if (asOf < r.startsOn) return 'upcoming';
  const end = rotationEnd(r);
  if (asOf > end) return 'not_met';
  const elapsed = daysBetween(r.startsOn, asOf) + 1;
  const total = daysBetween(r.startsOn, end) + 1;
  if (elapsed >= MIN_DAYS_FOR_FORECAST) {
    p.forecast = Math.round((p.logged / elapsed) * total);
  }
  if (p.forecast === null) return p.logged > 0 ? 'on_track' : 'upcoming';
  if (p.logged >= min || p.forecast >= min) return 'on_track';
  if (p.forecast >= min * 0.7) return 'at_risk';
  return 'behind';
}

export interface ProgressSummary {
  codes: number;
  met: number;
  onTrack: number;
  atRisk: number;
  behind: number;
  notMet: number;
  upcoming: number;
  minimumTotal: number;
  verifiedTowardMinimum: number;
  /** Verified entries toward minimums (capped per code) ÷ total minimum. */
  pct: number;
}

export function summarizeProgress(list: RequirementProgress[]): ProgressSummary {
  const s: ProgressSummary = { codes: list.length, met: 0, onTrack: 0, atRisk: 0, behind: 0, notMet: 0, upcoming: 0, minimumTotal: 0, verifiedTowardMinimum: 0, pct: 0 };
  for (const p of list) {
    s.minimumTotal += p.requirement.minCount;
    s.verifiedTowardMinimum += Math.min(p.verified, p.requirement.minCount);
    if (p.status === 'met') s.met++;
    else if (p.status === 'on_track') s.onTrack++;
    else if (p.status === 'at_risk') s.atRisk++;
    else if (p.status === 'behind') s.behind++;
    else if (p.status === 'not_met') s.notMet++;
    else s.upcoming++;
  }
  s.pct = s.minimumTotal ? s.verifiedTowardMinimum / s.minimumTotal : 1;
  return s;
}

// ---------------------------------------------------------------------------
// Competency matrix and level progression
// ---------------------------------------------------------------------------

export interface LevelMilestone {
  code: string;
  level: Level;
  /** First date a verified entry reached this effective level. */
  on: ISODate;
}

/** First date each code reached each verified level — the "journey" through levels 1→5. */
export function levelMilestones(ix: DatasetIndex, asOf: ISODate): LevelMilestone[] {
  const best = new Map<string, number>();
  const out: LevelMilestone[] = [];
  const completed = ix.ds.rules.completedStatuses;
  for (const e of ix.entries) {
    if (e.performedOn > asOf || !completed.includes(e.status)) continue;
    const lvl = ix.effLevel(e);
    const prev = best.get(e.requirementCode) ?? 0;
    if (lvl > prev) {
      best.set(e.requirementCode, lvl);
      out.push({ code: e.requirementCode, level: lvl, on: e.performedOn });
    }
  }
  return out;
}

/** Exposure to competencies with no logbook code (orthodontics, prosthodontics, general). */
export interface UncodedExposure {
  competency: UncodedCompetency;
  total: number;
  levels: LevelCounts;
  lastOn: ISODate | null;
}

export function uncodedExposure(ix: DatasetIndex, asOf: ISODate): UncodedExposure[] {
  const map = new Map<string, UncodedExposure>(
    ix.ds.requirementSet.uncoded.map((c) => [c.code, { competency: c, total: 0, levels: emptyLevels(), lastOn: null }]),
  );
  for (const e of ix.encounters) {
    if (e.date > asOf) continue;
    for (const p of e.procedures) {
      const t = getProcedureType(p.procedureTypeId);
      const x = t?.uncoded ? map.get(t.uncoded) : undefined;
      if (!x) continue;
      x.total++;
      x.levels[p.level]++;
      x.lastOn = e.date;
    }
  }
  // CPD activities evidence GEN-4.
  const cpd = map.get('GEN-4');
  if (cpd) {
    for (const a of ix.activities) {
      if (a.date > asOf || (a.activityTypeId !== 'cpd' && a.activityTypeId !== 'case_presentation')) continue;
      cpd.total++;
      cpd.levels[a.level]++;
      cpd.lastOn = a.date;
    }
  }
  return [...map.values()];
}

/** Exposure by procedure type across the whole internship (all rotations), with levels. */
export function procedureExposure(ix: DatasetIndex, asOf: ISODate) {
  const map = new Map(PROCEDURE_TYPES.map((t) => [t.id, { type: t, total: 0, levels: emptyLevels(), firstOn: null as ISODate | null, lastOn: null as ISODate | null }]));
  for (const e of ix.encounters) {
    if (e.date > asOf) continue;
    for (const p of e.procedures) {
      const x = map.get(p.procedureTypeId);
      if (!x) continue;
      const units = x.type.siteKind === 'tooth' ? Math.max(1, p.sites.length) : 1;
      x.total += units;
      x.levels[p.level] += units;
      x.firstOn ??= e.date;
      x.lastOn = e.date;
    }
  }
  return [...map.values()];
}

/** Brief §7: Level 0 = no exposure; otherwise the highest level reached. */
export function competencyLevelLabel(level: Level | 0): string {
  return ['No exposure', 'Observed', 'Assisted', 'Direct supervision', 'Indirect supervision', 'Independent'][level]!;
}

export const LEVEL_SHORT: Record<Level, string> = { 1: 'Observed', 2: 'Assisted', 3: 'Direct sup.', 4: 'Indirect sup.', 5: 'Independent' };
export const LEVEL_LONG: Record<Level, string> = {
  1: 'Observes the procedure carried out by the supervisor or a senior colleague',
  2: 'Assists the supervisor or senior colleague in performing the procedure',
  3: 'Carries out the whole procedure under direct supervision (supervisor present throughout)',
  4: 'Carries out the whole procedure under indirect supervision (supervisor available)',
  5: 'Carries out the whole procedure independently, with no need for supervision',
};
