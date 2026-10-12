import { buildAccountSignatures, checkVerificationChain, fromWire, toWire, uuidv7, type ChainTip, type LogbookEntry, type Verification } from '@logbook/core';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALICE, BOB, changesFor, deviceData, type DeviceData } from '../../../packages/db/test/device';
import type { Ctx, Row } from '../src/server/context';
import { coordinatorCohort, myCoordinatorShares, revokeCoordinatorShare } from '../src/server/coordinator';
import { acceptCoordinatorInvite, acceptSupervisorInvite, createCoordinatorInvite, createSupervisorInvite, unlinkSupervisorAccount } from '../src/server/invites';
import { pushDue, pushReport, savePushSubscription } from '../src/server/push';
import { supervisorQueue, supervisorSign } from '../src/server/supervisor';
import { syncPull, syncPush } from '../src/server/sync';

/**
 * The Firebase backend against the Firestore emulator: the same behaviours
 * the Postgres suite (packages/db) checks, so both backends keep one contract.
 * Run with: npm run test:emulator -w @logbook/functions
 */

const PROJECT = 'demo-logbook';
const SUP = '0190a000-0000-7000-8000-0000000005a9';
const COORD = '0190a000-0000-7000-8000-00000000c00d';

initializeApp({ projectId: PROJECT });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

const as = (uid: string | null, now = new Date(), email: string | null = null): Ctx => ({ db, uid, email, now });

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run these tests with the Firestore emulator (npm run test:emulator).');
});

beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
});

async function aliceWith(supervisor = false): Promise<{ d: DeviceData; supId: string }> {
  const d = deviceData();
  const supId = uuidv7();
  if (supervisor) {
    d.encounter.supervisorId = supId;
    d.entries = d.entries.map((e) => ({ ...e, supervisorId: supId }));
  }
  const changes = changesFor(d);
  const res = await syncPush(as(ALICE), [...changes.slice(0, 2), { table: 'supervisor', op: 'upsert', record: toWire({ id: supId, name: 'Dr Sup Ervisor' }) }, ...changes.slice(2)]);
  expect(res.rejected).toEqual([]);
  return { d, supId };
}

const entriesOf = async (uid: string) => new Map((await syncPull(as(uid), 0)).changes.logbook_entry!.map((r) => fromWire<LogbookEntry>(r)).map((e) => [e.id, e]));
const pinSignOff = (entryId: string, decision: 'verified' | 'returned', method = 'pin') => ({
  table: 'verification',
  op: 'upsert' as const,
  record: { id: uuidv7(), entry_id: entryId, verifier_id: uuidv7(), decision, level_observed: decision === 'verified' ? 4 : null, comment: decision === 'returned' ? 'Confirm the tooth' : null, method, signed_at: '2025-11-03T16:00:00.000Z', prev_hash: null, hash: 'b'.repeat(64) },
});

describe('sync', () => {
  it('round-trips a device dataset and pulls only newer changes', async () => {
    const { d } = await aliceWith();
    const first = await syncPull(as(ALICE), 0);
    expect(first.changes.logbook_entry).toHaveLength(d.entries.length);
    const enc = fromWire<typeof d.encounter>(first.changes.encounter![0]!);
    expect(enc.procedures.map((p) => [p.procedureTypeId, p.sites, p.level])).toEqual(d.encounter.procedures.map((p) => [p.procedureTypeId, p.sites, p.level]));
    expect(enc.findings).toEqual(d.encounter.findings);
    const again = await syncPull(as(ALICE), first.cursor);
    expect(Object.values(again.changes).flat()).toEqual([]);
  });

  it('stores only known columns: no patient names or phone numbers', async () => {
    await aliceWith();
    const id = uuidv7();
    await syncPush(as(ALICE), [{ table: 'patient', record: { id, ref: 'OP-25-1', birth_year: 1990, name: 'Jane Doe', phone: '0700000000' } }]);
    const row = (await db.doc(`users/${ALICE}/patient/${id}`).get()).data()!;
    expect(row).not.toHaveProperty('name');
    expect(row).not.toHaveProperty('phone');
  });

  it("keeps each intern's records private and pins ownership", async () => {
    await aliceWith();
    expect(Object.values((await syncPull(as(BOB), 0)).changes).flat()).toEqual([]);
    await expect(syncPull(as(null), 0)).rejects.toThrow(/Sign in/);
  });

  it('refuses tables a device must not write, one change at a time', async () => {
    const res = await syncPush(as(ALICE), [{ table: 'audit_log', record: { id: uuidv7() } }, { table: 'facility', record: { id: uuidv7(), name: 'X' } }]);
    expect(res.accepted).toHaveLength(1);
    expect(res.rejected[0]!.reason).toMatch(/cannot be written by a device/);
  });

  it('a device cannot mark its own entry verified; a PIN sign-off can, and then it is locked', async () => {
    const { d } = await aliceWith();
    const entry = d.entries[0]!;
    await syncPush(as(ALICE), [{ table: 'logbook_entry', record: toWire({ ...entry, status: 'verified' }) }]);
    expect((await entriesOf(ALICE)).get(entry.id)!.status).toBe('submitted');

    const v = pinSignOff(entry.id, 'verified');
    expect((await syncPush(as(ALICE), [v])).rejected).toEqual([]);
    expect((await entriesOf(ALICE)).get(entry.id)!.status).toBe('verified');
    // Re-sending is harmless; deleting or editing is refused.
    expect((await syncPush(as(ALICE), [v])).rejected).toEqual([]);
    expect((await syncPush(as(ALICE), [{ ...v, op: 'delete' }])).rejected[0]!.reason).toMatch(/cannot be deleted/);
    const edit = await syncPush(as(ALICE), [{ table: 'logbook_entry', record: toWire({ ...entry, levelClaimed: 5, status: 'verified' }) }]);
    expect(edit.rejected[0]!.reason).toMatch(/cannot be changed/);
  });

  it('only PIN sign-offs, only for the intern\'s own entries; a returned entry can be resubmitted', async () => {
    const { d } = await aliceWith();
    expect((await syncPush(as(ALICE), [pinSignOff(d.entries[0]!.id, 'verified', 'account')])).rejected[0]!.reason).toMatch(/row-level security/);
    expect((await syncPush(as(BOB), [pinSignOff(d.entries[0]!.id, 'verified')])).rejected).toHaveLength(1);
    await syncPush(as(ALICE), [pinSignOff(d.entries[1]!.id, 'returned')]);
    expect((await entriesOf(ALICE)).get(d.entries[1]!.id)!.status).toBe('returned');
    await syncPush(as(ALICE), [{ table: 'logbook_entry', record: toWire({ ...d.entries[1]!, site: '46', status: 'submitted' }) }]);
    expect((await entriesOf(ALICE)).get(d.entries[1]!.id)!.status).toBe('submitted');
  });
});

describe('supervisor accounts', () => {
  async function link(supId: string) {
    const { code } = await createSupervisorInvite(as(ALICE), supId);
    return acceptSupervisorInvite(as(SUP), code.toLowerCase());
  }
  const tipOf = (q: Awaited<ReturnType<typeof supervisorQueue>>): ChainTip | null => (q.links[0]!.tip ? fromWire<ChainTip>(q.links[0]!.tip as Row) : null);

  it('invite codes: single use, not your own, not expired; a device cannot set the link', async () => {
    const { supId } = await aliceWith(true);
    await expect(createSupervisorInvite(as(ALICE), uuidv7())).rejects.toThrow(/Sync your logbook first/);
    const { code } = await createSupervisorInvite(as(ALICE), supId);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    await expect(acceptSupervisorInvite(as(ALICE), code)).rejects.toThrow(/own logbook/);
    expect(await acceptSupervisorInvite(as(SUP), code)).toMatchObject({ intern_name: 'Dr Test Intern', supervisor_name: 'Dr Sup Ervisor' });
    await expect(acceptSupervisorInvite(as(BOB), code)).rejects.toThrow(/not valid/);
    const { code: late } = await createSupervisorInvite(as(ALICE), supId);
    await expect(acceptSupervisorInvite(as(BOB, new Date(Date.now() + 8 * 86_400_000)), late)).rejects.toThrow(/not valid/);

    // The phone, unaware of the link, re-sends the supervisor: the link stays.
    await syncPush(as(ALICE), [{ table: 'supervisor', record: { id: supId, name: 'Dr S. Ervisor', user_id: BOB } }]);
    expect((await db.doc(`users/${ALICE}/supervisor/${supId}`).get()).data()).toMatchObject({ user_id: SUP, name: 'Dr S. Ervisor' });
    await unlinkSupervisorAccount(as(ALICE), supId);
    expect((await supervisorQueue(as(SUP))).links).toEqual([]);
  });

  it('the queue holds only what was submitted to the supervisor, with visit context', async () => {
    const { d, supId } = await aliceWith(true);
    expect((await supervisorQueue(as(SUP))).entries).toEqual([]);
    await link(supId);
    const q = await supervisorQueue(as(SUP));
    expect(q.links[0]).toMatchObject({ supervisor_id: supId, owner_id: ALICE, intern_name: 'Dr Test Intern', tip: null });
    expect(q.entries.map((e) => e.id).sort()).toEqual(d.entries.map((e) => e.id).sort());
    expect(q.entries[0]).toMatchObject({ visit: expect.objectContaining({ diagnoses: ['Irreversible pulpitis (36)'] }) });
    expect(JSON.stringify(q)).not.toMatch(/birth_year|patient_id/);
    // Nothing reaches the supervisor's own logbook sync.
    expect(Object.values((await syncPull(as(SUP), 0)).changes).flat()).toEqual([]);
  });

  it('signs on the supervisor\'s chain; the intern pulls the decisions and the chain verifies', async () => {
    const { d, supId } = await aliceWith(true);
    await link(supId);
    const q = await supervisorQueue(as(SUP));
    const [a, b] = q.entries.map((r) => fromWire<LogbookEntry>(r));
    const sigs = buildAccountSignatures(supId, tipOf(q), [
      { kind: 'entry', entry: a!, decision: 'verified', levelObserved: 3 },
      { kind: 'entry', entry: b!, decision: 'returned', comment: 'Add the radiograph' },
    ], new Date(), uuidv7);
    expect(await supervisorSign(as(SUP), sigs.map((v) => toWire(v)))).toEqual({ signed: 2 });
    expect((await supervisorQueue(as(SUP))).entries).toEqual([]);

    const pull = await syncPull(as(ALICE), 0);
    const statuses = Object.fromEntries(pull.changes.logbook_entry!.map((r) => [r.id, r.status]));
    expect(statuses[a!.id]).toBe('verified');
    expect(statuses[b!.id]).toBe('returned');
    const vs = pull.changes.verification!.map((r) => fromWire<Verification>(r));
    expect(checkVerificationChain(vs, new Map(d.entries.map((e) => [e.id, e])))).toEqual([]);
  });

  it('a stale chain head is refused and nothing is half-applied; strangers cannot sign', async () => {
    const { supId } = await aliceWith(true);
    await link(supId);
    const [a, b] = (await supervisorQueue(as(SUP))).entries.map((r) => fromWire<LogbookEntry>(r));
    const one = buildAccountSignatures(supId, null, [{ kind: 'entry', entry: a!, decision: 'verified' }], new Date(), uuidv7);
    const two = buildAccountSignatures(supId, null, [{ kind: 'entry', entry: b!, decision: 'verified' }], new Date(), uuidv7);
    await expect(supervisorSign(as(BOB), one.map((v) => toWire(v)))).rejects.toThrow(/not linked/);
    await supervisorSign(as(SUP), one.map((v) => toWire(v)));
    await expect(supervisorSign(as(SUP), two.map((v) => toWire(v)))).rejects.toThrow(/chain_moved/);
    expect((await supervisorQueue(as(SUP))).entries).toHaveLength(1);
    await expect(supervisorSign(as(SUP), buildAccountSignatures(supId, tipOf(await supervisorQueue(as(SUP))), [{ kind: 'entry', entry: a!, decision: 'verified' }], new Date(), uuidv7).map((v) => toWire(v)))).rejects.toThrow(/no longer awaiting/);
  });
});

describe('coordinator sharing', () => {
  it('shares counts, never entries; the intern sees and can revoke', async () => {
    await aliceWith();
    expect(await coordinatorCohort(as(COORD))).toEqual([]);
    const { code } = await createCoordinatorInvite(as(ALICE));
    expect(await acceptCoordinatorInvite(as(COORD, new Date(), 'coordinator@example.org'), code)).toEqual({ intern_name: 'Dr Test Intern' });
    const [m] = await coordinatorCohort(as(COORD));
    expect(m).toMatchObject({ owner_id: ALICE, intern_name: 'Dr Test Intern', facility_name: 'Example County Referral Hospital' });
    expect((m!.counts as { pending: number }[]).reduce((n, c) => n + c.pending, 0)).toBe(2);
    expect(JSON.stringify(m)).not.toMatch(/OP-25|patient|pulpitis|"site"/);
    const shares = await myCoordinatorShares(as(ALICE));
    expect(shares.map((s) => s.coordinator_email)).toEqual(['coordinator@example.org']);
    await revokeCoordinatorShare(as(ALICE), shares[0]!.id);
    expect(await coordinatorCohort(as(COORD))).toEqual([]);
  });
});

describe('push reminders', () => {
  it('counts-only reminders, once a day', async () => {
    await aliceWith();
    await savePushSubscription(as(ALICE), `https://push.example.org/${ALICE}`, 'k', 'a');
    const [n] = await pushDue(as(null), '2025-11-20');
    expect(n!.body).toMatch(/^2 entries have waited more than a week for verification\./);
    expect(JSON.stringify(n)).not.toMatch(/OP-25|pulpitis/);
    await pushReport(as(null), { sent: [n!.id], gone: [], failed: [] }, '2025-11-20');
    expect(await pushDue(as(null), '2025-11-20')).toEqual([]);
  });
});
