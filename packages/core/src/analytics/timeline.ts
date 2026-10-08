import type { ISODate, Reflection } from '../types';
import type { DatasetIndex } from './dataset-index';
import { internshipMonths, type Period } from './periods';
import { levelMilestones, type LevelMilestone } from './progress';
import { computeStats, type PeriodStats } from './stats';

/**
 * Internship progress timeline (brief §32): one step per internship month,
 * with in-month and cumulative totals and a headline. Headlines are derived
 * descriptively from the numbers and are labelled as such.
 */

export interface TimelineStep {
  period: Period;
  stats: PeriodStats;
  cumulativeProcedures: number;
  cumulativePatients: number;
  /** Share of procedures at levels 3–5 in the month. */
  performedShare: number;
  rotations: string[];
  /** Rotation codes that started in this month. */
  startedRotations: string[];
  headline: string;
  /** Codes that reached a new verified level this month. */
  levelUps: LevelMilestone[];
  milestones: Reflection[];
  /** True while the month is still in progress. */
  partial: boolean;
}

export function progressTimeline(ix: DatasetIndex, asOf: ISODate): TimelineStep[] {
  const months = internshipMonths(ix.ds.internship, asOf);
  const ups = levelMilestones(ix, asOf);
  const rotations = [...ix.ds.rotations].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const steps: TimelineStep[] = [];
  let cumProc = 0;
  const seenPatients = new Set<string>();

  months.forEach((m, i) => {
    const to = m.to < asOf ? m.to : asOf;
    const stats = computeStats(ix, m.from, to);
    cumProc += stats.procedures.total;
    for (const e of ix.encounters) if (e.date >= m.from && e.date <= to && e.patientId) seenPatients.add(e.patientId);
    const inMonth = rotations.filter((r) => r.startsOn <= to && r.endsOn >= m.from);
    const started = rotations.filter((r) => r.startsOn >= m.from && r.startsOn <= to);
    const share = stats.procedures.total ? stats.procedures.performed / stats.procedures.total : 0;
    const prev = steps[i - 1];
    steps.push({
      period: m,
      stats,
      cumulativeProcedures: cumProc,
      cumulativePatients: seenPatients.size,
      performedShare: share,
      rotations: inMonth.map((r) => r.rotation),
      startedRotations: started.map((r) => r.rotation),
      headline: headlineFor(i, stats, share, prev, started.map((r) => r.rotation), ix),
      levelUps: ups.filter((u) => u.on >= m.from && u.on <= to),
      milestones: ix.ds.reflections.filter((r) => !r.deletedAt && r.tags.includes('milestone') && r.date >= m.from && r.date <= to),
      partial: m.to > asOf,
    });
  });
  return steps;
}

function headlineFor(
  i: number,
  s: PeriodStats,
  share: number,
  prev: TimelineStep | undefined,
  started: string[],
  ix: DatasetIndex,
): string {
  if (i === 0) return 'Orientation and initial clinical exposure';
  if (started.length) {
    const name = ix.ds.requirementSet.rotations.find((r) => r.code === started[0])?.name ?? started[0];
    return `New rotation: ${name}`;
  }
  if (s.activities > s.procedures.total) return 'Community and activity-based learning';
  if (!prev || s.procedures.total === 0) return 'Limited recorded activity';
  if (s.procedures.independent > prev.stats.procedures.independent * 1.25 && s.procedures.independent >= 5) {
    return 'Independent procedures increasing';
  }
  if (share >= prev.performedShare + 0.1) return 'Increasing hands-on participation';
  if (s.byProcedure.length > prev.stats.byProcedure.length + 2) return 'Broader clinical exposure';
  if (s.procedures.total > prev.stats.procedures.total * 1.2) return 'Higher clinical volume';
  if (s.procedures.total < prev.stats.procedures.total * 0.7) return 'Lower recorded volume';
  return 'Consolidating clinical exposure';
}
