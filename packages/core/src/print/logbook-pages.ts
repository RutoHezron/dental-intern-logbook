import { COMMUNITY_CASE_TYPES, COMMUNITY_ITEMS, FOLLOW_UP_STEPS } from '../catalogue/kmpdc-dental-3rd-2024';
import type { DatasetIndex } from '../analytics/dataset-index';
import type { ISODate, Level, LogbookEntry, Requirement, Rotation } from '../types';
import { rotationEnd } from '../rules/rotations';
import { sha256, stableStringify } from '../util/hash';

/**
 * Print model for the KMPDC paper logbook (5.x.4 Case and Procedure Log,
 * 5.x.5 Log of Case Reports, 5.7.4–5.7.6 community logs). Rows are filled
 * from verified entries in date order, at the supervisor's observed level,
 * each carrying its digital verification reference; every table carries an
 * integrity code. The printed page still takes the supervisor's wet signature
 * and stamp until KMPDC accepts digital sign-off (blueprint §13.2).
 */

export interface PrintOptions {
  /** Also print entries awaiting verification, marked as such (for wet-ink-only signing). */
  includePending: boolean;
  /** Pad each table with blank rows up to the paper book's row count. */
  fillToBookRows: boolean;
  printedOn: ISODate;
}

export interface PrintRow {
  serial: number;
  /** DD/MM/YYYY, as in the paper book; empty for blank rows. */
  date: string;
  patientRef: string;
  level: Level | null;
  /** First characters of the verification hash; empty when not yet verified. */
  verificationRef: string;
  supervisor: string;
  pending: boolean;
}

export interface CodeTable {
  requirement: Requirement;
  /** Rows on the book's printed page (filled first, then blank). */
  rows: PrintRow[];
  /** Entries beyond the printed row count, or for codes with no printed rows (CONS 07). */
  continuation: PrintRow[];
  filled: number;
  integrity: string;
}

export interface IdentityBlock {
  internName: string;
  licenceNo: string;
  trainingCentre: string;
  periodFrom: ISODate;
  periodTo: ISODate;
}

export interface CaseReportRow {
  serial: number;
  title: string;
  date: string;
  verificationRef: string;
  supervisor: string;
  pending: boolean;
}

export interface RotationPrint {
  kind: 'clinical';
  rotation: Rotation;
  rotationName: string;
  section: string;
  identity: IdentityBlock;
  tables: CodeTable[];
  /** 5.x.5 Log of Case Reports: verified reports (and pending, if chosen), padded to the book's ten rows. */
  caseReports: CaseReportRow[];
  verificationLog: VerificationLine[];
  integrity: string;
}

export interface CommunityRow {
  label: string;
  sublabel?: string;
  date: string;
  verificationRef: string;
  supervisor: string;
  pending: boolean;
}

export interface CommunityPrint {
  kind: 'community';
  rotation: Rotation;
  rotationName: string;
  section: string;
  identity: IdentityBlock;
  activities: CommunityRow[];
  caseFollowUp: { caseType: string; caseName: string; steps: { step: string; stepName: string; rows: (CommunityRow & { caseNo: number })[] }[] }[];
  weeklyReports: CommunityRow[];
  verificationLog: VerificationLine[];
  integrity: string;
}

export interface VerificationLine {
  ref: string;
  code: string;
  performedOn: string;
  verifier: string;
  method: string;
  signedAt: string;
  decision: string;
}

export const ddmmyyyy = (d: ISODate) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

const REF_LEN = 8;

function rowsFor(ix: DatasetIndex, entries: LogbookEntry[], opts: PrintOptions): PrintRow[] {
  const sup = new Map(ix.ds.supervisors.map((s) => [s.id, s.name]));
  const done = ix.ds.rules.completedStatuses;
  return entries
    .filter((e) => done.includes(e.status) || (opts.includePending && e.status === 'submitted'))
    .sort((a, b) => a.performedOn.localeCompare(b.performedOn) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((e, i) => {
      const v = ix.latest.get(e.id);
      const verified = done.includes(e.status);
      return {
        serial: i + 1,
        date: ddmmyyyy(e.performedOn),
        patientRef: e.patientRef ?? '',
        level: verified ? ix.effLevel(e) : e.levelClaimed,
        verificationRef: verified && v ? v.hash.slice(0, REF_LEN) : '',
        supervisor: e.supervisorId ? sup.get(e.supervisorId) ?? '' : '',
        pending: !verified,
      };
    });
}

const blankRow = (serial: number): PrintRow => ({ serial, date: '', patientRef: '', level: null, verificationRef: '', supervisor: '', pending: false });

function identity(ix: DatasetIndex, r: Rotation, trainingCentre: string): IdentityBlock {
  return {
    internName: ix.ds.internship.internName,
    licenceNo: ix.ds.internship.licenceNo ?? '',
    trainingCentre,
    periodFrom: r.startsOn,
    periodTo: rotationEnd(r),
  };
}

function verificationLog(ix: DatasetIndex, entries: LogbookEntry[], rotationId: string): VerificationLine[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const reports = new Map((ix.ds.caseReports ?? []).filter((r) => r.rotationId === rotationId).map((r) => [r.id, r]));
  const sup = new Map(ix.ds.supervisors.map((s) => [s.id, s.name]));
  const target = (v: (typeof ix.ds.verifications)[number]) => {
    if (v.entryId && byId.has(v.entryId)) return { code: byId.get(v.entryId)!.requirementCode, on: byId.get(v.entryId)!.performedOn };
    if (v.caseReportId && reports.has(v.caseReportId)) return { code: 'Case report', on: reports.get(v.caseReportId)!.date };
    return null;
  };
  return ix.ds.verifications
    .filter((v) => target(v) !== null)
    .sort((a, b) => a.signedAt.localeCompare(b.signedAt))
    .map((v) => ({
      ref: v.hash.slice(0, REF_LEN),
      code: target(v)!.code,
      performedOn: ddmmyyyy(target(v)!.on),
      verifier: sup.get(v.verifierId) ?? v.verifierId.slice(0, 8),
      method: v.method,
      signedAt: v.signedAt.slice(0, 16).replace('T', ' '),
      decision: v.decision,
    }));
}

const integrityOf = (x: unknown) => sha256(stableStringify(x)).slice(0, 10).toUpperCase();

export function buildRotationPrint(ix: DatasetIndex, rotationId: string, opts: PrintOptions, trainingCentre: string): RotationPrint | CommunityPrint {
  const rotation = ix.ds.rotations.find((r) => r.id === rotationId);
  if (!rotation) throw new Error('Unknown rotation');
  const def = ix.ds.requirementSet.rotations.find((r) => r.code === rotation.rotation);
  const entries = ix.entries.filter((e) => ix.rotationCode(e.rotationId) === rotation.rotation);
  const base = {
    rotation,
    rotationName: def?.name ?? rotation.rotation,
    section: def?.section ?? '',
    identity: identity(ix, rotation, trainingCentre),
    verificationLog: verificationLog(ix, entries, rotation.id),
  };
  if (rotation.rotation === 'COMM') return buildCommunity(ix, base, entries, opts);

  const tables: CodeTable[] = ix.ds.requirementSet.requirements
    .filter((q) => q.rotation === rotation.rotation)
    .map((requirement) => {
      const filled = rowsFor(
        ix,
        entries.filter((e) => e.requirementCode === requirement.code),
        opts,
      );
      const onPage = filled.slice(0, requirement.printedRows);
      const continuation = filled.slice(requirement.printedRows);
      const rows = opts.fillToBookRows
        ? [...onPage, ...Array.from({ length: Math.max(0, requirement.printedRows - onPage.length) }, (_, i) => blankRow(onPage.length + i + 1))]
        : onPage;
      return {
        requirement,
        rows,
        continuation,
        filled: filled.length,
        integrity: integrityOf({ code: requirement.code, rows: filled }),
      };
    });
  const sup = new Map(ix.ds.supervisors.map((s) => [s.id, s.name]));
  const filledReports: CaseReportRow[] = (ix.ds.caseReports ?? [])
    .filter((r) => !r.deletedAt && r.rotationId === rotation.id && (r.status === 'verified' || (opts.includePending && r.status === 'submitted')))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .map((r, i) => ({
      serial: i + 1,
      title: r.title,
      date: ddmmyyyy(r.date),
      verificationRef: r.status === 'verified' ? ix.latest.get(r.id)?.hash.slice(0, REF_LEN) ?? '' : '',
      supervisor: r.supervisorId ? sup.get(r.supervisorId) ?? '' : '',
      pending: r.status !== 'verified',
    }));
  const caseReports = [
    ...filledReports,
    ...Array.from({ length: Math.max(0, 10 - filledReports.length) }, (_, i) => ({
      serial: filledReports.length + i + 1,
      title: '',
      date: '',
      verificationRef: '',
      supervisor: '',
      pending: false,
    })),
  ];
  return {
    kind: 'clinical',
    ...base,
    tables,
    caseReports,
    integrity: integrityOf({ identity: base.identity, tables: tables.map((t) => t.integrity), caseReports: filledReports, printedOn: opts.printedOn }),
  };
}

function buildCommunity(
  ix: DatasetIndex,
  base: Omit<CommunityPrint, 'kind' | 'activities' | 'caseFollowUp' | 'weeklyReports' | 'integrity'>,
  entries: LogbookEntry[],
  opts: PrintOptions,
): CommunityPrint {
  const done = ix.ds.rules.completedStatuses;
  const sup = new Map(ix.ds.supervisors.map((s) => [s.id, s.name]));
  const activityById = new Map(ix.activities.map((a) => [a.id, a]));
  const usable = entries
    .filter((e) => e.activityId && (done.includes(e.status) || (opts.includePending && e.status === 'submitted')))
    .sort((a, b) => a.performedOn.localeCompare(b.performedOn));
  const toRow = (e: LogbookEntry | undefined, label: string, sublabel?: string): CommunityRow => {
    if (!e) return { label, sublabel, date: '', verificationRef: '', supervisor: '', pending: false };
    const verified = done.includes(e.status);
    return {
      label,
      sublabel,
      date: ddmmyyyy(e.performedOn),
      verificationRef: verified ? ix.latest.get(e.id)?.hash.slice(0, REF_LEN) ?? '' : '',
      supervisor: e.supervisorId ? sup.get(e.supervisorId) ?? '' : '',
      pending: !verified,
    };
  };
  const find = (pred: (a: NonNullable<ReturnType<typeof activityById.get>>) => boolean) =>
    usable.find((e) => {
      const a = activityById.get(e.activityId!);
      return a ? pred(a) : false;
    });

  const activities = COMMUNITY_ITEMS.map((name, i) => toRow(find((a) => a.activityTypeId === 'community_activity' && a.communityItem === i + 1), name));
  const caseFollowUp = COMMUNITY_CASE_TYPES.map((c) => ({
    caseType: c.id,
    caseName: c.name,
    steps: FOLLOW_UP_STEPS.map((s, si) => ({
      step: String.fromCharCode(97 + si),
      stepName: s.name,
      rows: Array.from({ length: c.cases }, (_, k) => ({
        ...toRow(
          find((a) => a.activityTypeId === 'community_case_step' && a.caseType === c.id && a.caseSlot === k + 1 && a.followUpStep === s.id),
          `Case ${k + 1}`,
        ),
        caseNo: k + 1,
      })),
    })),
  }));
  const weeklyReports = Array.from({ length: 8 }, (_, i) => {
    const e = find((a) => a.activityTypeId === 'weekly_report' && a.weeklyReportNo === i + 1);
    const a = e ? activityById.get(e.activityId!) : undefined;
    return toRow(e, a?.title ?? '');
  });
  return {
    kind: 'community',
    ...base,
    activities,
    caseFollowUp,
    weeklyReports,
    integrity: integrityOf({ identity: base.identity, activities, caseFollowUp, weeklyReports, printedOn: opts.printedOn }),
  };
}
