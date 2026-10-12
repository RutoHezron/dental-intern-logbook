import type { PGlite } from '@electric-sql/pglite';
import { buildAccountSignatures, checkVerificationChain, fromWire, toWire, uuidv7, type ChainTip, type LogbookEntry, type PullResult, type PushResult, type Verification } from '@logbook/core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALICE, BOB, changesFor, deviceData, type DeviceData } from './device';
import { actAs, asAdmin, createDb, createUser, rpc } from './harness';

/** Supervisor accounts: invite, accept, review only what was submitted to you, sign on your own chain. */

const DR_SUP = '0190a000-0000-7000-8000-0000000005a9';
const DR_OTHER = '0190a000-0000-7000-8000-0000000007e7';

interface Queue {
  links: { supervisor_id: string; owner_id: string; intern_name: string; supervisor_name: string; tip: { id: string; hash: string; signed_at: string } | null }[];
  entries: Record<string, unknown>[];
  case_reports: Record<string, unknown>[];
}

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
  for (const u of [ALICE, BOB, DR_SUP, DR_OTHER]) await createUser(db, u);
}, 60_000);

beforeEach(async () => {
  await asAdmin(db);
  await db.exec(`
    truncate public.supervisor_invite, public.treatment_plan, public.case_report, public.assessment, public.verification, public.logbook_entry,
             public.reflection, public.report_snapshot, public.activity, public.encounter_procedure, public.finding, public.investigation,
             public.encounter, public.patient, public.rotation, public.supervisor, public.internship, public.facility cascade;
  `);
});

/** Alice's logbook with every entry submitted to one supervisor record; returns the data and the supervisor id. */
async function aliceWithSupervisor(): Promise<{ d: DeviceData; supId: string }> {
  const d = deviceData();
  const supId = uuidv7();
  d.encounter.supervisorId = supId;
  d.entries = d.entries.map((e) => ({ ...e, supervisorId: supId }));
  await actAs(db, ALICE);
  const res = await rpc<PushResult>(db, 'sync_push', [
    JSON.stringify([
      ...changesFor(d).slice(0, 2),
      { table: 'supervisor', op: 'upsert', record: toWire({ id: supId, name: 'Dr Sup Ervisor', role: 'Consultant' }) },
      ...changesFor(d).slice(2),
    ]),
  ]);
  expect(res.rejected).toEqual([]);
  return { d, supId };
}

async function invite(supId: string): Promise<string> {
  await actAs(db, ALICE);
  return (await rpc<{ code: string }>(db, 'create_supervisor_invite', [supId])).code;
}

async function linkSupervisor(supId: string, user = DR_SUP) {
  const code = await invite(supId);
  await actAs(db, user);
  return rpc<{ intern_name: string; supervisor_name: string }>(db, 'accept_supervisor_invite', [code.toLowerCase()]);
}

const queue = async (user = DR_SUP) => {
  await actAs(db, user);
  return rpc<Queue>(db, 'supervisor_queue', []);
};

const toEntry = (row: Record<string, unknown>) => fromWire<LogbookEntry>(row);
const tipOf = (q: Queue): ChainTip | null => (q.links[0]!.tip ? fromWire<ChainTip>(q.links[0]!.tip) : null);

async function sign(user: string, sigs: Verification[]) {
  await actAs(db, user);
  return rpc<{ signed: number }>(db, 'supervisor_sign', [JSON.stringify(sigs.map((v) => toWire(v)))]);
}

describe('invites', () => {
  it('a one-time code links the supervisor record to the supervisor\'s account', async () => {
    const { supId } = await aliceWithSupervisor();
    const code = await invite(supId);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    // Only the hash is stored.
    await asAdmin(db);
    const stored = (await db.query<{ code_hash: string }>('select code_hash from public.supervisor_invite')).rows;
    expect(JSON.stringify(stored)).not.toContain(code.replace(/-/g, ''));

    await actAs(db, DR_SUP);
    const res = await rpc<{ intern_name: string; supervisor_name: string }>(db, 'accept_supervisor_invite', [code.replace(/-/g, ' ').toLowerCase()]);
    expect(res).toMatchObject({ intern_name: 'Dr Test Intern', supervisor_name: 'Dr Sup Ervisor' });
    // Single use.
    await actAs(db, DR_OTHER);
    await expect(rpc(db, 'accept_supervisor_invite', [code])).rejects.toThrow(/not valid/);
  });

  it('expired codes, unknown codes and self-invites are refused', async () => {
    const { supId } = await aliceWithSupervisor();
    const code = await invite(supId);
    await expect(rpc(db, 'accept_supervisor_invite', [code])).rejects.toThrow(/own logbook/);
    await actAs(db, DR_SUP);
    await expect(rpc(db, 'accept_supervisor_invite', ['AAAA-BBBB-CCCC'])).rejects.toThrow(/not valid/);
    await asAdmin(db);
    await db.query(`update public.supervisor_invite set expires_at = now() - interval '1 minute'`);
    await actAs(db, DR_SUP);
    await expect(rpc(db, 'accept_supervisor_invite', [code])).rejects.toThrow(/not valid/);
  });

  it('a device cannot link an account itself, and a sync does not undo a link', async () => {
    const { supId } = await aliceWithSupervisor();
    await actAs(db, ALICE);
    await rpc(db, 'sync_push', [JSON.stringify([{ table: 'supervisor', op: 'upsert', record: { id: supId, name: 'Dr Sup Ervisor', user_id: BOB } }])]);
    await asAdmin(db);
    expect((await db.query<{ user_id: string | null }>('select user_id from public.supervisor')).rows[0]!.user_id).toBeNull();

    await linkSupervisor(supId);
    await actAs(db, ALICE);
    // A later edit from the phone (which knows nothing of the link) keeps it.
    await rpc(db, 'sync_push', [JSON.stringify([{ table: 'supervisor', op: 'upsert', record: { id: supId, name: 'Dr S. Ervisor', user_id: null } }])]);
    await asAdmin(db);
    expect((await db.query<{ user_id: string; name: string }>('select user_id, name from public.supervisor')).rows[0]).toEqual({ user_id: DR_SUP, name: 'Dr S. Ervisor' });

    // The intern can disconnect the account.
    await actAs(db, ALICE);
    await rpc(db, 'unlink_supervisor_account', [supId]);
    expect((await queue()).links).toEqual([]);
  });

  it('an invite needs the supervisor to be on the server first', async () => {
    await aliceWithSupervisor();
    await actAs(db, ALICE);
    await expect(rpc(db, 'create_supervisor_invite', [uuidv7()])).rejects.toThrow(/Sync your logbook first/);
  });
});

describe("what a linked supervisor can see", () => {
  it('their queue: entries submitted to them, with visit context, and nothing before linking', async () => {
    const { d, supId } = await aliceWithSupervisor();
    expect((await queue()).entries).toEqual([]);
    await linkSupervisor(supId);
    const q = await queue();
    expect(q.links).toHaveLength(1);
    expect(q.links[0]).toMatchObject({ supervisor_id: supId, owner_id: ALICE, intern_name: 'Dr Test Intern', tip: null });
    expect(q.entries.map((r) => r.id).sort()).toEqual(d.entries.map((e) => e.id).sort());
    const extraction = q.entries.find((r) => r.requirement_code !== d.entries[0]!.requirementCode) ?? q.entries[0]!;
    expect(extraction).toMatchObject({ rotation: expect.any(String), visit: expect.objectContaining({ diagnoses: ['Irreversible pulpitis (36)'] }) });
    expect(JSON.stringify(q)).not.toMatch(/patient_id|birth_year/);
  });

  it('nothing else: no other intern, no other supervisor\'s entries, no direct writes', async () => {
    const { supId } = await aliceWithSupervisor();
    await linkSupervisor(supId);
    // Bob's data, unrelated.
    const bob = deviceData();
    await actAs(db, BOB);
    await rpc(db, 'sync_push', [JSON.stringify(changesFor(bob))]);
    // An entry of Alice's for a different supervisor.
    await asAdmin(db);
    await db.query(`update public.logbook_entry set supervisor_id = null where id = (select id from public.logbook_entry where owner_id = $1 limit 1)`, [ALICE]);

    await actAs(db, DR_SUP);
    const visible = (await db.query<{ owner_id: string; supervisor_id: string }>('select owner_id, supervisor_id from public.logbook_entry')).rows;
    expect(visible.every((r) => r.owner_id === ALICE && r.supervisor_id === supId)).toBe(true);
    expect((await db.query('select * from public.patient')).rows).toEqual([]);
    expect((await db.query('select * from public.reflection')).rows).toEqual([]);
    // Read-only: a direct update changes nothing.
    await db.query(`update public.logbook_entry set status = 'verified'`);
    await asAdmin(db);
    expect((await db.query(`select * from public.logbook_entry where status = 'verified'`)).rows).toEqual([]);
  });

  it("a supervisor who keeps their own logbook never pulls their interns' records into it", async () => {
    const { supId } = await aliceWithSupervisor();
    await linkSupervisor(supId);
    await actAs(db, DR_SUP);
    const pull = await rpc<PullResult>(db, 'sync_pull', [0]);
    expect(Object.values(pull.changes).flat()).toEqual([]);
  });
});

describe('signing from the supervisor\'s account', () => {
  it('verifies and returns entries; the intern pulls the decisions and the chain checks out', async () => {
    const { d, supId } = await aliceWithSupervisor();
    await linkSupervisor(supId);
    const q = await queue();
    const [a, b] = q.entries.map(toEntry);
    const sigs = buildAccountSignatures(supId, tipOf(q), [
      { kind: 'entry', entry: a!, decision: 'verified', levelObserved: 3 },
      { kind: 'entry', entry: b!, decision: 'returned', comment: 'Please add the radiograph' },
    ], new Date(), uuidv7);
    expect(await sign(DR_SUP, sigs)).toEqual({ signed: 2 });
    expect((await queue()).entries).toEqual([]);
    expect((await queue()).links[0]!.tip!.hash).toBe(sigs[1]!.hash);

    // The intern's next pull brings the statuses and the verification records.
    await actAs(db, ALICE);
    const pull = await rpc<PullResult>(db, 'sync_pull', [0]);
    const entries = new Map(pull.changes.logbook_entry!.map((r) => toEntry(r)).map((e) => [e.id, e]));
    expect(entries.get(a!.id)!.status).toBe('verified');
    expect(entries.get(b!.id)!.status).toBe('returned');
    const verifications = pull.changes.verification!.map((r) => fromWire<Verification>(r));
    expect(verifications.map((v) => v.method)).toEqual(['account', 'account']);
    // Hashes still match after the round trip through Postgres.
    expect(checkVerificationChain(verifications, new Map(d.entries.map((e) => [e.id, { ...e, supervisorId: supId }])))).toEqual([]);
  });

  it('a second device signing on a stale chain head is refused and nothing is half-applied', async () => {
    const { supId } = await aliceWithSupervisor();
    await linkSupervisor(supId);
    const q = await queue();
    const [a, b] = q.entries.map(toEntry);
    const phone = buildAccountSignatures(supId, null, [{ kind: 'entry', entry: a!, decision: 'verified' }], new Date(), uuidv7);
    const laptop = buildAccountSignatures(supId, null, [{ kind: 'entry', entry: b!, decision: 'verified' }], new Date(), uuidv7);
    await sign(DR_SUP, phone);
    await expect(sign(DR_SUP, laptop)).rejects.toThrow(/chain_moved/);
    // Rebuilt on the new head, it goes through.
    const tip = tipOf(await queue());
    await sign(DR_SUP, buildAccountSignatures(supId, tip, [{ kind: 'entry', entry: b!, decision: 'verified' }], new Date(), uuidv7));
    expect((await queue()).entries).toEqual([]);
  });

  it('only the linked supervisor, only for items submitted to them and still awaiting verification', async () => {
    const { supId } = await aliceWithSupervisor();
    await linkSupervisor(supId);
    const [a] = (await queue()).entries.map(toEntry);
    const sigs = buildAccountSignatures(supId, null, [{ kind: 'entry', entry: a!, decision: 'verified' }], new Date(), uuidv7);
    await expect(sign(DR_OTHER, sigs)).rejects.toThrow(/not linked/);
    await expect(sign(ALICE, sigs)).rejects.toThrow(/not linked/);
    await sign(DR_SUP, sigs);
    const again = buildAccountSignatures(supId, tipOf(await queue()), [{ kind: 'entry', entry: a!, decision: 'verified' }], new Date(), uuidv7);
    await expect(sign(DR_SUP, again)).rejects.toThrow(/no longer awaiting/);
    // The intern's device still cannot push account sign-offs itself.
    await actAs(db, ALICE);
    const pushed = await rpc<PushResult>(db, 'sync_push', [JSON.stringify([{ table: 'verification', op: 'upsert', record: toWire({ ...again[0]!, id: uuidv7() }) }])]);
    expect(pushed.rejected).toHaveLength(1);
  });

  it('a verified entry is locked against later edits from the phone', async () => {
    const { d, supId } = await aliceWithSupervisor();
    await linkSupervisor(supId);
    const [a] = (await queue()).entries.map(toEntry);
    await sign(DR_SUP, buildAccountSignatures(supId, null, [{ kind: 'entry', entry: a!, decision: 'verified' }], new Date(), uuidv7));
    await actAs(db, ALICE);
    const original = d.entries.find((e) => e.id === a!.id)!;
    const res = await rpc<PushResult>(db, 'sync_push', [JSON.stringify([{ table: 'logbook_entry', op: 'upsert', record: toWire({ ...original, supervisorId: supId, levelClaimed: 5 }) }])]);
    expect(res.rejected[0]!.reason).toMatch(/cannot be changed/);
  });
});
