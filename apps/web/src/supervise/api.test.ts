// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { checkVerificationChain, type Encounter, type PullResult, type PushChange, type PushResult } from '@logbook/core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { actAs, asAdmin, createDb, createUser, rpc as pgRpc } from '../../../../packages/db/test/harness';
import { db } from '../data/db';
import { clearAll, loadState, newId, saveEncounter, setupInternship } from '../data/repo';
import { syncOnce, type SyncTransport } from '../sync/engine';
import { acceptInvite, createInvite, formatInviteCode, loadQueue, signDecisions, type Rpc } from './api';

/**
 * The whole supervisor-account journey: the intern's device (IndexedDB) syncs
 * to the real migrations in PGlite; the intern invites their supervisor; the
 * supervisor accepts on their own account, reviews and signs; the intern's
 * next sync brings the decisions home, and the hash chains check out.
 */

const INTERN = '0190a000-0000-7000-8000-0000000017e2';
const SUPERVISOR = '0190a000-0000-7000-8000-0000000005a9';

let pg: PGlite;

const transport: SyncTransport = {
  async push(changes: PushChange[]) {
    await actAs(pg, INTERN);
    return pgRpc<PushResult>(pg, 'sync_push', [JSON.stringify(changes)]);
  },
  async pull(since: number) {
    await actAs(pg, INTERN);
    return pgRpc<PullResult>(pg, 'sync_pull', [since]);
  },
};

/** Supabase-style rpc(fn, namedArgs) over PGlite, as a given user. */
const rpcAs =
  (user: string): Rpc =>
  async (fn, args) => {
    await actAs(pg, user);
    const names = Object.keys(args);
    const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
    const res = await pg.query<{ r: unknown }>(sql, names.map((n) => (typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n])));
    return res.rows[0]!.r;
  };

beforeAll(async () => {
  pg = await createDb();
  await createUser(pg, INTERN);
  await createUser(pg, SUPERVISOR);
}, 60_000);

beforeEach(async () => {
  await asAdmin(pg);
  await pg.exec(`truncate public.supervisor_invite, public.verification, public.logbook_entry, public.activity, public.encounter, public.patient,
                 public.rotation, public.supervisor, public.internship, public.facility cascade`);
  await clearAll();
});

async function internLogsAVisit() {
  await setupInternship({
    internName: 'Dr Remote Intern',
    facilityName: 'Test Hospital',
    periodFrom: '2025-10-13',
    rotationOrder: ['OMF', 'PAED', 'PER', 'CONS', 'COMM'],
    supervisors: [{ name: 'Dr Own Phone', rotation: 'OMF' }],
  });
  const supervisorId = (await db.supervisors.toArray())[0]!.id;
  const internshipId = (await db.internships.toArray())[0]!.id;
  const visit: Encounter = {
    id: newId(),
    internshipId,
    rotationId: null,
    date: '2025-11-03',
    time: '10:15',
    patientId: null,
    visitType: 'new',
    setting: 'opd',
    supervisorId,
    findings: [{ term: 'Irreversible pulpitis', site: '36', isDiagnosis: true }],
    investigations: [],
    procedures: [
      { id: newId(), procedureTypeId: 'exam_plan', sites: [], level: 3 },
      { id: newId(), procedureTypeId: 'extraction', sites: ['36'], level: 4 },
    ],
    createdAt: '',
    updatedAt: '',
  };
  await saveEncounter(visit, { ref: 'OP-25-55555', birthYear: 1985, sex: 'M' });
  await syncOnce(transport);
  return supervisorId;
}

describe('supervisor on their own account', () => {
  it('invite → accept → review → sign → the intern syncs the decisions home', async () => {
    const supervisorId = await internLogsAVisit();

    // Intern: invite (shown as a code, link and QR code).
    const { code } = await createInvite(rpcAs(INTERN), supervisorId);
    expect(formatInviteCode(code.replace(/-/g, '').toLowerCase())).toBe(code);

    // Supervisor, on their own phone.
    const sup = rpcAs(SUPERVISOR);
    expect(await acceptInvite(sup, code)).toEqual({ supervisorId, supervisorName: 'Dr Own Phone', internName: 'Dr Remote Intern' });
    const q = await loadQueue(sup);
    expect(q.links).toHaveLength(1);
    expect(q.entries).toHaveLength(2);
    expect(q.entries[0]!.visit?.diagnoses).toEqual(['Irreversible pulpitis (36)']);
    const [exam, extraction] = [...q.entries].sort((a, b) => a.levelClaimed - b.levelClaimed);
    const signed = await signDecisions(sup, q.links[0]!, q, [
      { entryId: exam!.id, decision: 'verified' },
      { entryId: extraction!.id, decision: 'returned', comment: 'Add the post-op instructions given' },
    ]);
    expect(signed).toBe(2);
    expect((await loadQueue(sup)).entries).toEqual([]);

    // Intern's next sync.
    await syncOnce(transport);
    const ds = (await loadState()).dataset!;
    const status = Object.fromEntries(ds.entries.map((e) => [e.id, e.status]));
    expect(status[exam!.id]).toBe('verified');
    expect(status[extraction!.id]).toBe('returned');
    expect(ds.verifications.map((v) => v.method)).toEqual(['account', 'account']);
    expect(checkVerificationChain(ds.verifications, new Map(ds.entries.map((e) => [e.id, e])))).toEqual([]);
  });

  it('rebuilds on the new chain head when another device signed first', async () => {
    const supervisorId = await internLogsAVisit();
    const { code } = await createInvite(rpcAs(INTERN), supervisorId);
    const sup = rpcAs(SUPERVISOR);
    await acceptInvite(sup, code);
    const stale = await loadQueue(sup);
    const [a, b] = stale.entries;
    // "Laptop" signs the first entry.
    await signDecisions(sup, stale.links[0]!, stale, [{ entryId: a!.id, decision: 'verified' }]);
    // "Phone" still has the old queue (old head) and signs the second: retried on the new head.
    expect(await signDecisions(sup, stale.links[0]!, stale, [{ entryId: b!.id, decision: 'verified' }])).toBe(1);
    await syncOnce(transport);
    const ds = (await loadState()).dataset!;
    expect(ds.entries.every((e) => e.status === 'verified')).toBe(true);
    expect(checkVerificationChain(ds.verifications, new Map(ds.entries.map((e) => [e.id, e])))).toEqual([]);
  });
});
