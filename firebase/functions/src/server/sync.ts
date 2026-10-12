import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { AppError, iso, requireUser, rowRef, userRef, type Ctx, type Row } from './context';
import { CHILD_KEYS, COLUMNS, DEVICE_WRITABLE, PULL_ORDER } from './tables';

/**
 * sync_push / sync_pull on Firestore — a port of the Postgres functions and
 * triggers (supabase/migrations 0300–0900) with the same rules:
 *   - each record belongs to the caller (owner pinned server-side);
 *   - only known columns are stored;
 *   - each change is accepted or rejected on its own;
 *   - a device cannot mark an entry or case report verified or returned —
 *     only a verification does; verified content cannot change;
 *   - verifications are append-only; from a device, only PIN sign-offs for
 *     the caller's own entries and case reports;
 *   - the link between a supervisor record and an account is set only by the
 *     invite flow;
 *   - every write gets the owner's next server_seq (the pull cursor).
 */

export interface PushChange {
  table: string;
  op?: 'upsert' | 'delete';
  record: Row;
}

const MAX_CHANGES = 200;
const ENTRY_LOCKED = ['verified', 'locked'];
const ENTRY_STATUSES = ['draft', 'submitted', 'returned', 'verified', 'locked', 'withdrawn'];
const REPORT_STATUSES = ['draft', 'submitted', 'returned', 'verified'];
const METHODS = ['passkey', 'pin', 'wet_signature_scan', 'co_located_qr', 'demo', 'account'];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function pick(table: string, rec: Row): Row {
  const out: Row = {};
  for (const c of COLUMNS[table]!) if (c in rec && rec[c] !== undefined) out[c] = rec[c];
  if (table === 'encounter') {
    for (const [key, cols] of Object.entries(CHILD_KEYS)) {
      const list = rec[key];
      if (!Array.isArray(list)) continue;
      out[key] = list.map((item) => {
        const child: Row = {};
        for (const c of cols) if (item && typeof item === 'object' && c in item && (item as Row)[c] !== undefined) child[c] = (item as Row)[c];
        return child;
      });
    }
  }
  return out;
}

/** Statuses the server owns, as in the entry and case-report guard triggers. */
function guardEntry(next: Row, existing: Row | undefined): Row {
  if (existing) {
    if (ENTRY_LOCKED.includes(existing.status as string)) {
      const changed = ['requirement_code', 'performed_on', 'patient_ref', 'site', 'level_claimed'].some((k) => !same(next[k], existing[k]));
      if (changed || !same(next.status, existing.status)) {
        // Re-sending the verified record unchanged is fine.
        if (changed || !ENTRY_LOCKED.includes(next.status as string)) {
          throw new AppError('permission-denied', 'Verified logbook entries cannot be changed; add a correction instead');
        }
      }
      return { ...next, status: existing.status };
    }
    if (ENTRY_LOCKED.includes(next.status as string) || (next.status === 'returned' && existing.status !== 'returned')) {
      return { ...next, status: existing.status };
    }
    return next;
  }
  if (['verified', 'returned', 'locked'].includes(next.status as string)) return { ...next, status: 'submitted' };
  return next;
}

function guardCaseReport(next: Row, existing: Row | undefined): Row {
  if (existing) {
    if (existing.status === 'verified') {
      const changed = ['title', 'date', 'sections'].some((k) => !same(next[k], existing[k]));
      if (changed || next.status !== 'verified') throw new AppError('permission-denied', 'Verified case reports cannot be changed');
      return next;
    }
    if (next.status === 'verified' || (next.status === 'returned' && existing.status !== 'returned')) return { ...next, status: existing.status };
    return next;
  }
  if (next.status === 'verified' || next.status === 'returned') return { ...next, status: 'submitted' };
  return next;
}

function validate(table: string, row: Row) {
  const bad = (m: string) => {
    throw new AppError('invalid-argument', m);
  };
  if (table === 'logbook_entry' && !ENTRY_STATUSES.includes(row.status as string)) bad('invalid entry status');
  if (table === 'case_report' && row.status !== undefined && !REPORT_STATUSES.includes(row.status as string)) bad('invalid case report status');
  if (table === 'report_snapshot' && row.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(String(row.sha256))) bad('sha256 must be 64 hex characters');
  if (table === 'verification') {
    if (!['verified', 'returned'].includes(row.decision as string)) bad('invalid decision');
    if (row.decision === 'returned' && !(typeof row.comment === 'string' && row.comment.trim())) bad('A returned decision needs a comment');
    if (!METHODS.includes(row.method as string)) bad('invalid method');
    if (row.level_observed != null && !(Number.isInteger(row.level_observed) && (row.level_observed as number) >= 1 && (row.level_observed as number) <= 5)) bad('level must be 1–5');
    if ((row.entry_id == null) === (row.case_report_id == null)) bad('A verification needs exactly one target');
    if (typeof row.hash !== 'string' || typeof row.signed_at !== 'string') bad('missing hash or signing time');
  }
}

/** The writes of one push, applied in memory first so later changes see earlier ones. */
class Batch {
  private readonly state = new Map<string, Row | undefined>();
  private readonly dirty = new Map<string, DocumentReference>();
  constructor(
    private readonly ctx: Ctx,
    private readonly owner: string,
    private seq: number,
  ) {}

  ref(table: string, id: string) {
    return rowRef(this.ctx, this.owner, table, id);
  }
  load(path: string, data: Row | undefined) {
    if (!this.state.has(path)) this.state.set(path, data);
  }
  get(table: string, id: string): Row | undefined {
    return this.state.get(this.ref(table, id).path);
  }
  put(table: string, id: string, row: Row) {
    const ref = this.ref(table, id);
    this.state.set(ref.path, { ...row, id, owner_id: this.owner, server_seq: ++this.seq, server_received_at: iso(this.ctx.now) });
    this.dirty.set(ref.path, ref);
  }
  commit(tx: Transaction) {
    tx.set(userRef(this.ctx, this.owner), { seq: this.seq }, { merge: true });
    for (const [path, ref] of this.dirty) tx.set(ref, this.state.get(path)!);
  }
}

export async function syncPush(ctx: Ctx, changes: unknown): Promise<{ accepted: { table: string; id: string }[]; rejected: { table: string; id: string; reason: string }[] }> {
  const uid = requireUser(ctx);
  if (!Array.isArray(changes)) throw new AppError('invalid-argument', 'changes must be an array');
  if (changes.length > MAX_CHANGES) throw new AppError('invalid-argument', `Send at most ${MAX_CHANGES} changes per batch`);
  const list = changes as PushChange[];

  return ctx.db.runTransaction(async (tx) => {
    // Every document a change might read: the record itself and a verification's target.
    const refs = new Map<string, DocumentReference>();
    const add = (table: string, id: unknown) => {
      if (typeof id === 'string' && id && DEVICE_WRITABLE.has(table)) refs.set(rowRef(ctx, uid, table, id).path, rowRef(ctx, uid, table, id));
    };
    for (const ch of list) {
      const rec = ch?.record ?? {};
      add(ch?.table, rec.id);
      if (ch?.table === 'verification') {
        add('logbook_entry', rec.entry_id);
        add('case_report', rec.case_report_id);
      }
    }
    const counter = await tx.get(userRef(ctx, uid));
    const snaps = refs.size ? await tx.getAll(...refs.values()) : [];
    const batch = new Batch(ctx, uid, (counter.data()?.seq as number | undefined) ?? 0);
    for (const s of snaps) batch.load(s.ref.path, s.exists ? (s.data() as Row) : undefined);

    const accepted: { table: string; id: string }[] = [];
    const rejected: { table: string; id: string; reason: string }[] = [];
    for (const ch of list) {
      const table = ch?.table;
      const rec = (ch?.record ?? {}) as Row;
      const id = typeof rec.id === 'string' ? rec.id : '';
      try {
        if (!table || !DEVICE_WRITABLE.has(table)) throw new AppError('permission-denied', `table "${table ?? '?'}" cannot be written by a device`);
        if (!id) throw new AppError('invalid-argument', 'missing id');
        apply(batch, table, ch.op ?? 'upsert', rec, ctx.now);
        accepted.push({ table, id });
      } catch (err) {
        rejected.push({ table: table ?? '?', id, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    batch.commit(tx);
    return { accepted, rejected };
  });
}

function apply(batch: Batch, table: string, op: 'upsert' | 'delete', rec: Row, now: Date) {
  const id = rec.id as string;
  let base = pick(table, rec);
  if (op === 'delete') {
    if (table === 'verification') throw new AppError('permission-denied', 'verifications cannot be deleted');
    base = { ...base, deleted_at: (base.deleted_at as string | undefined) ?? iso(now) };
  }
  if (Object.keys(base).filter((k) => k !== 'id').length === 0 && op !== 'delete') throw new AppError('invalid-argument', 'record has no known columns');
  const existing = batch.get(table, id);

  if (table === 'verification') {
    if (existing) return; // append-only: re-sending is harmless
    if (base.method !== 'pin') throw new AppError('permission-denied', 'new row violates row-level security policy for table "verification"');
    validate(table, base);
    const targetTable = base.entry_id ? 'logbook_entry' : 'case_report';
    const targetId = (base.entry_id ?? base.case_report_id) as string;
    const target = batch.get(targetTable, targetId);
    if (!target) throw new AppError('permission-denied', 'new row violates row-level security policy for table "verification"');
    batch.put(table, id, base);
    // A verification sets its target's status (tg_verification_applies).
    batch.put(targetTable, targetId, { ...target, status: base.decision === 'verified' ? 'verified' : 'returned' });
    return;
  }

  let next: Row = { ...(existing ?? {}), ...base, id };
  if (table === 'logbook_entry') next = guardEntry(next, existing);
  if (table === 'case_report') next = guardCaseReport(next, existing);
  if (table === 'supervisor') {
    // Only the invite flow links an account (tg_supervisor_link_guard).
    next.user_id = existing?.user_id ?? null;
    next.linked_at = existing?.linked_at ?? null;
  }
  validate(table, next);
  batch.put(table, id, next);
}

/** Everything of the caller's changed since the cursor, per table, in cursor order. */
export async function syncPull(ctx: Ctx, since: unknown): Promise<{ cursor: number; changes: Record<string, Row[]> }> {
  const uid = requireUser(ctx);
  const from = typeof since === 'number' && Number.isFinite(since) ? since : 0;
  let cursor = from;
  const changes: Record<string, Row[]> = {};
  for (const table of [...PULL_ORDER, 'encounter']) {
    const snap = await ctx.db.collection(`users/${uid}/${table}`).where('server_seq', '>', from).orderBy('server_seq').get();
    changes[table] = snap.docs.map((d) => {
      const row = d.data() as Row;
      cursor = Math.max(cursor, row.server_seq as number);
      return row;
    });
  }
  return { cursor, changes };
}
