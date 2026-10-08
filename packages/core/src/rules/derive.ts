import { communityActivityCode, getActivityType, getProcedureType } from '../catalogue/procedures';
import type {
  Activity,
  CodeMapping,
  CountingRules,
  Encounter,
  EncounterProcedure,
  ID,
  ISODateTime,
  LogbookEntry,
  Patient,
  Requirement,
  RequirementSet,
  RotationCode,
} from '../types';
import { ageOnDate } from '../util/dates';
import { toothClass } from '../util/fdi';

/**
 * Derive logbook entries from what was clinically recorded (blueprint §12).
 *
 * The intern records *what happened*; these rules decide *how it counts*.
 * Every derived entry carries the rule that produced it, and every procedure
 * that does not count gets a plain-language reason, so nothing is silent.
 */

export interface DerivedEntry {
  requirementCode: string;
  encounterProcedureId?: ID;
  activityId?: ID;
  site?: string;
  levelClaimed: LogbookEntry['levelClaimed'];
  rule: string;
}

export interface DerivationNote {
  encounterProcedureId?: ID;
  activityId?: ID;
  site?: string;
  /** Requirement code, or null when the item does not count toward any code. */
  requirementCode: string | null;
  /** Uncoded competency it contributes exposure to (orthodontics, prosthodontics, general). */
  uncoded?: string;
  message: string;
}

export interface Derivation {
  entries: DerivedEntry[];
  notes: DerivationNote[];
}

export interface DeriveContext {
  set: RequirementSet;
  rules: CountingRules;
  /** Rotation code in effect for the encounter or activity (null = outside any rotation). */
  rotation: RotationCode | null;
  patient?: Patient | null;
}

type Failure = { failed: string };

function checkCondition(
  mapping: CodeMapping,
  ctx: DeriveContext,
  date: string,
  site: string | undefined,
  hasDiagnosis: boolean,
  isFinalStage: boolean,
): true | Failure {
  const w = mapping.when;
  if (w.rotation && ctx.rules.rotationScope && ctx.rotation !== w.rotation) {
    return { failed: `only counts during the ${w.rotation} rotation (R1)` };
  }
  if (w.maxAgeExclusive !== undefined) {
    const limit = Math.min(w.maxAgeExclusive, ctx.rules.paediatricMaxAge);
    if (!ctx.patient?.birthYear) return { failed: 'needs the patient\'s birth year to confirm age under 17 (R7)' };
    if (ageOnDate(ctx.patient.birthYear, date) >= limit) return { failed: `patient is not under ${limit} (R7)` };
  }
  if (w.toothClass) {
    const cls = site ? toothClass(site) : null;
    if (!cls) return { failed: 'needs a valid FDI tooth number' };
    if (cls !== w.toothClass) return { failed: `tooth ${site} is ${cls}` };
  }
  if (w.systemicAlert !== undefined) {
    if (!ctx.rules.preferSystemicCode) return { failed: 'systemic-condition code disabled in counting rules' };
    if (Boolean(ctx.patient?.systemicCondition) !== w.systemicAlert) return { failed: 'no systemic condition recorded' };
  }
  if (w.requiresDiagnosis && !hasDiagnosis) {
    return { failed: 'needs at least one diagnosis recorded (R5)' };
  }
  if (w.finalStageOnly && ctx.rules.finalStageOnly && !isFinalStage) {
    return { failed: 'counted once at the final stage (R4)' };
  }
  return true;
}

function requirementIndex(set: RequirementSet): Map<string, Requirement> {
  return new Map(set.requirements.map((r) => [r.code, r]));
}

function isFinal(proc: EncounterProcedure, stages: number): boolean {
  if (proc.isFinalStage !== undefined) return proc.isFinalStage;
  if (stages <= 1) return true;
  return (proc.stage ?? 1) >= stages;
}

/** Derive logbook entries for one encounter. */
export function deriveEncounter(encounter: Encounter, ctx: DeriveContext): Derivation {
  const reqs = requirementIndex(ctx.set);
  const entries: DerivedEntry[] = [];
  const notes: DerivationNote[] = [];
  const hasDiagnosis = encounter.findings.some((f) => f.isDiagnosis);
  // R6: codes counted per patient visit are counted once per encounter.
  const perVisitCodesUsed = new Set<string>();

  for (const proc of encounter.procedures) {
    const type = getProcedureType(proc.procedureTypeId);
    if (!type) {
      notes.push({ encounterProcedureId: proc.id, requirementCode: null, message: 'Unknown procedure type; not counted.' });
      continue;
    }
    const final = isFinal(proc, type.stages);
    // One unit per tooth for tooth procedures; otherwise one per procedure.
    const units: (string | undefined)[] = type.siteKind === 'tooth' && proc.sites.length > 0 ? proc.sites : [proc.sites.join(', ') || undefined];

    for (const site of units) {
      if (type.mappings.length === 0) {
        notes.push({
          encounterProcedureId: proc.id,
          site,
          requirementCode: null,
          uncoded: type.uncoded,
          message: type.uncoded
            ? `Tracked as exposure (${type.uncoded}); the logbook has no code for this.`
            : 'Recorded as clinical exposure; no logbook code applies.',
        });
        continue;
      }
      const reasons: string[] = [];
      let matched: CodeMapping | null = null;
      for (const mapping of type.mappings) {
        const result = checkCondition(mapping, ctx, encounter.date, site, hasDiagnosis, final);
        if (result === true) {
          matched = mapping;
          break;
        }
        reasons.push(`${mapping.requirementCode} ${result.failed}`);
      }
      if (!matched) {
        notes.push({
          encounterProcedureId: proc.id,
          site,
          requirementCode: null,
          message: `Not counted: ${reasons.join('; ')}.`,
        });
        continue;
      }
      const req = reqs.get(matched.requirementCode);
      if (!req) {
        notes.push({ encounterProcedureId: proc.id, site, requirementCode: null, message: `Code ${matched.requirementCode} is not in this requirement set.` });
        continue;
      }
      if (req.unitRule !== 'per_tooth' && req.unitRule !== 'per_case_completion') {
        if (perVisitCodesUsed.has(req.code)) {
          notes.push({
            encounterProcedureId: proc.id,
            site,
            requirementCode: req.code,
            message: `${req.code} already counted for this visit (R6: once per patient visit).`,
          });
          continue;
        }
        perVisitCodesUsed.add(req.code);
      }
      entries.push({
        requirementCode: req.code,
        encounterProcedureId: proc.id,
        site,
        levelClaimed: proc.level,
        rule: matched.rule,
      });
      notes.push({
        encounterProcedureId: proc.id,
        site,
        requirementCode: req.code,
        message: `Will log ${req.code}${site ? ` · ${site}` : ''} (${matched.rule}).`,
      });
    }
  }
  return { entries, notes };
}

/** Derive logbook entries for one non-patient activity. */
export function deriveActivity(activity: Activity, ctx: DeriveContext): Derivation {
  const reqs = requirementIndex(ctx.set);
  const type = getActivityType(activity.activityTypeId);
  if (!type) {
    return { entries: [], notes: [{ activityId: activity.id, requirementCode: null, message: 'Unknown activity type; not counted.' }] };
  }
  const dynamicCode = communityActivityCode(activity);
  if (dynamicCode) {
    if (ctx.rules.rotationScope && ctx.rotation !== 'COMM') {
      return {
        entries: [],
        notes: [{ activityId: activity.id, requirementCode: null, message: `${dynamicCode} only counts during the COMM rotation (R1).` }],
      };
    }
    if (!reqs.has(dynamicCode)) {
      return { entries: [], notes: [{ activityId: activity.id, requirementCode: null, message: `Code ${dynamicCode} is not in this requirement set.` }] };
    }
    return {
      entries: [{ requirementCode: dynamicCode, activityId: activity.id, levelClaimed: activity.level, rule: 'R9 community activity' }],
      notes: [{ activityId: activity.id, requirementCode: dynamicCode, message: `Will log ${dynamicCode} (R9 community activity).` }],
    };
  }
  const reasons: string[] = [];
  for (const mapping of type.mappings) {
    const result = checkCondition(mapping, ctx, activity.date, undefined, false, true);
    if (result === true && reqs.has(mapping.requirementCode)) {
      return {
        entries: [{ requirementCode: mapping.requirementCode, activityId: activity.id, levelClaimed: activity.level, rule: mapping.rule }],
        notes: [{ activityId: activity.id, requirementCode: mapping.requirementCode, message: `Will log ${mapping.requirementCode} (${mapping.rule}).` }],
      };
    }
    if (result !== true) reasons.push(`${mapping.requirementCode} ${result.failed}`);
  }
  return {
    entries: [],
    notes: [
      {
        activityId: activity.id,
        requirementCode: null,
        message: reasons.length ? `Not counted: ${reasons.join('; ')}.` : 'Recorded as activity; no logbook code applies.',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Reconciling a new derivation with entries already stored
// ---------------------------------------------------------------------------

export interface Reconciliation {
  create: LogbookEntry[];
  update: LogbookEntry[];
  withdraw: LogbookEntry[];
  /** Verified/locked entries whose source no longer produces them: need a correction, never a silent change. */
  conflicts: LogbookEntry[];
}

const entryKey = (e: { requirementCode: string; encounterProcedureId?: ID; activityId?: ID; site?: string }) =>
  `${e.encounterProcedureId ?? ''}|${e.activityId ?? ''}|${e.site ?? ''}|${e.requirementCode}`;

/**
 * Match freshly derived entries to stored ones so IDs and verification status
 * survive edits. Unverified entries that no longer apply are withdrawn;
 * verified ones are never changed (blueprint: corrections, not edits).
 */
export function reconcileEntries(
  derived: DerivedEntry[],
  existing: LogbookEntry[],
  base: {
    internshipId: ID;
    rotationId: ID | null;
    performedOn: string;
    encounterId?: ID;
    patientRef?: string;
    supervisorId?: ID | null;
    status: 'draft' | 'submitted';
  },
  now: ISODateTime,
  makeId: () => ID,
): Reconciliation {
  const live = existing.filter((e) => e.status !== 'withdrawn');
  const byKey = new Map(live.map((e) => [entryKey(e), e]));
  const seen = new Set<string>();
  const out: Reconciliation = { create: [], update: [], withdraw: [], conflicts: [] };

  for (const d of derived) {
    const key = entryKey(d);
    seen.add(key);
    const prev = byKey.get(key);
    const fields = {
      rotationId: base.rotationId,
      performedOn: base.performedOn,
      patientRef: base.patientRef,
      supervisorId: base.supervisorId ?? null,
      levelClaimed: d.levelClaimed,
      rule: d.rule,
    };
    if (!prev) {
      out.create.push({
        id: makeId(),
        internshipId: base.internshipId,
        requirementCode: d.requirementCode,
        encounterId: base.encounterId,
        encounterProcedureId: d.encounterProcedureId,
        activityId: d.activityId,
        site: d.site,
        status: base.status,
        createdAt: now,
        updatedAt: now,
        ...fields,
      });
      continue;
    }
    const changed =
      prev.rotationId !== fields.rotationId ||
      prev.performedOn !== fields.performedOn ||
      prev.patientRef !== fields.patientRef ||
      (prev.supervisorId ?? null) !== fields.supervisorId ||
      prev.levelClaimed !== fields.levelClaimed ||
      prev.rule !== fields.rule;
    if (!changed) continue;
    if (prev.status === 'verified' || prev.status === 'locked') {
      out.conflicts.push(prev);
    } else {
      // A returned entry that the intern fixes goes back to the supervisor.
      const status = prev.status === 'returned' ? 'submitted' : prev.status;
      out.update.push({ ...prev, ...fields, status, updatedAt: now });
    }
  }
  for (const e of live) {
    if (seen.has(entryKey(e))) continue;
    if (e.status === 'verified' || e.status === 'locked') out.conflicts.push(e);
    else out.withdraw.push({ ...e, status: 'withdrawn', updatedAt: now });
  }
  return out;
}
