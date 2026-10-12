import {
  buildAccountSignatures,
  fromWire,
  uuidv7,
  toWire,
  type AccountDecision,
  type CaseReport,
  type ChainTip,
  type ID,
  type Level,
  type LogbookEntry,
} from '@logbook/core';

/**
 * Supervisor accounts on the supervisor's own device (V1). Everything here is
 * online: the supervisor reads what interns submitted to them and signs it.
 * The same code runs against Supabase in the app and PGlite in tests.
 */

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

export interface SupervisionLink {
  supervisorId: ID;
  ownerId: ID;
  supervisorName: string;
  internName: string | null;
  licenceNo?: string;
  institution?: string;
  tip: ChainTip | null;
}

export interface QueueVisit {
  time?: string;
  visitType?: string;
  setting?: string;
  procedures: { procedureTypeId: string; sites?: string[]; stage?: number; level?: Level; otherName?: string }[];
  diagnoses: string[];
}

export type QueueEntry = LogbookEntry & { rotation?: string; visit?: QueueVisit; activity?: { activityTypeId: string; title?: string } };

export interface SupervisorQueue {
  links: SupervisionLink[];
  entries: QueueEntry[];
  caseReports: CaseReport[];
}

export async function loadQueue(rpc: Rpc): Promise<SupervisorQueue> {
  const raw = (await rpc('supervisor_queue', {})) as { links: Record<string, unknown>[]; entries: Record<string, unknown>[]; case_reports: Record<string, unknown>[] };
  return {
    links: raw.links.map((l) => ({ ...fromWire<SupervisionLink>(l), tip: l.tip ? fromWire<ChainTip>(l.tip as Record<string, unknown>) : null })),
    entries: raw.entries.map((r) => fromWire<QueueEntry>(r)),
    caseReports: raw.case_reports.map((r) => fromWire<CaseReport>(r)),
  };
}

export type Decision =
  | { entryId: ID; decision: 'verified' | 'returned'; levelObserved?: Level; comment?: string }
  | { caseReportId: ID; decision: 'verified' | 'returned'; comment?: string };

const newId = () => uuidv7();

/**
 * Sign a batch for one intern (one link). If another device of this
 * supervisor signed in the meantime, the server refuses the stale chain; the
 * queue is reloaded and the batch rebuilt on the new head, once.
 */
export async function signDecisions(rpc: Rpc, link: SupervisionLink, queue: SupervisorQueue, decisions: Decision[], now: () => Date = () => new Date()): Promise<number> {
  const attempt = async (q: SupervisorQueue): Promise<number> => {
    const current = q.links.find((l) => l.supervisorId === link.supervisorId);
    if (!current) throw new Error('You are no longer linked to this intern.');
    const items: AccountDecision[] = decisions.map((d) => {
      if ('caseReportId' in d) {
        const report = q.caseReports.find((r) => r.id === d.caseReportId);
        if (!report) throw new Error('A case report is no longer waiting for you. Refresh and review again.');
        return { kind: 'case_report', report, decision: d.decision, comment: d.comment };
      }
      const entry = q.entries.find((e) => e.id === d.entryId);
      if (!entry) throw new Error('An entry is no longer waiting for you. Refresh and review again.');
      return { kind: 'entry', entry: stripContext(entry), decision: d.decision, levelObserved: d.levelObserved, comment: d.comment };
    });
    const sigs = buildAccountSignatures(link.supervisorId, current.tip, items, now(), newId);
    const res = (await rpc('supervisor_sign', { p_records: sigs.map((v) => toWire(v)) })) as { signed: number };
    return res.signed;
  };
  try {
    return await attempt(queue);
  } catch (err) {
    if (err instanceof Error && /chain_moved/.test(err.message)) return attempt(await loadQueue(rpc));
    throw err;
  }
}

/** The queue adds display context to entries; the hash covers only the entry itself. */
function stripContext(e: QueueEntry): LogbookEntry {
  const { rotation: _r, visit: _v, activity: _a, ...entry } = e;
  return entry;
}

export async function acceptInvite(rpc: Rpc, code: string): Promise<{ supervisorName: string; internName: string | null }> {
  return fromWire(await (rpc('accept_supervisor_invite', { p_code: code }) as Promise<Record<string, unknown>>));
}

export async function createInvite(rpc: Rpc, supervisorId: ID): Promise<{ code: string; expiresAt: string }> {
  return fromWire(await (rpc('create_supervisor_invite', { p_supervisor: supervisorId }) as Promise<Record<string, unknown>>));
}

export async function unlinkSupervisor(rpc: Rpc, supervisorId: ID): Promise<void> {
  await rpc('unlink_supervisor_account', { p_supervisor: supervisorId });
}

/** Normalise a typed or scanned code to XXXX-XXXX-XXXX. */
export function formatInviteCode(raw: string): string {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return c.match(/.{1,4}/g)?.join('-') ?? '';
}

export function inviteLink(origin: string, code: string): string {
  return `${origin}/join?code=${encodeURIComponent(code)}`;
}
