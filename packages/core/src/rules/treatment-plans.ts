import { getProcedureType } from '../catalogue/procedures';
import type { DatasetIndex } from '../analytics/dataset-index';
import type { Encounter, ID, ISODate, Patient, PlanItem, Rotation, TreatmentPlan } from '../types';
import { addDays, ageOnDate, daysBetween, displayDate } from '../util/dates';
import { rotationEnd } from './rotations';

/**
 * Treatment plans, next-visit briefs and rotation handover (blueprint §11).
 *
 * The clinician sets the plan; the app never proposes a procedure, and
 * logbook targets are not shown here. Logging a visit updates matching plan
 * items (recording what happened); closing a plan stays a clinician action.
 */

export const PLAN_PHASES: { id: PlanItem['phase']; label: string }[] = [
  { id: 'urgent', label: 'Urgent / emergency' },
  { id: 'disease_control', label: 'Disease control' },
  { id: 'definitive', label: 'Definitive treatment' },
  { id: 'review', label: 'Review' },
  { id: 'maintenance', label: 'Maintenance / recall' },
];

export const OPEN_ITEM_STATUSES: PlanItem['status'][] = ['planned', 'in_progress', 'deferred'];

export const ITEM_STATUS_LABELS: Record<PlanItem['status'], string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
  deferred: 'Deferred',
  cancelled: 'Cancelled',
  declined: 'Declined by patient',
  referred: 'Referred',
};

export const isOpen = (i: PlanItem) => OPEN_ITEM_STATUSES.includes(i.status);

const phaseRank = (p: PlanItem['phase']) => PLAN_PHASES.findIndex((x) => x.id === p);

/** Open items in the order they should be done: phase, then due date. */
export function orderedOpenItems(plan: TreatmentPlan): PlanItem[] {
  return plan.items
    .filter(isOpen)
    .sort((a, b) => phaseRank(a.phase) - phaseRank(b.phase) || (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999'));
}

export function itemLabel(i: PlanItem): string {
  const t = getProcedureType(i.procedureTypeId);
  const name = i.otherName ?? t?.shortName ?? i.procedureTypeId;
  return `${name}${i.sites.length ? ` ${i.sites.join(', ')}` : ''}`;
}

/** "stage 1 of 3 done (Access & extirpation); next: Cleaning & shaping" */
export function stageText(i: PlanItem): string | null {
  const t = getProcedureType(i.procedureTypeId);
  if (!t || t.stages <= 1 || !i.stageDone) return null;
  const done = t.stageNames?.[i.stageDone - 1];
  const next = t.stageNames?.[i.stageDone];
  return `stage ${i.stageDone} of ${t.stages} done${done ? ` (${done})` : ''}${next ? `; next: ${next}` : ''}`;
}

export interface PlanUpdate {
  plan: TreatmentPlan;
  /** Plain-language description of each change, shown before saving. */
  changes: string[];
}

const overlaps = (a: string[], b: string[]) => a.length === 0 || b.length === 0 || a.some((x) => b.includes(x));

/**
 * Record a visit against the patient's plan: a matching open item moves to
 * in progress (multi-stage, not final) or completed (single visit or final
 * stage). Nothing else changes.
 */
export function applyEncounterToPlan(plan: TreatmentPlan, encounter: Encounter): PlanUpdate {
  if (plan.status !== 'active') return { plan, changes: [] };
  const items = plan.items.map((i) => ({ ...i }));
  const changes: string[] = [];
  for (const p of encounter.procedures) {
    const type = getProcedureType(p.procedureTypeId);
    // A review or recall is a later visit: the visit at which the plan was agreed does not complete it.
    const laterOnly = (i: PlanItem) => (i.phase === 'review' || i.phase === 'maintenance') && encounter.date <= plan.createdOn;
    const item = items.find((i) => isOpen(i) && !laterOnly(i) && i.procedureTypeId === p.procedureTypeId && overlaps(i.sites, p.sites));
    if (!item || !type) continue;
    const stages = type.stages;
    const stage = p.stage ?? 1;
    const final = p.isFinalStage ?? stage >= stages;
    if (stages > 1 && !final) {
      if ((item.stageDone ?? 0) < stage) {
        item.stageDone = stage;
        item.status = 'in_progress';
        item.lastEncounterId = encounter.id;
        changes.push(`${itemLabel(item)}: ${stageText(item)}`);
      }
    } else {
      item.status = 'completed';
      item.stageDone = stages > 1 ? stages : undefined;
      item.completedOn = encounter.date;
      item.lastEncounterId = encounter.id;
      changes.push(`${itemLabel(item)}: completed`);
    }
  }
  return changes.length ? { plan: { ...plan, items }, changes } : { plan, changes };
}

export function planProgress(plan: TreatmentPlan): { done: number; open: number; total: number } {
  const counted = plan.items.filter((i) => i.status !== 'cancelled');
  const done = counted.filter((i) => i.status === 'completed' || i.status === 'referred' || i.status === 'declined').length;
  return { done, open: counted.filter(isOpen).length, total: counted.length };
}

// ---------------------------------------------------------------------------
// Next-visit brief
// ---------------------------------------------------------------------------

export interface PatientBrief {
  patient: Patient;
  headline: string;
  visits: number;
  firstSeen: ISODate | null;
  lastVisit: { date: ISODate; summary: string; findings: string } | null;
  inProgress: { label: string; detail: string }[];
  next: { label: string; phase: string; dueOn?: ISODate; overdue: boolean }[];
  followUp: string[];
  alerts: string[];
}

export function patientBrief(ix: DatasetIndex, patientId: ID, plans: TreatmentPlan[], today: ISODate): PatientBrief | null {
  const patient = ix.patients.get(patientId);
  if (!patient) return null;
  const visits = ix.encounters.filter((e) => e.patientId === patientId).sort((a, b) => a.date.localeCompare(b.date));
  const last = visits.at(-1);
  const active = plans.filter((p) => p.patientId === patientId && p.status === 'active' && !p.deletedAt);
  const open = active.flatMap(orderedOpenItems);
  const headline = [
    patient.sex === 'F' ? 'Female' : patient.sex === 'M' ? 'Male' : null,
    patient.birthYear ? `${ageOnDate(patient.birthYear, today)} years` : null,
    patient.systemicCondition ? 'systemic condition recorded' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    patient,
    headline: headline || 'No demographic details recorded',
    visits: visits.length,
    firstSeen: visits[0]?.date ?? null,
    lastVisit: last
      ? {
          date: last.date,
          summary: last.procedures.map((p) => `${p.otherName ?? getProcedureType(p.procedureTypeId)?.shortName}${p.sites.length ? ` ${p.sites.join(',')}` : ''}${p.stage ? ` (stage ${p.stage})` : ''}`).join(', ') || 'No procedure',
          findings: last.findings.map((f) => f.term + (f.site ? ` ${f.site}` : '')).join(', '),
        }
      : null,
    inProgress: open.filter((i) => i.status === 'in_progress').map((i) => ({ label: itemLabel(i), detail: stageText(i) ?? 'in progress' })),
    next: open
      .filter((i) => i.status !== 'in_progress')
      .slice(0, 4)
      .map((i) => ({
        label: itemLabel(i),
        phase: PLAN_PHASES.find((p) => p.id === i.phase)?.label ?? i.phase,
        dueOn: i.dueOn,
        overdue: Boolean(i.dueOn && i.dueOn < today),
      })),
    followUp: last ? [last.followUpNeeded ? `Follow-up planned after the visit on ${displayDate(last.date)}.` : '', last.referredTo ? `Referred to ${last.referredTo}.` : ''].filter(Boolean) : [],
    // Prompts to re-confirm, never assumed to be current.
    alerts: [...(patient.alerts ?? []), ...(patient.systemicCondition && !(patient.alerts ?? []).length ? ['Systemic condition'] : [])],
  };
}

// ---------------------------------------------------------------------------
// Due soon and handover
// ---------------------------------------------------------------------------

export interface DueItem {
  plan: TreatmentPlan;
  item: PlanItem;
  patient: Patient | undefined;
  overdue: boolean;
}

/** Open items due within `days` (or overdue), and multi-stage treatments in progress. */
export function dueSoon(ix: DatasetIndex, plans: TreatmentPlan[], today: ISODate, days = 7): DueItem[] {
  const horizon = addDays(today, days);
  const out: DueItem[] = [];
  for (const plan of plans) {
    // A handed-over plan now belongs to the receiving intern.
    if (plan.status !== 'active' || plan.deletedAt || plan.handedOverOn) continue;
    for (const item of orderedOpenItems(plan)) {
      const due = item.dueOn && item.dueOn <= horizon;
      if (due || item.status === 'in_progress') {
        out.push({ plan, item, patient: ix.patients.get(plan.patientId), overdue: Boolean(item.dueOn && item.dueOn < today) });
      }
    }
  }
  return out.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.item.dueOn ?? '9999').localeCompare(b.item.dueOn ?? '9999'));
}

export interface HandoverRow {
  plan: TreatmentPlan;
  patient: Patient | undefined;
  openItems: PlanItem[];
  lastVisit: ISODate | null;
}

/**
 * Patients with unfinished treatment from a rotation: active plans with open
 * items whose most recent visit fell in that rotation (or that were created
 * there and never seen again). Intern duty 2.3 j.
 */
export function handoverList(ix: DatasetIndex, plans: TreatmentPlan[], rotation: Rotation): HandoverRow[] {
  const end = rotationEnd(rotation);
  const inRotation = (d: ISODate) => d >= rotation.startsOn && d <= end;
  const rows: HandoverRow[] = [];
  for (const plan of plans) {
    if (plan.status !== 'active' || plan.deletedAt) continue;
    const openItems = orderedOpenItems(plan);
    if (!openItems.length) continue;
    const visits = ix.encounters.filter((e) => e.patientId === plan.patientId).map((e) => e.date).sort();
    const lastVisit = visits.at(-1) ?? null;
    if ((lastVisit && inRotation(lastVisit)) || (!lastVisit && inRotation(plan.createdOn))) {
      rows.push({ plan, patient: ix.patients.get(plan.patientId), openItems, lastVisit });
    }
  }
  return rows.sort((a, b) => (a.lastVisit ?? '').localeCompare(b.lastVisit ?? ''));
}

/** Days until the rotation ends (negative once it has ended). */
export const daysToRotationEnd = (r: Rotation, today: ISODate) => daysBetween(today, rotationEnd(r));
