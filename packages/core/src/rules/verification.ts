import type { CaseReport, ID, ISODateTime, Level, LogbookEntry, Verification } from '../types';
import { sha256, stableStringify } from '../util/hash';

/**
 * Supervisor verification: append-only and hash-chained (blueprint §13.2).
 * A verification targets either a logbook entry or a case report. Each record
 * hashes the target's content and the previous record's hash, so a later edit
 * to either is detectable.
 */

function entryFingerprint(e: LogbookEntry) {
  return {
    id: e.id,
    code: e.requirementCode,
    on: e.performedOn,
    patientRef: e.patientRef ?? null,
    site: e.site ?? null,
    level: e.levelClaimed,
  };
}

function caseReportFingerprint(r: CaseReport) {
  return {
    id: r.id,
    title: r.title,
    on: r.date,
    rotationId: r.rotationId,
    content: sha256(stableStringify(r.sections)),
  };
}

type Target = { kind: 'entry'; entry: LogbookEntry } | { kind: 'case_report'; report: CaseReport };

function computeHash(v: Omit<Verification, 'hash'>, target: Target): string {
  return sha256(
    stableStringify({
      // Entries keep their original key so existing chains stay valid.
      ...(target.kind === 'entry' ? { entry: entryFingerprint(target.entry) } : { caseReport: caseReportFingerprint(target.report) }),
      verifierId: v.verifierId,
      decision: v.decision,
      levelObserved: v.levelObserved ?? null,
      comment: v.comment ?? null,
      method: v.method,
      signedAt: v.signedAt,
      prevHash: v.prevHash,
    }),
  );
}

export interface VerifyInput {
  verifierId: ID;
  decision: 'verified' | 'returned';
  levelObserved?: Level;
  comment?: string;
  method: Verification['method'];
}

function requireComment(input: VerifyInput) {
  if (input.decision === 'returned' && !input.comment?.trim()) {
    throw new Error('A returned entry needs a comment explaining what to fix.');
  }
}

export function createVerification(entry: LogbookEntry, input: VerifyInput, prevHash: string | null, signedAt: ISODateTime, id: ID): Verification {
  requireComment(input);
  const base: Omit<Verification, 'hash'> = { id, entryId: entry.id, prevHash, signedAt, ...input };
  return { ...base, hash: computeHash(base, { kind: 'entry', entry }) };
}

export function createCaseReportVerification(
  report: CaseReport,
  input: Omit<VerifyInput, 'levelObserved'>,
  prevHash: string | null,
  signedAt: ISODateTime,
  id: ID,
): Verification {
  requireComment(input);
  const base: Omit<Verification, 'hash'> = { id, caseReportId: report.id, prevHash, signedAt, ...input };
  return { ...base, hash: computeHash(base, { kind: 'case_report', report }) };
}

/** New status after a verification decision. */
export function statusAfter(v: Verification): 'verified' | 'returned' {
  return v.decision === 'verified' ? 'verified' : 'returned';
}

/** The verification's target id (entry or case report). */
export const targetOf = (v: Verification): ID => (v.entryId ?? v.caseReportId)!;

/** The latest verification decision per target. */
export function latestVerifications(verifications: Verification[]): Map<ID, Verification> {
  const latest = new Map<ID, Verification>();
  for (const v of verifications) {
    const key = targetOf(v);
    const prev = latest.get(key);
    if (!prev || v.signedAt >= prev.signedAt) latest.set(key, v);
  }
  return latest;
}

/**
 * Effective level for an entry: the supervisor's observed level when the
 * latest decision is a verification that set one, otherwise the intern's claim.
 */
export function effectiveLevel(entry: LogbookEntry, latest: Map<ID, Verification>): Level {
  const v = latest.get(entry.id);
  if (v && v.decision === 'verified' && v.levelObserved) return v.levelObserved;
  return entry.levelClaimed;
}

export interface ChainProblem {
  verificationId: ID;
  problem: 'hash_mismatch' | 'broken_link' | 'missing_entry';
}

/** Check the whole chain (ordered by signedAt). Detects tampered entries, case reports and verifications. */
export function checkVerificationChain(
  verifications: Verification[],
  entries: Map<ID, LogbookEntry>,
  caseReports: Map<ID, CaseReport> = new Map(),
): ChainProblem[] {
  const problems: ChainProblem[] = [];
  const sorted = [...verifications].sort((a, b) => a.signedAt.localeCompare(b.signedAt) || a.id.localeCompare(b.id));
  let prev: string | null = null;
  for (const v of sorted) {
    if (v.prevHash !== prev) problems.push({ verificationId: v.id, problem: 'broken_link' });
    const entry = v.entryId ? entries.get(v.entryId) : undefined;
    const report = v.caseReportId ? caseReports.get(v.caseReportId) : undefined;
    const target: Target | null = entry ? { kind: 'entry', entry } : report ? { kind: 'case_report', report } : null;
    if (!target) {
      problems.push({ verificationId: v.id, problem: 'missing_entry' });
    } else {
      const { hash, ...rest } = v;
      if (computeHash(rest, target) !== hash) problems.push({ verificationId: v.id, problem: 'hash_mismatch' });
    }
    prev = v.hash;
  }
  return problems;
}
