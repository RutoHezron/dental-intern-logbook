import { getActivityType, getProcedureType } from '../catalogue/procedures';
import type { ISODate } from '../types';
import type { DatasetIndex } from '../analytics/dataset-index';
import type { RequirementProgress } from '../analytics/progress';

/**
 * CSV exports (brief §22). RFC 4180 quoting; a UTF-8 BOM is added by the
 * caller when saving so Excel opens accented text correctly. Values that
 * start with = + - @ are prefixed with ' to prevent formula injection.
 */

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export interface LogbookExportFilter {
  from?: ISODate;
  to?: ISODate;
  rotationCode?: string;
  requirementCode?: string;
}

/** One row per logbook entry, in the KMPDC row shape plus verification detail. */
export function logbookCsv(ix: DatasetIndex, f: LogbookExportFilter = {}): string {
  const header = ['Code', 'Description', 'Rotation', 'Date', 'Patient No.', 'Site', 'Level claimed', 'Level verified', 'Status', 'Supervisor', 'Rule', 'Verification ref'];
  const sup = new Map(ix.ds.supervisors.map((s) => [s.id, s.name]));
  const rows = ix.entries
    .filter(
      (e) =>
        (!f.from || e.performedOn >= f.from) &&
        (!f.to || e.performedOn <= f.to) &&
        (!f.rotationCode || ix.rotationCode(e.rotationId) === f.rotationCode) &&
        (!f.requirementCode || e.requirementCode === f.requirementCode),
    )
    .map((e) => {
      const req = ix.requirements.get(e.requirementCode);
      const v = ix.latest.get(e.id);
      return [
        e.requirementCode,
        req?.description,
        ix.rotationCode(e.rotationId),
        e.performedOn,
        e.patientRef,
        e.site,
        e.levelClaimed,
        v?.decision === 'verified' ? v.levelObserved ?? e.levelClaimed : '',
        e.status,
        e.supervisorId ? sup.get(e.supervisorId) : '',
        e.rule,
        v ? v.hash.slice(0, 12) : '',
      ];
    });
  return toCsv(header, rows);
}

/** One row per recorded procedure (clinical exposure, including uncounted ones). */
export function proceduresCsv(ix: DatasetIndex, f: LogbookExportFilter = {}): string {
  const header = ['Date', 'Rotation', 'Patient No.', 'Visit type', 'Setting', 'Procedure', 'Category', 'Sites', 'Stage', 'Level', 'Diagnoses', 'Investigations', 'Referred to'];
  const rows: unknown[][] = [];
  for (const e of ix.encounters) {
    if ((f.from && e.date < f.from) || (f.to && e.date > f.to)) continue;
    const rot = ix.rotationCode(e.rotationId);
    if (f.rotationCode && rot !== f.rotationCode) continue;
    const patient = e.patientId ? ix.patients.get(e.patientId) : undefined;
    for (const p of e.procedures) {
      const t = getProcedureType(p.procedureTypeId);
      rows.push([
        e.date,
        rot,
        patient?.ref,
        e.visitType,
        e.setting,
        t?.id === 'other' ? p.otherName : t?.name,
        t?.category,
        p.sites.join(' '),
        p.stage,
        p.level,
        e.findings.filter((x) => x.isDiagnosis).map((x) => x.term).join('; '),
        e.investigations.map((x) => x.kind).join('; '),
        e.referredTo,
      ]);
    }
  }
  return toCsv(header, rows);
}

export function activitiesCsv(ix: DatasetIndex, f: LogbookExportFilter = {}): string {
  const header = ['Date', 'Rotation', 'Activity', 'Community item', 'Case type', 'Case no.', 'Step', 'Weekly report', 'Level', 'Title'];
  const rows = ix.activities
    .filter((a) => (!f.from || a.date >= f.from) && (!f.to || a.date <= f.to) && (!f.rotationCode || ix.rotationCode(a.rotationId) === f.rotationCode))
    .map((a) => [
      a.date,
      ix.rotationCode(a.rotationId),
      getActivityType(a.activityTypeId)?.name,
      a.communityItem,
      a.caseType,
      a.caseSlot,
      a.followUpStep,
      a.weeklyReportNo,
      a.level,
      a.title,
    ]);
  return toCsv(header, rows);
}

export function progressCsv(list: RequirementProgress[]): string {
  const header = ['Code', 'Description', 'Rotation', 'Minimum', 'Expected level', 'Logged', 'Verified', 'At expected level', 'Pending', 'Remaining', 'Status', 'L1', 'L2', 'L3', 'L4', 'L5'];
  return toCsv(
    header,
    list.map((p) => [
      p.requirement.code,
      p.requirement.description,
      p.requirement.rotation,
      p.requirement.minCount,
      p.requirement.expectedLevel,
      p.logged,
      p.verified,
      p.atExpectedLevel,
      p.pending,
      p.remaining,
      p.status,
      p.levels[1],
      p.levels[2],
      p.levels[3],
      p.levels[4],
      p.levels[5],
    ]),
  );
}

export function reflectionsCsv(ix: DatasetIndex, f: LogbookExportFilter = {}): string {
  const header = ['Date', 'Title', 'Tags', 'What was interesting', 'What I learned', 'What challenged me', 'Would do differently', 'To revise', 'Need more exposure'];
  const rows = ix.ds.reflections
    .filter((r) => !r.deletedAt && (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => [r.date, r.title, r.tags.join(' '), r.interesting, r.learned, r.challenged, r.doDifferently, r.revise, r.needExposure]);
  return toCsv(header, rows);
}
