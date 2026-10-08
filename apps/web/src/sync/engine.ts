import {
  CLIENT_TABLE,
  CLIENT_WRITABLE,
  fromWire,
  PUSH_ORDER,
  SERVER_TABLE,
  toWire,
  type ClientTable,
  type Internship,
  type PullResult,
  type PushChange,
  type PushResult,
} from '@logbook/core';
import { db, getMeta, META, setMeta, type OutboxItem } from '../data/db';

/**
 * Offline-first sync (blueprint §20.2).
 *
 * 1. Push: drain the outbox in parent-before-child order. Accepted changes
 *    leave the outbox; rejected ones stay, marked as errors with the server's
 *    reason, and are retried a few times.
 * 2. Pull: fetch everything changed since the last cursor and write it to
 *    the device store, except records with local changes still waiting to be
 *    pushed (the device's newer edit wins until the server has it).
 *
 * The transport is an interface so the engine can be tested against a real
 * Postgres (PGlite) without a network.
 */

export interface SyncTransport {
  push(changes: PushChange[]): Promise<PushResult>;
  pull(since: number): Promise<PullResult>;
}

export interface SyncOutcome {
  pushed: number;
  rejected: { table: string; id: string; reason: string }[];
  pulled: number;
  cursor: number;
}

const BATCH = 200;
const MAX_ATTEMPTS = 5;
const CURSOR_KEY = 'syncCursor';

const key = (table: string, id: string) => `${table}|${id}`;

export async function syncOnce(transport: SyncTransport): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { pushed: 0, rejected: [], pulled: 0, cursor: 0 };

  // ---- Push ----------------------------------------------------------------
  const queued = (await db.outbox.orderBy('seq').toArray()).filter((o) => o.status === 'pending' || o.attempts < MAX_ATTEMPTS);
  // Latest outbox item per record; one push carries the record's current state.
  const latest = new Map<string, OutboxItem>();
  for (const o of queued) latest.set(key(o.table, o.recordId), o);
  const maxSeq = queued.reduce((m, o) => Math.max(m, o.seq ?? 0), 0);

  const changes: (PushChange & { clientTable: ClientTable })[] = [];
  const orphaned: number[] = [];
  for (const o of latest.values()) {
    const table = o.table as ClientTable;
    if (!CLIENT_WRITABLE.has(table)) {
      orphaned.push(o.seq!);
      continue;
    }
    const record = (await db.table(table).get(o.recordId)) as object | undefined;
    if (!record) {
      orphaned.push(o.seq!);
      continue;
    }
    changes.push({ clientTable: table, table: SERVER_TABLE[table], op: o.op, record: toWire(record) });
  }
  if (orphaned.length) await db.outbox.bulkDelete(orphaned);
  changes.sort((a, b) => PUSH_ORDER.indexOf(a.clientTable) - PUSH_ORDER.indexOf(b.clientTable));

  for (let i = 0; i < changes.length; i += BATCH) {
    const batch = changes.slice(i, i + BATCH);
    const res = await transport.push(batch.map(({ table, op, record }) => ({ table, op, record })));
    const accepted = new Set(res.accepted.map((a) => key(a.table, a.id)));
    const rejected = new Map(res.rejected.map((r) => [key(r.table, r.id), r.reason]));
    await db.transaction('rw', db.outbox, async () => {
      for (const c of batch) {
        const id = String(c.record.id);
        const items = await db.outbox
          .where('recordId')
          .equals(id)
          .filter((o) => o.table === c.clientTable && (o.seq ?? 0) <= maxSeq)
          .toArray();
        if (accepted.has(key(c.table, id))) {
          // Changes queued during this push (seq > maxSeq) stay for the next round.
          await db.outbox.bulkDelete(items.map((o) => o.seq!));
          outcome.pushed++;
        } else {
          const reason = rejected.get(key(c.table, id)) ?? 'Not acknowledged by the server';
          for (const o of items) await db.outbox.update(o.seq!, { status: 'error', error: reason, attempts: o.attempts + 1 });
          outcome.rejected.push({ table: c.clientTable, id, reason });
        }
      }
    });
  }

  // ---- Pull ----------------------------------------------------------------
  const since = await getMeta<number>(CURSOR_KEY, 0);
  const pulled = await transport.pull(since);
  const waiting = new Set((await db.outbox.toArray()).map((o) => key(o.table, o.recordId)));
  await db.transaction('rw', db.tables, async () => {
    for (const [serverTable, rows] of Object.entries(pulled.changes)) {
      const table = CLIENT_TABLE[serverTable];
      if (!table) continue;
      for (const row of rows) {
        const rec = fromWire<{ id: string }>(row);
        if (waiting.has(key(table, rec.id))) continue;
        await db.table(table).put(rec);
        outcome.pulled++;
      }
    }
    // A fresh device: make the first synced internship the active one.
    if (!(await getMeta<string | null>(META.activeInternship, null))) {
      const first = (await db.internships.toArray()).find((i: Internship & { deletedAt?: string | null }) => !i.deletedAt);
      if (first) await setMeta(META.activeInternship, first.id);
    }
    await setMeta(CURSOR_KEY, pulled.cursor);
    await setMeta(META.lastSyncAt, new Date().toISOString());
  });
  outcome.cursor = pulled.cursor;
  return outcome;
}

/** Forget the sync cursor so the next pull fetches everything (periodic full resync, or after sign-in). */
export async function resetCursor(): Promise<void> {
  await setMeta(CURSOR_KEY, 0);
}
