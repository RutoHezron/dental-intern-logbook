import type { ISODate, Reflection, Verification } from '../types';
import { sha256, stableStringify } from '../util/hash';
import type { DatasetIndex } from './dataset-index';
import { generateInsights, type Insight } from './insights';
import { previousPeriod, type Period } from './periods';
import { requirementProgress, summarizeProgress, type ProgressSummary, type RequirementProgress } from './progress';
import { compareStats, computeStats, type Delta, type PeriodStats } from './stats';

/**
 * Period reports (brief §9–11). A report is a pure function of the recorded
 * data: activity *during* the period, *cumulative* activity since the start
 * of the internship, and the comparison with the previous period. Nothing in
 * a report is typed by hand, so reports compound automatically.
 */

export interface CodeGain {
  code: string;
  description: string;
  rotation: string;
  /** Entries logged in the period. */
  gained: number;
  verifiedInPeriod: number;
  /** Verified up to the end of the period. */
  totalVerified: number;
  minCount: number;
}

export interface SupervisorFeedbackItem {
  verification: Verification;
  code: string;
  performedOn: ISODate;
}

export interface Report {
  kind: Period['kind'];
  period: Period;
  previous: Period | null;
  asOf: ISODate;
  /** End of the counted range: period end, or asOf for a period still in progress. */
  through: ISODate;
  partial: boolean;
  stats: PeriodStats;
  cumulative: PeriodStats;
  previousStats: PeriodStats | null;
  deltas: Delta[];
  codeGains: CodeGain[];
  progress: RequirementProgress[];
  progressSummary: ProgressSummary;
  gaps: RequirementProgress[];
  strengths: RequirementProgress[];
  learning: {
    themes: { tag: string; count: number }[];
    highlights: Reflection[];
    challenges: { date: ISODate; text: string }[];
    toRevise: { date: ISODate; text: string }[];
    exposureWanted: { date: ISODate; text: string }[];
    learned: { date: ISODate; text: string }[];
  };
  supervisorFeedback: {
    comments: SupervisorFeedbackItem[];
    verified: number;
    returned: number;
    levelAdjusted: number;
  };
  insights: Insight[];
  dataQuality: { lateEntries: number };
}

export function buildReport(ix: DatasetIndex, period: Period, asOf: ISODate): Report {
  const { internship, rotations, requirementSet } = ix.ds;
  const through = period.to < asOf ? period.to : asOf;
  const stats = computeStats(ix, period.from, through);
  const cumulative = computeStats(ix, internship.periodFrom, through);
  const prevPeriod = previousPeriod(period, internship, rotations, requirementSet);
  const previousStats = prevPeriod ? computeStats(ix, prevPeriod.from, prevPeriod.to) : null;

  // Progress is shown for rotations that overlap the period (all of them for the internship report).
  const overlapping = new Set(rotations.filter((r) => r.startsOn <= through && r.endsOn >= period.from).map((r) => r.rotation));
  const allProgress = requirementProgress(ix, through);
  const progress = period.kind === 'internship' ? allProgress : allProgress.filter((p) => overlapping.has(p.requirement.rotation));

  const codeGains: CodeGain[] = [];
  for (const p of allProgress) {
    const inPeriod = stats.byCode[p.requirement.code];
    if (!inPeriod) continue;
    codeGains.push({
      code: p.requirement.code,
      description: p.requirement.description,
      rotation: p.requirement.rotation,
      gained: inPeriod.logged,
      verifiedInPeriod: inPeriod.verified,
      totalVerified: p.verified,
      minCount: p.requirement.minCount,
    });
  }
  codeGains.sort((a, b) => b.gained - a.gained);

  const refl = ix.ds.reflections.filter((r) => !r.deletedAt && r.date >= period.from && r.date <= through);
  const texts = (pick: (r: Reflection) => string | undefined) =>
    refl.flatMap((r) => (pick(r)?.trim() ? [{ date: r.date, text: pick(r)!.trim() }] : []));

  const entryById = new Map(ix.entries.map((e) => [e.id, e]));
  const vInPeriod = ix.ds.verifications.filter((v) => v.signedAt.slice(0, 10) >= period.from && v.signedAt.slice(0, 10) <= through);
  const comments: SupervisorFeedbackItem[] = [];
  let levelAdjusted = 0;
  for (const v of vInPeriod) {
    const e = entryById.get(v.entryId);
    if (!e) continue;
    if (v.levelObserved && v.levelObserved !== e.levelClaimed) levelAdjusted++;
    if (v.comment?.trim()) comments.push({ verification: v, code: e.requirementCode, performedOn: e.performedOn });
  }

  const lateDays = ix.ds.rules.lateEntryDays;
  const lateEntries = ix.entries.filter(
    (e) => e.performedOn >= period.from && e.performedOn <= through && (Date.parse(e.createdAt) - Date.parse(e.performedOn)) / 86_400_000 > lateDays + 1,
  ).length;

  return {
    kind: period.kind,
    period,
    previous: prevPeriod,
    asOf,
    through,
    partial: period.to > asOf,
    stats,
    cumulative,
    previousStats,
    deltas: previousStats ? compareStats(stats, previousStats) : [],
    codeGains,
    progress,
    progressSummary: summarizeProgress(progress),
    gaps: progress
      .filter((p) => ['behind', 'at_risk', 'not_met'].includes(p.status))
      .sort((a, b) => a.pct - b.pct),
    strengths: progress.filter((p) => p.status === 'met' && p.requirement.minCount >= 5).sort((a, b) => b.verified / b.requirement.minCount - a.verified / a.requirement.minCount),
    learning: {
      themes: Object.entries(stats.reflections.byTag)
        .map(([tag, count]) => ({ tag, count: count ?? 0 }))
        .sort((a, b) => b.count - a.count),
      highlights: refl.filter((r) => r.tags.includes('important') || r.tags.includes('milestone')),
      challenges: texts((r) => r.challenged),
      toRevise: texts((r) => r.revise),
      exposureWanted: texts((r) => r.needExposure),
      learned: texts((r) => r.learned),
    },
    supervisorFeedback: {
      comments,
      verified: vInPeriod.filter((v) => v.decision === 'verified').length,
      returned: vInPeriod.filter((v) => v.decision === 'returned').length,
      levelAdjusted,
    },
    insights: generateInsights(ix, { asOf: through, period, previous: prevPeriod }),
    dataQuality: { lateEntries },
  };
}

/**
 * Freeze a report for submission or export. The hash lets anyone check later
 * that a finalised report was not altered, and lets the app show when the
 * underlying data has changed since it was finalised.
 */
export interface ReportSnapshot {
  id: string;
  kind: Period['kind'];
  label: string;
  from: ISODate;
  to: ISODate;
  finalisedAt: string;
  payload: unknown;
  sha256: string;
}

export function snapshotReport(report: Report, id: string, finalisedAt: string): ReportSnapshot {
  const payload = {
    period: report.period,
    through: report.through,
    stats: report.stats,
    cumulative: report.cumulative,
    codeGains: report.codeGains,
    progress: report.progress.map((p) => ({
      code: p.requirement.code,
      logged: p.logged,
      verified: p.verified,
      atExpectedLevel: p.atExpectedLevel,
      min: p.requirement.minCount,
    })),
  };
  return {
    id,
    kind: report.kind,
    label: `${report.period.label} (${report.period.sublabel})`,
    from: report.period.from,
    to: report.period.to,
    finalisedAt,
    payload,
    sha256: sha256(stableStringify(payload)),
  };
}

export function snapshotMatches(snapshot: ReportSnapshot, current: Report): boolean {
  return snapshotReport(current, snapshot.id, snapshot.finalisedAt).sha256 === snapshot.sha256;
}
