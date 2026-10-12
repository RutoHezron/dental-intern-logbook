import type { PGlite } from '@electric-sql/pglite';
import { toWire, uuidv7, type PushResult } from '@logbook/core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALICE, BOB, changesFor, deviceData } from './device';
import { actAs, asAdmin, createDb, createUser, rpc } from './harness';

/** Coordinator cohort view: opt-in sharing of progress aggregates, never entries. */

const COORD = '0190a000-0000-7000-8000-00000000c00d';

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
  for (const u of [ALICE, BOB, COORD]) await createUser(db, u, u === COORD ? 'coordinator@example.org' : undefined);
}, 60_000);

beforeEach(async () => {
  await asAdmin(db);
  await db.exec(`
    truncate public.coordinator_invite, public.coordinator_share, public.supervisor_invite, public.treatment_plan, public.case_report, public.assessment,
             public.verification, public.logbook_entry, public.reflection, public.report_snapshot, public.activity, public.encounter_procedure,
             public.finding, public.investigation, public.encounter, public.patient, public.rotation, public.supervisor, public.internship, public.facility cascade;
  `);
});

async function alice() {
  const d = deviceData();
  await actAs(db, ALICE);
  const res = await rpc<PushResult>(db, 'sync_push', [JSON.stringify(changesFor(d))]);
  expect(res.rejected).toEqual([]);
  return d;
}

async function share(user = COORD) {
  await actAs(db, ALICE);
  const { code } = await rpc<{ code: string }>(db, 'create_coordinator_invite', []);
  await actAs(db, user);
  return rpc<{ intern_name: string }>(db, 'accept_coordinator_invite', [code]);
}

const cohort = async (user = COORD) => {
  await actAs(db, user);
  return rpc<Record<string, unknown>[]>(db, 'coordinator_cohort', []);
};

describe('coordinator shares', () => {
  it('nothing is visible until the intern shares; then counts, never entries', async () => {
    const d = await alice();
    expect(await cohort()).toEqual([]);
    expect(await share()).toEqual({ intern_name: 'Dr Test Intern' });

    const [m] = await cohort();
    expect(m).toMatchObject({ owner_id: ALICE, intern_name: 'Dr Test Intern', facility_name: 'Example County Referral Hospital' });
    const counts = m!.counts as { code: string; logged: number; verified: number; pending: number }[];
    expect(counts.reduce((n, c) => n + c.logged, 0)).toBe(d.entries.length);
    expect(counts.every((c) => c.verified === 0 && c.pending === c.logged)).toBe(true);
    expect((m!.rotations as unknown[]).length).toBe(5);
    // No patient number, tooth, visit or free text leaves the server.
    expect(JSON.stringify(m)).not.toMatch(/OP-25|patient|"site"|objectives|pulpitis/);

    // The coordinator cannot read the intern's rows directly.
    await actAs(db, COORD);
    for (const t of ['logbook_entry', 'encounter', 'patient', 'internship', 'rotation', 'assessment']) {
      expect((await db.query(`select * from public.${t}`)).rows, t).toEqual([]);
    }
    // And nothing reaches their own sync.
    const pull = await rpc<{ changes: Record<string, unknown[]> }>(db, 'sync_pull', [0]);
    expect(Object.values(pull.changes).flat()).toEqual([]);
  });

  it('counts follow verification status set on the server', async () => {
    const d = await alice();
    await share();
    // A PIN sign-off from the phone verifies one entry.
    await actAs(db, ALICE);
    const entry = d.entries[0]!;
    await rpc(db, 'sync_push', [JSON.stringify([{ table: 'verification', op: 'upsert', record: toWire({
      id: uuidv7(), entryId: entry.id, verifierId: uuidv7(), decision: 'verified', method: 'pin', signedAt: '2025-11-03T16:00:00.000Z', prevHash: null, hash: 'c'.repeat(64),
    }) }])]);
    const counts = (await cohort())[0]!.counts as { code: string; verified: number }[];
    expect(counts.find((c) => c.code === entry.requirementCode)!.verified).toBe(1);
  });

  it('the intern sees who can see their progress and can stop sharing', async () => {
    await alice();
    await share();
    await actAs(db, ALICE);
    const shares = await rpc<{ id: string; coordinator_email: string }[]>(db, 'my_coordinator_shares', []);
    expect(shares.map((s) => s.coordinator_email)).toEqual(['coordinator@example.org']);
    await rpc(db, 'revoke_coordinator_share', [shares[0]!.id]);
    expect(await rpc(db, 'my_coordinator_shares', [])).toEqual([]);
    expect(await cohort()).toEqual([]);
    // Another intern cannot revoke or see Alice's shares.
    await share();
    await actAs(db, BOB);
    expect(await rpc(db, 'my_coordinator_shares', [])).toEqual([]);
  });

  it('codes are single use, expire, and cannot be self-accepted; sharing needs a synced logbook', async () => {
    await actAs(db, ALICE);
    await expect(rpc(db, 'create_coordinator_invite', [])).rejects.toThrow(/Sync your logbook first/);
    await alice();
    await actAs(db, ALICE);
    const { code } = await rpc<{ code: string }>(db, 'create_coordinator_invite', []);
    await expect(rpc(db, 'accept_coordinator_invite', [code])).rejects.toThrow(/own logbook/);
    await actAs(db, COORD);
    await rpc(db, 'accept_coordinator_invite', [code]);
    await actAs(db, BOB);
    await expect(rpc(db, 'accept_coordinator_invite', [code])).rejects.toThrow(/not valid/);
    await actAs(db, ALICE);
    const { code: second } = await rpc<{ code: string }>(db, 'create_coordinator_invite', []);
    await asAdmin(db);
    await db.query(`update public.coordinator_invite set expires_at = now() - interval '1 second' where accepted_at is null`);
    await actAs(db, BOB);
    await expect(rpc(db, 'accept_coordinator_invite', [second])).rejects.toThrow(/not valid/);
  });
});
