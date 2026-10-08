import type { ISODate, Reflection, Rotation } from '../types';
import { rotationEnd } from '../rules/rotations';
import type { DatasetIndex } from './dataset-index';
import { generateInsights, type Insight } from './insights';
import { internshipPeriod, rotationPeriod, type Period } from './periods';
import {
  procedureExposure,
  requirementProgress,
  summarizeProgress,
  uncodedExposure,
  type ProgressSummary,
  type RequirementProgress,
  type UncodedExposure,
} from './progress';
import { computeStats, type PeriodStats } from './stats';
import { progressTimeline, type TimelineStep } from './timeline';

/**
 * Digital clinical portfolio (brief §12, §33): assembled entirely from
 * recorded data. The app does not certify competence; the portfolio says so.
 */

export interface RotationSummary {
  rotation: Rotation;
  period: Period;
  stats: PeriodStats;
  progress: RequirementProgress[];
  summary: ProgressSummary;
  status: 'completed' | 'in_progress' | 'upcoming';
}

export interface DraftSentence {
  text: string;
  /** The recorded figures the sentence rests on. */
  evidence: string;
}

export interface Portfolio {
  asOf: ISODate;
  period: Period;
  totals: PeriodStats;
  rotations: RotationSummary[];
  procedures: ReturnType<typeof procedureExposure>;
  progress: RequirementProgress[];
  progressSummary: ProgressSummary;
  uncoded: UncodedExposure[];
  timeline: TimelineStep[];
  highlights: { important: Reflection[]; milestones: Reflection[]; challenging: Reflection[]; learning: Reflection[] };
  strengths: RequirementProgress[];
  development: RequirementProgress[];
  insights: Insight[];
  draftReflection: DraftSentence[];
  disclaimer: string;
}

export const PORTFOLIO_DISCLAIMER =
  'This portfolio summarises activity recorded by the intern and verified by supervisors where indicated. ' +
  'Procedure counts indicate exposure; they are not, on their own, proof of competence. ' +
  'Competence is assessed by supervisors through the internship evaluation process.';

export function buildPortfolio(ix: DatasetIndex, asOf: ISODate): Portfolio {
  const { internship, requirementSet: set } = ix.ds;
  const through = internship.periodTo < asOf ? internship.periodTo : asOf;
  const totals = computeStats(ix, internship.periodFrom, through);
  const progress = requirementProgress(ix, through);
  const sorted = [...ix.ds.rotations].sort((a, b) => a.startsOn.localeCompare(b.startsOn));

  const rotations: RotationSummary[] = sorted.map((r) => {
    const period = rotationPeriod(r, set);
    const p = progress.filter((x) => x.requirement.rotation === r.rotation);
    const end = rotationEnd(r);
    return {
      rotation: r,
      period,
      stats: computeStats(ix, r.startsOn, end < through ? end : through),
      progress: p,
      summary: summarizeProgress(p),
      status: end < asOf ? 'completed' : r.startsOn <= asOf ? 'in_progress' : 'upcoming',
    };
  });

  const refl = ix.ds.reflections.filter((r) => !r.deletedAt && r.date <= through);
  const tagged = (t: Reflection['tags'][number]) => refl.filter((r) => r.tags.includes(t));

  const strengths = progress
    .filter((p) => p.status === 'met' && p.requirement.minCount >= 5)
    .sort((a, b) => b.verified / b.requirement.minCount - a.verified / a.requirement.minCount)
    .slice(0, 8);
  const development = progress
    .filter((p) => p.status === 'not_met' || p.status === 'behind' || p.status === 'at_risk')
    .sort((a, b) => a.pct - b.pct);

  const portfolio: Portfolio = {
    asOf,
    period: internshipPeriod(internship),
    totals,
    rotations,
    procedures: procedureExposure(ix, through).filter((x) => x.total > 0).sort((a, b) => b.total - a.total),
    progress,
    progressSummary: summarizeProgress(progress),
    uncoded: uncodedExposure(ix, through),
    timeline: progressTimeline(ix, through),
    highlights: {
      important: tagged('important'),
      milestones: tagged('milestone'),
      challenging: tagged('challenging'),
      learning: tagged('learning'),
    },
    strengths,
    development,
    insights: generateInsights(ix, { asOf: through }),
    draftReflection: [],
    disclaimer: PORTFOLIO_DISCLAIMER,
  };
  portfolio.draftReflection = draftReflection(portfolio, set.rotations);
  return portfolio;
}

/**
 * A template-built first draft of the final reflection, for the intern to
 * edit. Every sentence is generated from recorded figures and carries them as
 * evidence; nothing is invented. (AI-assisted drafting is a later phase and
 * will follow the same traceability rule.)
 */
export function draftReflection(p: Portfolio, rotationDefs: { code: string; name: string }[]): DraftSentence[] {
  const out: DraftSentence[] = [];
  const t = p.totals;
  const name = (code: string) => rotationDefs.find((r) => r.code === code)?.name ?? code;
  const completed = p.rotations.filter((r) => r.status === 'completed');

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  out.push({
    text: `Over the internship I recorded ${plural(t.procedures.total, 'procedure')} across ${plural(t.patientsSeen, 'patient')}, in ${plural(completed.length, 'completed rotation')}.`,
    evidence: `Totals ${p.period.from} to ${p.asOf}.`,
  });
  if (t.procedures.total > 0) {
    out.push({
      text: `I carried out ${t.procedures.performed} of these procedures myself (levels 3–5), ${t.procedures.independent} of them independently, and observed or assisted in ${t.procedures.observed + t.procedures.assisted}.`,
      evidence: `By level: ${Object.entries(t.procedures.byLevel).map(([l, n]) => `L${l} ${n}`).join(', ')}.`,
    });
  }
  const busiest = [...p.rotations].filter((r) => r.stats.procedures.total > 0).sort((a, b) => b.stats.procedures.total - a.stats.procedures.total)[0];
  if (busiest) {
    out.push({
      text: `My highest recorded clinical volume was during ${name(busiest.rotation.rotation)} (${busiest.stats.procedures.total} procedures).`,
      evidence: p.rotations.map((r) => `${r.rotation.rotation} ${r.stats.procedures.total}`).join(', '),
    });
  }
  const named = (list: RequirementProgress[]) => list.map((s) => `${s.requirement.description} (${s.requirement.code})`).join('; ');
  if (p.strengths.length) {
    out.push({
      text: `Relative to the logbook minimums, my recorded exposure was strongest in: ${named(p.strengths.slice(0, 3))}.`,
      evidence: p.strengths.slice(0, 3).map((s) => `${s.requirement.code} ${s.verified}/${s.requirement.minCount}`).join(', '),
    });
  }
  // Completed-rotation gaps first: they are settled; in-progress ones may still close.
  const gaps = [...p.development].sort((a, b) => Number(b.status === 'not_met') - Number(a.status === 'not_met') || a.pct - b.pct);
  if (gaps.length) {
    out.push({
      text: `Based on recorded activities, my exposure appears limited in: ${named(gaps.slice(0, 3))}. I plan to seek further supervised experience in these areas.`,
      evidence: gaps.slice(0, 3).map((s) => `${s.requirement.code} ${s.verified}/${s.requirement.minCount}`).join(', '),
    });
  }
  if (p.highlights.milestones.length) {
    out.push({
      text: `Milestones I recorded include: ${p.highlights.milestones
        .slice(0, 3)
        .map((r) => r.title.replace(/\.$/, ''))
        .join('; ')}.`,
      evidence: `${p.highlights.milestones.length} diary entries tagged milestone.`,
    });
  }
  if (p.highlights.challenging.length) {
    out.push({
      text: `I recorded ${p.highlights.challenging.length} challenging cases in my diary; [describe what they taught you].`,
      evidence: `${p.highlights.challenging.length} diary entries tagged challenging.`,
    });
  }
  out.push({
    text: '[Add your own reflection on how your clinical practice developed, what you would do differently, and your goals after internship.]',
    evidence: 'To be written by you.',
  });
  return out;
}
