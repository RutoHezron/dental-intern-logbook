import type { PGlite } from '@electric-sql/pglite';
import { buildAccountSignatures, fromWire, toWire, uuidv7, type ChainTip, type LogbookEntry, type PullResult, type PushResult } from '@logbook/core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALICE, BOB, changesFor, deviceData } from './device';
import { actAs, asAdmin, createDb, createUser, rpc } from './harness';

/** Administrator route: register supervisors, link them to interns directly; the supervisor's activity feed. */

const ADMIN = '0190a000-0000-7000-8000-00000000ad01';
const DR_SUP = '0190a000-0000-7000-8000-0000000005a9';
const LATE = '0190a000-0000-7000-8000-000000001a7e';

interface Overview {
  interns: { owner_id: string; email: string; intern_name: string; supervisors: { id: string; name: string; account_id: string | null; linked: boolean }[] }[];
  supervisors: { id: string; email: string; name: string; signed_in: boolean; interns: number }[];
  admins: { email: string }[];
}
interface Queue {
  links: { supervisor_id: string; owner_id: string; intern_name: string; tip: { id: string; hash: string; signed_at: string } | null }[];
  entries: Record<string, unknown>[];
}
interface Activity {
  supervisor_id: string;
  summary: { total: number; submitted: number; returned: number; verified: number; last_7_days: number; last_on: string | null };
  entries: Record<string, unknown>[];
  case_reports: unknown[];
}

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
  await createUser(db, ADMIN, 'admin@hospital.org');
  await createUser(db, DR_SUP, 'dr.sup@hospital.org');
  await createUser(db, ALICE, 'alice@example.org');
  await createUser(db, BOB, 'bob@example.org');
}, 60_000);

beforeEach(async () => {
  await asAdmin(db);
  await db.exec(`
    truncate public.supervisor_invite, public.treatment_plan, public.case_report, public.assessment, public.verification, public.logbook_entry,
             public.reflection, public.report_snapshot, public.activity, public.encounter_procedure, public.finding, public.investigation,
             public.encounter, public.patient, public.rotation, public.supervisor, public.supervisor_account, public.app_admin,
             public.internship, public.facility cascade;
    delete from auth.users where id = '${LATE}';
    insert into public.app_admin (email) values ('admin@hospital.org');
  `);
});

/** Alice's logbook synced, with every entry submitted to her own supervisor record. */
async function aliceSynced(): Promise<{ supId: string }> {
  const d = deviceData();
  const supId = uuidv7();
  d.encounter.supervisorId = supId;
  d.entries = d.entries.map((e) => ({ ...e, supervisorId: supId }));
  await actAs(db, ALICE);
  const res = await rpc<PushResult>(db, 'sync_push', [
    JSON.stringify([
      ...changesFor(d).slice(0, 2),
      { table: 'supervisor', op: 'upsert', record: toWire({ id: supId, name: 'Dr Sup', role: 'Consultant' }) },
      ...changesFor(d).slice(2),
    ]),
  ]);
  expect(res.rejected).toEqual([]);
  return { supId };
}

async function asAdminUser<T>(fn: string, args: unknown[] = []): Promise<T> {
  await actAs(db, ADMIN);
  return rpc<T>(db, fn, args);
}

const register = (email = 'Dr.Sup@Hospital.org', name = 'Dr Sup Ervisor') =>
  asAdminUser<{ id: string }>('admin_register_supervisor', [email, name, 'Consultant', null]);

async function queue(user = DR_SUP) {
  await actAs(db, user);
  return rpc<Queue>(db, 'supervisor_queue', []);
}

describe('who may administer', () => {
  it('only listed administrators; everyone else is refused', async () => {
    await actAs(db, ALICE);
    expect(await rpc(db, 'is_admin', [])).toBe(false);
    await expect(rpc(db, 'admin_overview', [])).rejects.toThrow(/not an administrator/);
    await expect(rpc(db, 'admin_register_supervisor', ['x@y.org', 'X', null, null])).rejects.toThrow(/not an administrator/);
    await expect(rpc(db, 'admin_add_admin', ['alice@example.org'])).rejects.toThrow(/not an administrator/);
    // No direct table access either.
    await expect(db.query('select * from public.supervisor_account')).rejects.toThrow(/permission denied/);
    await expect(db.query(`insert into public.app_admin (email) values ('alice@example.org')`)).rejects.toThrow(/permission denied/);

    expect(await asAdminUser('is_admin')).toBe(true);
  });

  it('administrators add and remove others, but keep at least one', async () => {
    await asAdminUser('admin_add_admin', ['  Alice@Example.org ']);
    await actAs(db, ALICE);
    expect(await rpc(db, 'is_admin', [])).toBe(true);
    await rpc(db, 'admin_remove_admin', ['alice@example.org']);
    expect(await rpc(db, 'is_admin', [])).toBe(false);
    await expect(asAdminUser('admin_remove_admin', ['admin@hospital.org'])).rejects.toThrow(/at least one/);
  });
});

describe('registering and linking supervisors', () => {
  it('the overview lists interns with their supervisor records, but no clinical data', async () => {
    await aliceSynced();
    await register();
    const o = await asAdminUser<Overview>('admin_overview');
    expect(o.interns).toHaveLength(1);
    expect(o.interns[0]).toMatchObject({ owner_id: ALICE, email: 'alice@example.org', intern_name: 'Dr Test Intern', supervisors: [{ name: 'Dr Sup', linked: false }] });
    expect(o.supervisors).toEqual([expect.objectContaining({ email: 'dr.sup@hospital.org', name: 'Dr Sup Ervisor', signed_in: true, interns: 0 })]);
    expect(JSON.stringify(o)).not.toMatch(/patient|requirement_code|diagnos/);
  });

  it("linking an intern's existing record gives the supervisor the entries already submitted to it", async () => {
    const { supId } = await aliceSynced();
    const acc = await register();
    expect((await queue()).links).toEqual([]);
    expect(await asAdminUser('admin_link_supervisor', [acc.id, ALICE, supId])).toEqual({ supervisor_id: supId, linked: true });
    const q = await queue();
    expect(q.links).toEqual([expect.objectContaining({ supervisor_id: supId, owner_id: ALICE, intern_name: 'Dr Test Intern' })]);
    expect(q.entries.length).toBeGreaterThan(0);
    // Linking the same person twice to one intern is refused.
    await expect(asAdminUser('admin_link_supervisor', [acc.id, ALICE, null])).rejects.toThrow(/already linked/);
  });

  it("a new record is added to the intern's logbook, owned by the intern, and reaches their phone", async () => {
    await aliceSynced();
    const acc = await register();
    const { supervisor_id } = await asAdminUser<{ supervisor_id: string }>('admin_link_supervisor', [acc.id, ALICE, null]);
    await asAdmin(db);
    expect((await db.query<{ owner_id: string; user_id: string }>('select owner_id, user_id from public.supervisor where id = $1', [supervisor_id])).rows[0]).toEqual({
      owner_id: ALICE,
      user_id: DR_SUP,
    });
    await actAs(db, ALICE);
    const pull = await rpc<PullResult>(db, 'sync_pull', [0]);
    expect(pull.changes.supervisor!.map((r) => r.id)).toContain(supervisor_id);
    // The intern's phone, unaware of the link, cannot undo it by syncing.
    await rpc(db, 'sync_push', [JSON.stringify([{ table: 'supervisor', op: 'upsert', record: { id: supervisor_id, name: 'Dr Sup Ervisor', user_id: null, account_id: null } }])]);
    expect((await queue()).links.map((l) => l.supervisor_id)).toEqual([supervisor_id]);
  });

  it('a supervisor registered before they ever signed in is linked at their first sign-in', async () => {
    const { supId } = await aliceSynced();
    const acc = await register('late@hospital.org', 'Dr Late');
    expect(await asAdminUser('admin_link_supervisor', [acc.id, ALICE, supId])).toEqual({ supervisor_id: supId, linked: false });
    await createUser(db, LATE, 'Late@Hospital.org');
    expect((await queue(LATE)).links.map((l) => l.supervisor_id)).toEqual([supId]);
  });

  it('unlinking, removing a supervisor, and the intern disconnecting all end access', async () => {
    const { supId } = await aliceSynced();
    const acc = await register();
    await asAdminUser('admin_link_supervisor', [acc.id, ALICE, supId]);
    await asAdminUser('admin_unlink_supervisor', [supId]);
    expect((await queue()).links).toEqual([]);

    await asAdminUser('admin_link_supervisor', [acc.id, ALICE, supId]);
    await asAdminUser('admin_remove_supervisor', [acc.id]);
    expect((await queue()).links).toEqual([]);
    expect((await asAdminUser<Overview>('admin_overview')).supervisors).toEqual([]);

    const again = await register();
    await asAdminUser('admin_link_supervisor', [again.id, ALICE, supId]);
    await actAs(db, ALICE);
    await rpc(db, 'unlink_supervisor_account', [supId]);
    expect((await queue()).links).toEqual([]);
  });

  it('an intern cannot be linked as their own supervisor, nor to a record that is not theirs', async () => {
    const { supId } = await aliceSynced();
    const self = await register('alice@example.org', 'Alice');
    await expect(asAdminUser('admin_link_supervisor', [self.id, ALICE, null])).rejects.toThrow(/own logbook/);
    const acc = await register();
    const bob = deviceData();
    await actAs(db, BOB);
    await rpc(db, 'sync_push', [JSON.stringify(changesFor(bob))]);
    await expect(asAdminUser('admin_link_supervisor', [acc.id, BOB, supId])).rejects.toThrow(/not in this intern's logbook/);
  });
});

describe("the supervisor's activity feed", () => {
  it('shows what the intern submitted to them with status and decision, never drafts or patient numbers', async () => {
    const { supId } = await aliceSynced();
    const acc = await register();
    await asAdminUser('admin_link_supervisor', [acc.id, ALICE, supId]);
    // One entry still a draft: private to the intern.
    await asAdmin(db);
    await db.query(`update public.logbook_entry set status = 'draft' where id = (select id from public.logbook_entry order by id limit 1)`);

    const q = await queue();
    const [first] = q.entries.map((r) => fromWire<LogbookEntry>(r));
    const tip = q.links[0]!.tip ? fromWire<ChainTip>(q.links[0]!.tip) : null;
    const sigs = buildAccountSignatures(supId, tip, [{ kind: 'entry', entry: first!, decision: 'returned', comment: 'Add the radiograph' }], new Date(), uuidv7);
    await actAs(db, DR_SUP);
    await rpc(db, 'supervisor_sign', [JSON.stringify(sigs.map((v) => toWire(v)))]);

    const [a] = await rpc<Activity[]>(db, 'supervisor_activity', []);
    expect(a!.supervisor_id).toBe(supId);
    expect(a!.summary).toMatchObject({ total: q.entries.length, returned: 1, submitted: q.entries.length - 1, verified: 0 });
    expect(a!.entries.every((e) => e.status !== 'draft')).toBe(true);
    expect(a!.entries.find((e) => e.id === first!.id)).toMatchObject({ status: 'returned', decision: { decision: 'returned', comment: 'Add the radiograph' } });
    expect(JSON.stringify(a)).not.toMatch(/patient_ref|patient_id/);
  });

  it('is empty for anyone not linked', async () => {
    await aliceSynced();
    await actAs(db, DR_SUP);
    expect(await rpc(db, 'supervisor_activity', [])).toEqual([]);
  });
});
