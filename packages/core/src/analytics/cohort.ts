import type { ID, ISODate, RequirementSet, Rotation } from '../types';
import { assessmentSchedule } from '../rules/assessments';
import { CASE_REPORTS_PER_ROTATION } from '../rules/case-reports';
import { rotationEnd, rotationForDate } from '../rules/rotations';
import { daysBetween } from '../util/dates';
import { emptyLevels } from './stats';
import { statusFor, summarizeProgress, type ProgressSummary, type RequirementProgress } from './progress';

/**
 * Coordinator cohort view (V2 scope, web). An intern may share their progress
 * with their internship coordinator. The coordinator never receives entries,
 * patients or visits: the server sends counts per logbook code (computed from
 * statuses only a verification can set), rotation dates, whether each
 * assessment was held with its overall grade and outcome, and case-report
 * counts. Progress is then worked out with the same rules as the intern's own
 * dashboard. Counts show recorded exposure, never competence.
 */

export interface CodeCounts {
  code: string;
  logged: number;
  verified: number;
  pending: number;
  returned: number;
  lastOn: ISODate | null;
}

export interface SharedAssessment {
  rotationId: ID | null;
  kind: string;
  sequence: number;
  heldOn: ISODate | null;
  overallGrade: number | null;
  outcome: string | null;
}

export interface SharedProgress {
  ownerId: ID;
  sharedAt: string;
  internName: string;
  licenceNo?: string;
  institution?: string;
  facilityName?: string;
  periodFrom: ISODate;
  periodTo: ISODate;
  rotations: Rotation[];
  counts: CodeCounts[];
  assessments: SharedAssessment[];
  caseReports: { rotationId: ID | null; status: string }[];
}

export interface CohortRotation {
  rotation: Rotation;
  summary: ProgressSummary;
  /** Codes below pace or not met, lowest first. */
  attention: { code: string; verified: number; min: number; status: RequirementProgress['status'] }[];
  formsOverdue: number;
  formsHeld: number;
  formsDue: number;
  caseReportsVerified: number;
  caseReportsExpected: number;
}

export interface CohortMember {
  share: SharedProgress;
  current: Rotation | null;
  overall: ProgressSummary;
  rotations: CohortRotation[];
  pending: number;
  returned: number;
  lastEntryOn: ISODate | null;
  /** Plain flags for the coordinator's attention; facts, not judgements. */
  flags: string[];
}

const INACTIVE_DAYS = 14;

export function cohortMember(share: SharedProgress, set: RequirementSet, asOf: ISODate): CohortMember {
  const counts = new Map(share.counts.map((c) => [c.code, c]));
  const progress: RequirementProgress[] = set.requirements.map((req) => {
    const c = counts.get(req.code);
    const p: RequirementProgress = {
      requirement: req,
      rotation: share.rotations.find((r) => r.rotation === req.rotation) ?? null,
      logged: c?.logged ?? 0,
      verified: c?.verified ?? 0,
      pending: c?.pending ?? 0,
      returned: c?.returned ?? 0,
      atExpectedLevel: 0,
      remaining: Math.max(0, req.minCount - (c?.verified ?? 0)),
      pct: req.minCount === 0 ? 1 : Math.min(1, (c?.verified ?? 0) / req.minCount),
      levels: emptyLevels(),
      highestVerifiedLevel: 0,
      forecast: null,
      status: 'upcoming',
      lastOn: c?.lastOn ?? null,
    };
    p.status = statusFor(p, asOf);
    return p;
  });

  const rotations: CohortRotation[] = [...share.rotations]
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))
    .map((rotation) => {
      const list = progress.filter((p) => p.requirement.rotation === rotation.rotation);
      const due = assessmentSchedule(rotation).filter((f) => f.due <= asOf);
      const held = due.filter((f) => share.assessments.some((a) => a.rotationId === rotation.id && a.kind === f.kind && a.sequence === f.sequence && a.heldOn));
      return {
        rotation,
        summary: summarizeProgress(list),
        attention: list
          .filter((p) => p.status === 'behind' || p.status === 'at_risk' || p.status === 'not_met')
          .sort((a, b) => a.pct - b.pct)
          .map((p) => ({ code: p.requirement.code, verified: p.verified, min: p.requirement.minCount, status: p.status })),
        formsDue: due.length,
        formsHeld: held.length,
        formsOverdue: due.length - held.length,
        caseReportsVerified: share.caseReports.filter((c) => c.rotationId === rotation.id && c.status === 'verified').length,
        caseReportsExpected: CASE_REPORTS_PER_ROTATION,
      };
    });

  const current = rotationForDate(share.rotations, asOf);
  const lastEntryOn = share.counts.reduce<ISODate | null>((m, c) => (c.lastOn && (!m || c.lastOn > m) ? c.lastOn : m), null);
  const pending = share.counts.reduce((n, c) => n + c.pending, 0);
  const returned = share.counts.reduce((n, c) => n + c.returned, 0);

  const flags: string[] = [];
  const overdue = rotations.reduce((n, r) => n + r.formsOverdue, 0);
  if (overdue) flags.push(`${overdue} assessment form${overdue === 1 ? '' : 's'} past due and not yet held`);
  const notMet = rotations.filter((r) => rotationEnd(r.rotation) < asOf && r.summary.notMet > 0);
  if (notMet.length) flags.push(`Minimums not met in ${notMet.map((r) => r.rotation.rotation).join(', ')} (rotation ended)`);
  const cur = rotations.find((r) => r.rotation.id === current?.id);
  if (cur && cur.summary.behind > 0) flags.push(`${cur.summary.behind} code${cur.summary.behind === 1 ? '' : 's'} behind pace in ${cur.rotation.rotation}`);
  if (returned) flags.push(`${returned} entr${returned === 1 ? 'y' : 'ies'} returned for correction`);
  if (current && (!lastEntryOn || daysBetween(lastEntryOn, asOf) > INACTIVE_DAYS)) flags.push(`No entries in the last ${INACTIVE_DAYS} days`);

  return { share, current, overall: summarizeProgress(progress), rotations, pending, returned, lastEntryOn, flags };
}

