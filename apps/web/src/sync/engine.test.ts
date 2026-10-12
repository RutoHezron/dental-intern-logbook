// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import type { Encounter, PullResult, PushChange, PushResult } from '@logbook/core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { actAs, asAdmin, createDb, createUser, rpc } from '../../../../packages/db/test/harness';
import { db, getMeta, META } from '../data/db';
import { clearAll, loadState, newId, saveEncounter, setSupervisorPin, setupInternship, signOff } from '../data/repo';
import { syncOnce, type SyncTransport } from './engine';

/**
 * End-to-end sync: the device engine (IndexedDB via fake-indexeddb) talking to
 * the real migrations running in PGlite, as a signed-in intern.
 */

const INTERN = '0190a000-0000-7000-8000-0000000017e2';

let pg: PGlite;
const transport: SyncTransport = {
  async push(changes: PushChange[]) {
    await actAs(pg, INTERN);
    return rpc<PushResult>(pg, 'sync_push', [JSON.stringify(changes)]);
  },
  async pull(since: number) {
    await actAs(pg, INTERN);
    return rpc<PullResult>(pg, 'sync_pull', [since]);
  },
};

async function newDevice() {
  await clearAll();
}

async function createInternshipWithVisit() {
  const internshipId = await setupInternship({
    internName: 'Dr Sync Test',
    facilityName: 'Test Hospital',
    periodFrom: '2025-10-13',
    rotationOrder: ['OMF', 'PAED', 'PER', 'CONS', 'COMM'],
    supervisors: [{ name: 'Dr Sup', rotation: 'OMF' }],
  });
  const supervisorId = (await db.supervisors.toArray())[0]!.id;
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
    investigations: [{ kind: 'IOPA', site: '36' }],
    procedures: [
      { id: newId(), procedureTypeId: 'exam_plan', sites: [], level: 3 },
      { id: newId(), procedureTypeId: 'extraction', sites: ['36'], level: 4 },
    ],
    createdAt: '',
    updatedAt: '',
  };
  await saveEncounter(visit, { ref: 'OP-25-55555', birthYear: 1985, sex: 'M' });
  return { internshipId, visit };
}

beforeAll(async () => {
  pg = await createDb();
  await createUser(pg, INTERN);
}, 60_000);

beforeEach(async () => {
  await asAdmin(pg);
  await pg.exec(`truncate public.verification, public.logbook_entry, public.reflection, public.report_snapshot, public.activity,
                 public.encounter, public.patient, public.rotation, public.supervisor, public.internship, public.facility cascade`);
  await newDevice();
});

describe('sync engine ↔ Postgres', () => {
  it('pushes everything recorded offline and empties the outbox', async () => {
    await createInternshipWithVisit();
    expect(await db.outbox.count()).toBeGreaterThan(5);
    const res = await syncOnce(transport);
    expect(res.rejected).toEqual([]);
    expect(await db.outbox.count()).toBe(0);
    await asAdmin(pg);
    const counts = await pg.query<{ t: string; n: number }>(`
      select 'encounter' t, count(*)::int n from public.encounter union all
      select 'procedures', count(*)::int from public.encounter_procedure union all
      select 'entries', count(*)::int from public.logbook_entry union all
      select 'rotations', count(*)::int from public.rotation`);
    expect(Object.fromEntries(counts.rows.map((r) => [r.t, r.n]))).toEqual({ encounter: 1, procedures: 2, entries: 2, rotations: 5 });
    expect(await getMeta(META.lastSyncAt, null)).toBeTruthy();
  });

  it('restores the whole logbook on a second device', async () => {
    const { internshipId, visit } = await createInternshipWithVisit();
    await syncOnce(transport);
    const before = (await loadState()).dataset!;

    await newDevice(); // a new phone: empty store, same account
    expect((await loadState()).dataset).toBeNull();
    await syncOnce(transport);

    const after = (await loadState()).dataset!;
    expect(after.internship.id).toBe(internshipId);
    expect(after.rotations.map((r) => [r.rotation, r.startsOn, r.endsOn])).toEqual(before.rotations.map((r) => [r.rotation, r.startsOn, r.endsOn]));
    const enc = after.encounters.find((e) => e.id === visit.id)!;
    expect(enc.procedures.map((p) => [p.procedureTypeId, p.sites, p.level])).toEqual([
      ['exam_plan', [], 3],
      ['extraction', ['36'], 4],
    ]);
    expect(enc.findings).toEqual([{ term: 'Irreversible pulpitis', site: '36', isDiagnosis: true }]);
    expect(after.entries.map((e) => e.requirementCode).sort()).toEqual(['OMF 1', 'OMF 2']);
    expect(after.patients[0]).toMatchObject({ ref: 'OP-25-55555', birthYear: 1985, sex: 'M' });
  });

  it('syncs a supervisor sign-off made on the phone, and refuses later edits to verified entries', async () => {
    await createInternshipWithVisit();
    const supervisorId = (await db.supervisors.toArray())[0]!.id;
    await setSupervisorPin(supervisorId, '4071');
    const [first, second] = await db.entries.toArray();
    await signOff(supervisorId, '4071', [
      { entryId: first!.id, decision: 'verified', levelObserved: 3 },
      { entryId: second!.id, decision: 'returned', comment: 'Confirm the tooth' },
    ]);
    const res = await syncOnce(transport);
    expect(res.rejected).toEqual([]);
    await asAdmin(pg);
    const rows = await pg.query<{ id: string; status: string }>('select id, status from public.logbook_entry');
    expect(Object.fromEntries(rows.rows.map((r) => [r.id, r.status]))).toEqual({ [first!.id]: 'verified', [second!.id]: 'returned' });
    expect((await pg.query('select * from public.verification')).rows).toHaveLength(2);

    // The pull brings the supervisor row back; the PIN (device-only) survives it.
    await syncOnce(transport);
    expect((await db.supervisors.get(supervisorId))!.pinHash).toMatch(/^[0-9a-f]{64}$/);

    // Tamper on the device: change the level of the verified entry.
    const verified = (await db.entries.get(first!.id))!;
    await db.entries.put({ ...verified, levelClaimed: 5 });
    await db.outbox.add({ table: 'entries', recordId: verified.id, op: 'upsert', createdAt: new Date().toISOString(), attempts: 0, status: 'pending' });
    const again = await syncOnce(transport);
    expect(again.rejected).toHaveLength(1);
    expect(again.rejected[0]!.reason).toMatch(/cannot be changed/);
    expect((await db.outbox.toArray())[0]).toMatchObject({ status: 'error', attempts: 1 });
  });

  it('does not overwrite a local edit that has not been pushed yet', async () => {
    const { visit } = await createInternshipWithVisit();
    await syncOnce(transport);
    // Server copy changes (e.g. from another device)…
    await actAs(pg, INTERN);
    await rpc(pg, 'sync_push', [JSON.stringify([{ table: 'encounter', op: 'upsert', record: { id: visit.id, internship_id: (await db.internships.toArray())[0]!.id, date: '2025-11-03', visit_type: 'new', notes: 'from other device' } }])]);
    // …while this device has its own unsent edit.
    const local = (await db.encounters.get(visit.id))!;
    await db.encounters.put({ ...local, notes: 'edited here' });
    await db.outbox.add({ table: 'encounters', recordId: visit.id, op: 'upsert', createdAt: new Date().toISOString(), attempts: 0, status: 'pending' });
    // A pull-only pass must keep the local edit; the next push then wins (last writer).
    await syncOnce({ push: async () => ({ accepted: [], rejected: [] }), pull: transport.pull });
    expect((await db.encounters.get(visit.id))!.notes).toBe('edited here');
    await syncOnce(transport);
    await asAdmin(pg);
    expect((await pg.query<{ notes: string }>('select notes from public.encounter where id = $1', [visit.id])).rows[0]!.notes).toBe('edited here');
  });
});
