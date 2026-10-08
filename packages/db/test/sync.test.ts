import type { PGlite } from '@electric-sql/pglite';
import {
  buildRotationCalendar,
  DEFAULT_COUNTING_RULES,
  deriveEncounter,
  fromWire,
  KMPDC_DENTAL_3,
  reconcileEntries,
  rotationForDate,
  toWire,
  uuidv7,
  type Encounter,
  type Internship,
  type LogbookEntry,
  type Patient,
  type PullResult,
  type PushChange,
  type PushResult,
  type Rotation,
} from '@logbook/core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { actAs, asAdmin, createDb, createUser, rpc } from './harness';

const ALICE = '0190a000-0000-7000-8000-00000000a11c';
const BOB = '0190a000-0000-7000-8000-000000000b0b';

interface DeviceData {
  facility: { id: string; name: string };
  internship: Internship;
  rotations: Rotation[];
  patient: Patient;
  encounter: Encounter;
  entries: LogbookEntry[];
}

function deviceData(): DeviceData {
  const facility = { id: uuidv7(), name: 'Example County Referral Hospital' };
  const internshipId = uuidv7();
  const rotations = buildRotationCalendar(KMPDC_DENTAL_3, internshipId, '2025-10-13', ['OMF', 'PAED', 'PER', 'CONS', 'COMM'], () => uuidv7());
  const internship: Internship = {
    id: internshipId,
    internName: 'Dr Test Intern',
    facilityId: facility.id,
    requirementSetId: KMPDC_DENTAL_3.id,
    periodFrom: '2025-10-13',
    periodTo: '2026-10-11',
  };
  const patient: Patient = { id: uuidv7(), ref: 'OP-25-10001', birthYear: 1990, sex: 'F', systemicCondition: false, createdAt: '2025-11-03T09:00:00.000Z' };
  const rot = rotationForDate(rotations, '2025-11-03')!;
  const encounter: Encounter = {
    id: uuidv7(),
    internshipId,
    rotationId: rot.id,
    date: '2025-11-03',
    time: '09:30',
    patientId: patient.id,
    visitType: 'new',
    setting: 'opd',
    supervisorId: null,
    findings: [{ term: 'Irreversible pulpitis', site: '36', isDiagnosis: true, certainty: 'confirmed' }],
    investigations: [{ kind: 'IOPA', site: '36' }],
    procedures: [
      { id: uuidv7(), procedureTypeId: 'exam_plan', sites: [], level: 3 },
      { id: uuidv7(), procedureTypeId: 'extraction', sites: ['36'], level: 4 },
    ],
    createdAt: '2025-11-03T09:40:00.000Z',
    updatedAt: '2025-11-03T09:40:00.000Z',
    deletedAt: null,
  };
  const d = deriveEncounter(encounter, { set: KMPDC_DENTAL_3, rules: DEFAULT_COUNTING_RULES, rotation: rot.rotation, patient });
  const entries = reconcileEntries(
    d.entries,
    [],
    { internshipId, rotationId: rot.id, performedOn: encounter.date, encounterId: encounter.id, patientRef: patient.ref, supervisorId: null, status: 'submitted' },
    encounter.createdAt,
    () => uuidv7(),
  ).create;
  return { facility, internship, rotations, patient, encounter, entries };
}

function changesFor(d: DeviceData): PushChange[] {
  return [
    { table: 'facility', op: 'upsert', record: toWire(d.facility) },
    { table: 'internship', op: 'upsert', record: toWire(d.internship) },
    ...d.rotations.map((r) => ({ table: 'rotation', op: 'upsert' as const, record: toWire(r) })),
    { table: 'patient', op: 'upsert', record: toWire(d.patient) },
    { table: 'encounter', op: 'upsert', record: toWire(d.encounter) },
    ...d.entries.map((e) => ({ table: 'logbook_entry', op: 'upsert' as const, record: toWire(e) })),
  ];
}

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
  await createUser(db, ALICE);
  await createUser(db, BOB);
}, 60_000);

beforeEach(async () => {
  await asAdmin(db);
  await db.exec(`
    truncate public.verification, public.logbook_entry, public.reflection, public.report_snapshot,
             public.activity, public.encounter_procedure, public.finding, public.investigation,
             public.encounter, public.patient, public.rotation, public.supervisor, public.internship,
             public.facility cascade;
  `);
});

describe('schema', () => {
  it('stores no patient names, contacts or ID numbers in personal mode', async () => {
    const res = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'patient' order by column_name`,
    );
    expect(res.rows.map((r) => r.column_name)).toEqual(
      ['alerts', 'birth_year', 'created_at', 'deleted_at', 'id', 'owner_id', 'ref', 'server_received_at', 'server_seq', 'sex', 'systemic_condition'].sort(),
    );
  });

  it('creates a profile when a user signs up', async () => {
    const res = await db.query('select id from public.profile where id = $1', [ALICE]);
    expect(res.rows).toHaveLength(1);
  });
});

describe('sync push and pull', () => {
  it('rejects anonymous callers', async () => {
    await actAs(db, null);
    await expect(rpc(db, 'sync_push', [JSON.stringify([])])).rejects.toThrow();
  });

  it('round-trips a device dataset exactly', async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    const push = await rpc<PushResult>(db, 'sync_push', [JSON.stringify(changesFor(d))]);
    expect(push.rejected).toEqual([]);
    expect(push.accepted).toHaveLength(changesFor(d).length);

    const pull = await rpc<PullResult>(db, 'sync_pull', [0]);
    expect(pull.cursor).toBeGreaterThan(0);
    const enc = fromWire<Encounter>(pull.changes.encounter![0]!);
    expect(enc).toMatchObject({
      id: d.encounter.id,
      date: '2025-11-03',
      time: '09:30',
      patientId: d.patient.id,
      rotationId: d.encounter.rotationId,
      visitType: 'new',
      findings: d.encounter.findings,
      investigations: d.encounter.investigations,
      procedures: d.encounter.procedures,
    });
    const entries = pull.changes.logbook_entry!.map((r: Record<string, unknown>) => fromWire<LogbookEntry>(r));
    expect(entries.map((e) => e.requirementCode).sort()).toEqual(['OMF 1', 'OMF 2']);
    expect(entries.every((e) => e.status === 'submitted')).toBe(true);
    const patient = fromWire<Patient>(pull.changes.patient![0]!);
    expect(patient).toMatchObject({ ref: 'OP-25-10001', birthYear: 1990, sex: 'F' });
  });

  it('returns only newer changes after the cursor', async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    await rpc(db, 'sync_push', [JSON.stringify(changesFor(d))]);
    const first = await rpc<PullResult>(db, 'sync_pull', [0]);
    const empty = await rpc<PullResult>(db, 'sync_pull', [first.cursor]);
    expect(Object.values(empty.changes).flat()).toHaveLength(0);

    const edited = { ...d.encounter, notes: 'Healing well at review', updatedAt: '2025-11-04T10:00:00.000Z' };
    await rpc(db, 'sync_push', [JSON.stringify([{ table: 'encounter', op: 'upsert', record: toWire(edited) }])]);
    const next = await rpc<PullResult>(db, 'sync_pull', [first.cursor]);
    expect(next.changes.encounter).toHaveLength(1);
    expect(fromWire<Encounter>(next.changes.encounter![0]!).notes).toBe('Healing well at review');
    expect(next.changes.logbook_entry).toHaveLength(0);
  });

  it('replaces an encounter\'s procedures when it is edited', async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    await rpc(db, 'sync_push', [JSON.stringify(changesFor(d))]);
    const edited = { ...d.encounter, procedures: [d.encounter.procedures[1]!] };
    await rpc(db, 'sync_push', [JSON.stringify([{ table: 'encounter', op: 'upsert', record: toWire(edited) }])]);
    const res = await db.query('select procedure_type_id from public.encounter_procedure where encounter_id = $1', [d.encounter.id]);
    expect(res.rows).toEqual([{ procedure_type_id: 'extraction' }]);
  });

  it('turns a delete into a soft-delete tombstone', async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    await rpc(db, 'sync_push', [JSON.stringify(changesFor(d))]);
    const first = await rpc<PullResult>(db, 'sync_pull', [0]);
    await rpc(db, 'sync_push', [JSON.stringify([{ table: 'encounter', op: 'delete', record: toWire(d.encounter) }])]);
    const next = await rpc<PullResult>(db, 'sync_pull', [first.cursor]);
    expect(next.changes.encounter![0]!.deleted_at).toBeTruthy();
    await asAdmin(db);
    expect((await db.query('select count(*)::int as n from public.encounter')).rows[0]).toEqual({ n: 1 });
  });

  it('applies each change independently: one bad record does not block the batch', async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    const bad: PushChange = { table: 'encounter', op: 'upsert', record: { ...toWire(d.encounter), visit_type: 'not-a-visit-type' } };
    const res = await rpc<PushResult>(db, 'sync_push', [JSON.stringify([...changesFor(d).slice(0, 7), bad])]);
    expect(res.accepted).toHaveLength(7);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0]!.reason).toMatch(/check constraint/);
  });

  it('refuses tables a device must not write', async () => {
    await actAs(db, ALICE);
    const res = await rpc<PushResult>(db, 'sync_push', [
      JSON.stringify([{ table: 'verification', op: 'upsert', record: { id: uuidv7() } }, { table: 'audit_log', op: 'upsert', record: { id: 1 } }]),
    ]);
    expect(res.accepted).toHaveLength(0);
    expect(res.rejected.map((r) => r.reason)).toEqual([expect.stringMatching(/cannot be written/), expect.stringMatching(/cannot be written/)]);
  });
});

describe('row-level security', () => {
  it('keeps each intern\'s records private', async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    await rpc(db, 'sync_push', [JSON.stringify(changesFor(d))]);
    await actAs(db, BOB);
    const pull = await rpc<PullResult>(db, 'sync_pull', [0]);
    expect(Object.values(pull.changes).flat()).toHaveLength(0);
    expect((await db.query('select * from public.patient')).rows).toHaveLength(0);
    expect((await db.query('select * from public.encounter_procedure')).rows).toHaveLength(0);
  });

  it('stops one intern overwriting another\'s record by guessing its id', async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    await rpc(db, 'sync_push', [JSON.stringify(changesFor(d))]);
    await actAs(db, BOB);
    const res = await rpc<PushResult>(db, 'sync_push', [JSON.stringify([{ table: 'patient', op: 'upsert', record: { ...toWire(d.patient), ref: 'HIJACKED' } }])]);
    expect(res.rejected).toHaveLength(1);
    await asAdmin(db);
    expect((await db.query('select ref from public.patient')).rows).toEqual([{ ref: 'OP-25-10001' }]);
  });

  it('pins ownership to the caller, ignoring any owner sent by the device', async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    await rpc(db, 'sync_push', [JSON.stringify([{ table: 'facility', op: 'upsert', record: { ...toWire(d.facility), owner_id: BOB } }])]);
    await asAdmin(db);
    expect((await db.query('select owner_id from public.facility')).rows).toEqual([{ owner_id: ALICE }]);
  });
});

describe('logbook evidence integrity', () => {
  async function pushAndVerifyFirstEntry() {
    const d = deviceData();
    await actAs(db, ALICE);
    await rpc(db, 'sync_push', [JSON.stringify(changesFor(d))]);
    const entry = d.entries[0]!;
    // Simulate the V1 supervisor verification path, which runs with app.verifying on.
    await asAdmin(db);
    await db.query(`select set_config('app.verifying', 'on', false)`);
    await db.query(`update public.logbook_entry set status = 'verified' where id = $1`, [entry.id]);
    await db.query(
      `insert into public.verification (id, owner_id, entry_id, verifier_id, decision, method, signed_at, hash) values ($1, $2, $3, $4, 'verified', 'pin', now(), $5)`,
      [uuidv7(), ALICE, entry.id, BOB, 'a'.repeat(64)],
    );
    await db.query(`select set_config('app.verifying', '', false)`);
    return { d, entry };
  }

  it('a device cannot mark its own entry verified', async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    const forged = d.entries.map((e) => ({ table: 'logbook_entry', op: 'upsert' as const, record: toWire({ ...e, status: 'verified' }) }));
    const res = await rpc<PushResult>(db, 'sync_push', [JSON.stringify([...changesFor(d).filter((c) => c.table !== 'logbook_entry'), ...forged])]);
    expect(res.rejected.map((r) => r.reason)).toEqual([expect.stringMatching(/supervisor verification/), expect.stringMatching(/supervisor verification/)]);
  });

  it('a verified entry cannot be edited, but the rest of the batch still applies', async () => {
    const { d, entry } = await pushAndVerifyFirstEntry();
    await actAs(db, ALICE);
    const res = await rpc<PushResult>(db, 'sync_push', [
      JSON.stringify([
        { table: 'logbook_entry', op: 'upsert', record: toWire({ ...entry, status: 'verified', levelClaimed: 5 }) },
        { table: 'encounter', op: 'upsert', record: toWire({ ...d.encounter, notes: 'added later' }) },
      ]),
    ]);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0]!.reason).toMatch(/cannot be changed/);
    expect(res.accepted).toEqual([{ table: 'encounter', id: d.encounter.id }]);
  });

  it('verifications are append-only, even for administrators', async () => {
    await pushAndVerifyFirstEntry();
    await asAdmin(db);
    await expect(db.query(`update public.verification set level_observed = 5`)).rejects.toThrow(/append-only/);
    await expect(db.query(`delete from public.verification`)).rejects.toThrow(/append-only/);
  });

  it('the intern can read verifications of their own entries only', async () => {
    await pushAndVerifyFirstEntry();
    await actAs(db, ALICE);
    expect((await db.query('select * from public.verification')).rows).toHaveLength(1);
    await actAs(db, BOB);
    expect((await db.query('select * from public.verification')).rows).toHaveLength(0);
  });

  it('writes an audit trail of actions without clinical content', async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    await rpc(db, 'sync_push', [JSON.stringify(changesFor(d))]);
    const res = await db.query<{ action: string; table_name: string }>(
      `select action, table_name from public.audit_log where actor_id = $1 and row_id = $2`,
      [ALICE, d.encounter.id],
    );
    expect(res.rows).toEqual([{ action: 'insert', table_name: 'encounter' }]);
    const cols = await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'audit_log'`);
    expect(cols.rows.map((c: { column_name: string }) => c.column_name).sort()).toEqual(['action', 'actor_id', 'at', 'id', 'row_id', 'table_name']);
    await expect(db.query(`update public.audit_log set action = 'x'`)).rejects.toThrow();
  });
});
