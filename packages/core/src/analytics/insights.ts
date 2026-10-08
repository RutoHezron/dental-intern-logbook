import type { ISODate } from '../types';
import { rotationEnd, rotationForDate } from '../rules/rotations';
import { daysBetween } from '../util/dates';
import type { DatasetIndex } from './dataset-index';
import type { Period } from './periods';
import { requirementProgress, uncodedExposure, type RequirementProgress } from './progress';
import { computeStats, type PeriodStats } from './stats';

/**
 * Rule-based insights (brief §14). Every insight states the recorded numbers
 * it rests on (`evidence`) and whether it is a plain restatement of recorded
 * data or an interpretation. Wording speaks of recorded exposure, never
 * competence, and never suggests a treatment for a patient.
 */

export type InsightQuestion = 'doing' | 'done' | 'missing' | 'improving' | 'struggling' | 'next';
export type InsightTone = 'positive' | 'neutral' | 'attention';

export interface Insight {
  id: string;
  question: InsightQuestion;
  tone: InsightTone;
  text: string;
  evidence: string;
  basis: 'recorded' | 'interpretation';
  codes?: string[];
  /** Higher = more important; used for ordering. */
  weight: number;
}

export const QUESTION_LABELS: Record<InsightQuestion, string> = {
  doing: 'What am I doing?',
  done: 'What have I done?',
  missing: 'What am I missing?',
  improving: 'Where am I improving?',
  struggling: 'Where am I struggling?',
  next: 'What should I focus on next?',
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface InsightOptions {
  asOf: ISODate;
  period?: Period;
  previous?: Period | null;
}

export function generateInsights(ix: DatasetIndex, opts: InsightOptions): Insight[] {
  const out: Insight[] = [];
  const { asOf } = opts;
  const set = ix.ds.requirementSet;
  const rotName = (code: string) => set.rotations.find((r) => r.code === code)?.name ?? code;
  const progress = requirementProgress(ix, asOf);

  // --- Period activity and trends ------------------------------------------
  let cur: PeriodStats | null = null;
  if (opts.period) {
    cur = computeStats(ix, opts.period.from, opts.period.to < asOf ? opts.period.to : asOf);
    out.push({
      id: 'period-summary',
      question: 'doing',
      tone: 'neutral',
      text: `${opts.period.label}: ${plural(cur.patientsSeen, 'patient')} seen and ${plural(cur.procedures.total, 'procedure')} recorded, ${cur.procedures.performed} of them performed (levels 3–5).`,
      evidence: `${cur.encounters} encounters, ${cur.activities} activities between ${cur.from} and ${cur.to}.`,
      basis: 'recorded',
      weight: 50,
    });
  }
  if (opts.period && opts.previous && cur) {
    const prev = computeStats(ix, opts.previous.from, opts.previous.to);
    const prevById = new Map(prev.byProcedure.map((p) => [p.id, p]));
    const ids = new Set([...cur.byProcedure.map((p) => p.id), ...prev.byProcedure.map((p) => p.id)]);
    const trends: Insight[] = [];
    for (const id of ids) {
      const c = cur.byProcedure.find((p) => p.id === id);
      const p = prevById.get(id);
      const cn = c?.total ?? 0;
      const pn = p?.total ?? 0;
      const name = (c ?? p)!.name;
      if (Math.max(cn, pn) < 5) continue;
      const change = cn - pn;
      if (Math.abs(change) < 4 || (pn > 0 && Math.abs(change) / pn < 0.3)) continue;
      trends.push({
        id: `trend-${id}`,
        question: change > 0 ? 'improving' : 'doing',
        tone: change > 0 ? 'positive' : 'neutral',
        text: `You recorded ${cn} ${name.toLowerCase()} in ${opts.period.label}, compared with ${pn} in ${opts.previous.label}.`,
        evidence: `${name}: ${pn} → ${cn} (${change > 0 ? '+' : ''}${change}).`,
        basis: 'recorded',
        weight: 30 + Math.min(20, Math.abs(change)),
      });
    }
    out.push(...trends.sort((a, b) => b.weight - a.weight).slice(0, 3));

    if (cur.procedures.total >= 10 && prev.procedures.total >= 10) {
      const cs = cur.procedures.performed / cur.procedures.total;
      const ps = prev.procedures.performed / prev.procedures.total;
      if (Math.abs(cs - ps) >= 0.1) {
        out.push({
          id: 'participation-shift',
          question: cs > ps ? 'improving' : 'struggling',
          tone: cs > ps ? 'positive' : 'attention',
          text:
            cs > ps
              ? `A larger share of your procedures were carried out by you (levels 3–5): ${pct(cs)}, up from ${pct(ps)}.`
              : `A smaller share of your procedures were carried out by you (levels 3–5): ${pct(cs)}, down from ${pct(ps)}. This can reflect a new rotation with more complex cases.`,
          evidence: `${cur.procedures.performed}/${cur.procedures.total} vs ${prev.procedures.performed}/${prev.procedures.total}.`,
          basis: cs > ps ? 'recorded' : 'interpretation',
          weight: 45,
        });
      }
    }
  }

  // --- Cumulative participation balance ------------------------------------
  const all = computeStats(ix, ix.ds.internship.periodFrom, asOf);
  if (all.procedures.total >= 20) {
    const watched = all.procedures.observed + all.procedures.assisted;
    if (watched > all.procedures.performed) {
      out.push({
        id: 'observation-heavy',
        question: 'struggling',
        tone: 'attention',
        text: `You have observed or assisted in more procedures (${watched}) than you carried out yourself (${all.procedures.performed}). Consider discussing graduated hands-on opportunities with your supervisor.`,
        evidence: `Levels 1–2: ${watched}; levels 3–5: ${all.procedures.performed} since ${ix.ds.internship.periodFrom}.`,
        basis: 'interpretation',
        weight: 40,
      });
    } else {
      out.push({
        id: 'hands-on',
        question: 'done',
        tone: 'positive',
        text: `${pct(all.procedures.performed / all.procedures.total)} of your recorded procedures were carried out by you (levels 3–5); ${all.procedures.independent} were independent (level 5).`,
        evidence: `${all.procedures.performed} of ${all.procedures.total} procedures since ${ix.ds.internship.periodFrom}.`,
        basis: 'recorded',
        weight: 20,
      });
    }
  }

  // --- Current rotation: pace and gaps ----------------------------------------
  const current = rotationForDate(ix.ds.rotations, asOf);
  if (current) {
    const end = rotationEnd(current);
    const daysLeft = daysBetween(asOf, end);
    const curProg = progress.filter((p) => p.requirement.rotation === current.rotation);
    const behind = curProg
      .filter((p) => p.status === 'behind' || p.status === 'at_risk')
      .sort((a, b) => a.pct - b.pct);
    for (const p of behind.slice(0, 3)) {
      // A pace forecast is meaningless for one-off items such as a single meeting.
      const forecast = p.requirement.minCount <= 2 ? null : p.forecast;
      out.push({
        id: `pace-${p.requirement.code}`,
        question: 'missing',
        tone: 'attention',
        text: `Recorded exposure to ${p.requirement.code} (${p.requirement.description}) is ${p.verified} verified of ${p.requirement.minCount}, with ${plural(daysLeft, 'day')} of the rotation left${forecast !== null ? `. At the current pace you would log about ${forecast}` : ''}.`,
        evidence: `${p.logged} logged, ${p.verified} verified, minimum ${p.requirement.minCount}.`,
        basis: forecast !== null ? 'interpretation' : 'recorded',
        codes: [p.requirement.code],
        weight: p.status === 'behind' ? 70 : 55,
      });
    }
    if (behind.length > 0) {
      out.push({
        id: 'next-focus',
        question: 'next',
        tone: 'neutral',
        text: `Consider discussing additional exposure to ${behind
          .slice(0, 3)
          .map((p) => p.requirement.code)
          .join(', ')} with your supervisor. Clinical need always comes first — targets should never decide a patient's treatment.`,
        evidence: `${behind.length} code(s) in ${current.rotation} are behind pace.`,
        basis: 'interpretation',
        codes: behind.map((p) => p.requirement.code),
        weight: 60,
      });
    }
    if (daysLeft >= 0 && daysLeft <= 14) {
      const open = curProg.filter((p) => p.status !== 'met').length;
      out.push({
        id: 'rotation-ending',
        question: 'next',
        tone: open ? 'attention' : 'positive',
        text: `Your ${rotName(current.rotation)} rotation ends in ${plural(daysLeft, 'day')}.${open ? ` ${plural(open, 'code')} ${open === 1 ? 'is' : 'are'} not yet met.` : ' All codes are met (default rules).'}`,
        evidence: `Rotation ends ${end}.`,
        basis: 'recorded',
        weight: 65,
      });
    }
  }

  // --- Completed rotations: strengths and limited exposure ---------------------
  const finished = ix.ds.rotations.filter((r) => rotationEnd(r) < asOf);
  for (const r of finished) {
    const list = progress.filter((p) => p.requirement.rotation === r.rotation);
    const met = list.filter((p) => p.status === 'met');
    const notMet = list.filter((p) => p.status === 'not_met');
    if (list.length && met.length / list.length >= 0.75) {
      out.push({
        id: `strength-${r.rotation}`,
        question: 'done',
        tone: 'positive',
        text: `${rotName(r.rotation)}: minimum met for ${met.length} of ${list.length} codes (default rules).`,
        evidence: met.map((p) => `${p.requirement.code} ${p.verified}/${p.requirement.minCount}`).join(', '),
        basis: 'recorded',
        codes: met.map((p) => p.requirement.code),
        weight: 25,
      });
    }
    if (notMet.length) {
      out.push({
        id: `limited-${r.rotation}`,
        question: 'missing',
        tone: 'attention',
        text: `${rotName(r.rotation)}: exposure appears limited based on recorded activities for ${notMet
          .map((p) => `${p.requirement.code} (${p.verified} of ${p.requirement.minCount})`)
          .join(', ')}.`,
        evidence: `${notMet.length} code(s) below minimum at rotation end.`,
        basis: 'recorded',
        codes: notMet.map((p) => p.requirement.code),
        weight: 50,
      });
    }
  }

  // --- Level below expectation, judged on the most recent verified entries ----
  // Early entries are naturally below the expected level, so whole-history
  // ratios would flag every code; the latest entries show where the intern is now.
  const RECENT = 8;
  const completed = ix.ds.rules.completedStatuses;
  const recentByCode = new Map<string, number[]>();
  for (const e of ix.entries) {
    if (e.performedOn > asOf || !completed.includes(e.status)) continue;
    const list = recentByCode.get(e.requirementCode) ?? [];
    list.push(ix.effLevel(e));
    if (list.length > RECENT) list.shift();
    recentByCode.set(e.requirementCode, list);
  }
  const levelGaps = progress.filter((p) => {
    const recent = recentByCode.get(p.requirement.code) ?? [];
    if (recent.length < 5 || p.requirement.expectedLevel < 3) return false;
    return recent.filter((l) => l >= p.requirement.expectedLevel).length / recent.length < 0.25;
  });
  for (const p of levelGaps.slice(0, 3)) {
    const recent = recentByCode.get(p.requirement.code)!;
    const atLevel = recent.filter((l) => l >= p.requirement.expectedLevel).length;
    out.push({
      id: `level-${p.requirement.code}`,
      question: 'struggling',
      tone: 'attention',
      text: `Of your ${recent.length} most recent verified ${p.requirement.code} entries, ${atLevel} reached the expected level ${p.requirement.expectedLevel}. Consider discussing graduated independence with your supervisor.`,
      evidence: `Recent levels: ${recent.map((l) => `L${l}`).join(', ')}. ${levelsText(p)}`,
      basis: 'interpretation',
      codes: [p.requirement.code],
      weight: 42,
    });
  }

  // --- Verification backlog and returns ------------------------------------------
  const stale = ix.entries.filter((e) => (e.status === 'submitted' || e.status === 'returned') && daysBetween(e.performedOn, asOf) > 7);
  if (stale.length) {
    out.push({
      id: 'verification-backlog',
      question: 'next',
      tone: 'attention',
      text: `${plural(stale.length, 'logbook entry', 'logbook entries')} ${stale.length === 1 ? 'has' : 'have'} waited more than 7 days for verification.`,
      evidence: `${stale.filter((e) => e.status === 'returned').length} returned for correction, ${stale.filter((e) => e.status === 'submitted').length} awaiting supervisor.`,
      basis: 'recorded',
      weight: 58,
    });
  }

  // --- Uncoded areas (orthodontics, prosthodontics) ----------------------------------
  const uncoded = uncodedExposure(ix, asOf);
  for (const area of ['Orthodontics', 'Prosthodontics']) {
    const relevantRotation = area === 'Orthodontics' ? 'PAED' : 'CONS';
    const rot = ix.ds.rotations.find((r) => r.rotation === relevantRotation);
    if (!rot || rot.startsOn > asOf) continue;
    const total = uncoded.filter((u) => u.competency.area === area).reduce((n, u) => n + u.total, 0);
    if (total < 5) {
      out.push({
        id: `uncoded-${area}`,
        question: 'missing',
        tone: 'attention',
        text: `Limited recorded exposure to ${area.toLowerCase()} (${plural(total, 'entry', 'entries')}). The logbook expects it but has no code for it, so it is easy to overlook.`,
        evidence: `KMPDC ${area === 'Orthodontics' ? '4.4.2' : '4.6.2'}; ${total} recorded.`,
        basis: 'recorded',
        weight: 35,
      });
    }
  }

  return out.sort((a, b) => b.weight - a.weight);
}

function levelsText(p: RequirementProgress): string {
  return `Levels logged: ${Object.entries(p.levels)
    .filter(([, n]) => n > 0)
    .map(([l, n]) => `L${l}×${n}`)
    .join(', ')}.`;
}
