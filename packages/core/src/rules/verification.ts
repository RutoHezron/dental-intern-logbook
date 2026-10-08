import type { ID, ISODateTime, Level, LogbookEntry, Verification } from '../types';
import { sha256, stableStringify } from '../util/hash';

/**
 * Supervisor verification: append-only and hash-chained (blueprint §13.2).
 * Each record hashes the entry's countable content and the previous record's
 * hash, so a later edit to either is detectable.
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

function computeHash(v: Omit<Verification, 'hash'>, entry: LogbookEntry): string {
  return sha256(
    stableStringify({
      entry: entryFingerprint(entry),
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

export function createVerification(
  entry: LogbookEntry,
  input: VerifyInput,
  prevHash: string | null,
  signedAt: ISODateTime,
  id: ID,
): Verification {
  if (input.decision === 'returned' && !input.comment?.trim()) {
    throw new Error('A returned entry needs a comment explaining what to fix.');
  }
  const base: Omit<Verification, 'hash'> = { id, entryId: entry.id, prevHash, signedAt, ...input };
  return { ...base, hash: computeHash(base, entry) };
}

/** New entry status after a verification decision. */
export function statusAfter(v: Verification): LogbookEntry['status'] {
  return v.decision === 'verified' ? 'verified' : 'returned';
}

/** The latest verification decision per entry. */
export function latestVerifications(verifications: Verification[]): Map<ID, Verification> {
  const latest = new Map<ID, Verification>();
  for (const v of verifications) {
    const prev = latest.get(v.entryId);
    if (!prev || v.signedAt >= prev.signedAt) latest.set(v.entryId, v);
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

/** Check the whole chain (ordered by signedAt). Detects tampered entries and verifications. */
export function checkVerificationChain(verifications: Verification[], entries: Map<ID, LogbookEntry>): ChainProblem[] {
  const problems: ChainProblem[] = [];
  const sorted = [...verifications].sort((a, b) => a.signedAt.localeCompare(b.signedAt) || a.id.localeCompare(b.id));
  let prev: string | null = null;
  for (const v of sorted) {
    if (v.prevHash !== prev) problems.push({ verificationId: v.id, problem: 'broken_link' });
    const entry = entries.get(v.entryId);
    if (!entry) {
      problems.push({ verificationId: v.id, problem: 'missing_entry' });
    } else {
      const { hash, ...rest } = v;
      if (computeHash(rest, entry) !== hash) problems.push({ verificationId: v.id, problem: 'hash_mismatch' });
    }
    prev = v.hash;
  }
  return problems;
}
