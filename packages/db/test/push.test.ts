import type { PGlite } from '@electric-sql/pglite';
import { toWire, uuidv7, type PushResult } from '@logbook/core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { safeUrl, sendAll, type DuePush } from '../../../supabase/functions/send-reminders/send';
import { ALICE, BOB, changesFor, deviceData } from './device';
import { actAs, asAdmin, createDb, createUser, rpc } from './harness';

/** Web push reminders: opt-in subscriptions, counts-only digests, one a day, sender-only access. */

const SUP = '0190a000-0000-7000-8000-0000000005a9';
const TODAY = '2025-11-20';

interface Due {
  id: string;
  endpoint: string;
  title: string;
  body: string;
  url: string;
}

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
  for (const u of [ALICE, BOB, SUP]) await createUser(db, u);
}, 60_000);

beforeEach(async () => {
  await asAdmin(db);
  await db.exec(`
    truncate public.push_subscription, public.coordinator_invite, public.coordinator_share, public.supervisor_invite, public.treatment_plan,
             public.case_report, public.assessment, public.verification, public.logbook_entry, public.reflection, public.report_snapshot,
             public.activity, public.encounter_procedure, public.finding, public.investigation, public.encounter, public.patient,
             public.rotation, public.supervisor, public.internship, public.facility cascade;
  `);
});

const subscribe = async (user: string, endpoint = `https://push.example.org/${user}`) => {
  await actAs(db, user);
  await rpc(db, 'save_push_subscription', [endpoint, 'p256dh-key', 'auth-key']);
};

const due = async (today = TODAY) => {
  await asAdmin(db);
  return rpc<Due[]>(db, 'push_due', [today]);
};

/** Alice's logbook (entries dated 2025-11-03, submitted to a supervisor). */
async function alice() {
  const d = deviceData();
  const supId = uuidv7();
  d.entries = d.entries.map((e) => ({ ...e, supervisorId: supId }));
  await actAs(db, ALICE);
  const res = await rpc<PushResult>(db, 'sync_push', [
    JSON.stringify([...changesFor(d).slice(0, 2), { table: 'supervisor', op: 'upsert', record: toWire({ id: supId, name: 'Dr Sup' }) }, ...changesFor(d).slice(2)]),
  ]);
  expect(res.rejected).toEqual([]);
  return { d, supId };
}

describe('push reminders', () => {
  it('reminds an intern of entries waiting more than a week, with counts and a link only', async () => {
    await alice();
    await subscribe(ALICE);
    const [n] = await due();
    expect(n).toMatchObject({ title: 'Logbook reminder', url: '/sign-off', endpoint: `https://push.example.org/${ALICE}` });
    expect(n!.body).toMatch(/^2 entries have waited more than a week for verification\./);
    expect(JSON.stringify(n)).not.toMatch(/OP-25|pulpitis|36|Dr Test/);
  });

  it('reminds a linked supervisor of items waiting for them', async () => {
    const { supId } = await alice();
    await actAs(db, ALICE);
    const { code } = await rpc<{ code: string }>(db, 'create_supervisor_invite', [supId]);
    await actAs(db, SUP);
    await rpc(db, 'accept_supervisor_invite', [code]);
    await subscribe(SUP);
    const forSup = (await due()).find((n) => n.endpoint.endsWith(SUP))!;
    expect(forSup).toMatchObject({ body: '2 items are waiting for your verification.', url: '/supervise' });
  });

  it('sends at most once a day, and removes subscriptions the browser dropped', async () => {
    await alice();
    await subscribe(ALICE);
    const [n] = await due();
    await asAdmin(db);
    await rpc(db, 'push_report', [[n!.id], [], [], TODAY]);
    expect(await due()).toEqual([]);
    expect(await due('2025-11-21')).toHaveLength(1);
    await rpc(db, 'push_report', [[], [n!.id], [], '2025-11-21']);
    expect((await db.query('select * from public.push_subscription')).rows).toEqual([]);
  });

  it('nothing to say, nothing sent; and only the sender can list or report', async () => {
    await subscribe(BOB);
    expect(await due()).toEqual([]);
    await actAs(db, BOB);
    await expect(rpc(db, 'push_due', [TODAY])).rejects.toThrow(/permission denied/);
    await expect(rpc(db, 'reminder_digest', [ALICE, TODAY])).rejects.toThrow(/permission denied/);
    await expect(rpc(db, 'push_report', [[], [], [], TODAY])).rejects.toThrow(/permission denied/);
    // Users see only their own subscriptions, and can remove them.
    await subscribe(ALICE);
    await actAs(db, BOB);
    expect((await db.query('select endpoint from public.push_subscription')).rows).toEqual([{ endpoint: `https://push.example.org/${BOB}` }]);
    await rpc(db, 'delete_push_subscription', [`https://push.example.org/${ALICE}`]);
    await asAdmin(db);
    expect((await db.query('select count(*)::int as n from public.push_subscription')).rows[0]).toEqual({ n: 2 });
  });
});

describe('sender', () => {
  const item = (id: string): DuePush => ({ id, endpoint: `https://push.example.org/${id}`, p256dh: 'k', auth: 'a', title: 'Logbook reminder', body: 'x', url: '/log' });

  it('sorts results into sent, gone (404/410) and failed', async () => {
    const outcome = await sendAll([item('a'), item('b'), item('c')], async (target) => {
      if (target.endpoint.endsWith('b')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      if (target.endpoint.endsWith('c')) throw Object.assign(new Error('busy'), { statusCode: 503 });
    });
    expect(outcome).toEqual({ sent: ['a'], gone: ['b'], failed: ['c'] });
  });

  it('only ever links inside the app', () => {
    expect(safeUrl('/logbook?status=returned')).toBe('/logbook?status=returned');
    expect(safeUrl('https://evil.example')).toBe('/');
    expect(safeUrl('//evil.example')).toBe('/');
    expect(safeUrl('javascript:alert(1)')).toBe('/');
  });
});
