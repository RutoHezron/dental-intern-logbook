import type { CaseReport, ID, ISODateTime, Level, LogbookEntry, Verification } from '../types';
import { createCaseReportVerification, createVerification } from './verification';

/**
 * Supervisor sign-off from the supervisor's own account (V1).
 *
 * The supervisor's device builds the hash-chained records, exactly as the
 * intern's phone does for a PIN sign-off, but on the supervisor's own chain
 * (one per supervisor per intern; see `chainKey`). The server appends them
 * only if they extend the chain head it holds, so two devices signing at once
 * cannot fork the chain: the second is refused and simply rebuilds on the new head.
 */

/** The last record of this supervisor's account chain for one intern. */
export interface ChainTip {
  id: ID;
  hash: string;
  signedAt: ISODateTime;
}

export type AccountDecision =
  | { kind: 'entry'; entry: LogbookEntry; decision: 'verified' | 'returned'; levelObserved?: Level; comment?: string }
  | { kind: 'case_report'; report: CaseReport; decision: 'verified' | 'returned'; comment?: string };

/**
 * Build the verification records for a batch of decisions, chained from `tip`.
 * Timestamps strictly increase and never go behind the tip, even if this
 * device's clock is slow, so the chain order is unambiguous.
 */
export function buildAccountSignatures(
  supervisorId: ID,
  tip: ChainTip | null,
  decisions: AccountDecision[],
  now: Date,
  newId: () => ID,
): Verification[] {
  if (!decisions.length) throw new Error('No decisions to sign.');
  let t = Math.max(now.getTime(), tip ? Date.parse(tip.signedAt) + 1 : 0);
  let prevHash = tip?.hash ?? null;
  const out: Verification[] = [];
  for (const d of decisions) {
    const signedAt = new Date(t++).toISOString();
    const comment = d.comment?.trim() || undefined;
    const v =
      d.kind === 'entry'
        ? createVerification(
            d.entry,
            {
              verifierId: supervisorId,
              decision: d.decision,
              levelObserved: d.decision === 'verified' ? d.levelObserved ?? d.entry.levelClaimed : undefined,
              comment,
              method: 'account',
            },
            prevHash,
            signedAt,
            newId(),
          )
        : createCaseReportVerification(d.report, { verifierId: supervisorId, decision: d.decision, comment, method: 'account' }, prevHash, signedAt, newId());
    out.push(v);
    prevHash = v.hash;
  }
  return out;
}
