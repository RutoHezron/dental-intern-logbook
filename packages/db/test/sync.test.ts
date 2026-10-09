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
    truncate public.case_report, public.assessment, public.verification, public.logbook_entry, public.reflection, public.report_snapshot,
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
      JSON.stringify([{ table: 'audit_log', op: 'upsert', record: { id: uuidv7() } }, { table: 'profile', op: 'upsert', record: { id: ALICE } }]),
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

  it('a device cannot mark its own entry verified: the status it sends is ignored', async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    const forged = d.entries.map((e) => ({ table: 'logbook_entry', op: 'upsert' as const, record: toWire({ ...e, status: 'verified' }) }));
    const res = await rpc<PushResult>(db, 'sync_push', [JSON.stringify([...changesFor(d).filter((c) => c.table !== 'logbook_entry'), ...forged])]);
    expect(res.rejected).toEqual([]);
    const statuses = await db.query<{ status: string }>('select status from public.logbook_entry');
    expect(statuses.rows.map((r) => r.status)).toEqual(['submitted', 'submitted']);
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

describe("supervisor sign-off on the intern's phone", () => {
  const signOff = (entryId: string, decision: 'verified' | 'returned', method = 'pin', extra: Record<string, unknown> = {}) => ({
    table: 'verification',
    op: 'upsert' as const,
    record: {
      id: uuidv7(),
      entry_id: entryId,
      verifier_id: uuidv7(),
      decision,
      level_observed: decision === 'verified' ? 4 : null,
      comment: decision === 'returned' ? 'Please confirm the tooth number' : null,
      method,
      signed_at: '2025-11-03T16:00:00.000Z',
      prev_hash: null,
      hash: 'b'.repeat(64),
      ...extra,
    },
  });

  it('a PIN sign-off pushed from the phone verifies the entry', async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    const entry = d.entries[1]!;
    // The phone pushes the entry (already marked verified locally) followed by the verification.
    const res = await rpc<PushResult>(db, 'sync_push', [
      JSON.stringify([...changesFor(d).filter((c) => c.record.id !== entry.id), { table: 'logbook_entry', op: 'upsert', record: toWire({ ...entry, status: 'verified' }) }, signOff(entry.id, 'verified')]),
    ]);
    expect(res.rejected).toEqual([]);
    const pull = await rpc<PullResult>(db, 'sync_pull', [0]);
    const pulled = pull.changes.logbook_entry!.map((r: Record<string, unknown>) => fromWire<LogbookEntry>(r));
    expect(pulled.find((e) => e.id === entry.id)!.status).toBe('verified');
    expect(pull.changes.verification).toHaveLength(1);
  });

  it('a returned entry can be corrected and resubmitted from the phone', async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    const entry = d.entries[1]!;
    await rpc(db, 'sync_push', [JSON.stringify([...changesFor(d), signOff(entry.id, 'returned')])]);
    const status = async () => (await db.query<{ status: string }>('select status from public.logbook_entry where id = $1', [entry.id])).rows[0]!.status;
    expect(await status()).toBe('returned');
    await rpc(db, 'sync_push', [JSON.stringify([{ table: 'logbook_entry', op: 'upsert', record: toWire({ ...entry, site: '46', status: 'submitted' }) }])]);
    expect(await status()).toBe('submitted');
  });

  it('re-sending the same verification is harmless', async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    const v = signOff(d.entries[0]!.id, 'verified');
    await rpc(db, 'sync_push', [JSON.stringify([...changesFor(d), v])]);
    const again = await rpc<PushResult>(db, 'sync_push', [JSON.stringify([v])]);
    expect(again.rejected).toEqual([]);
    expect((await db.query('select * from public.verification')).rows).toHaveLength(1);
  });

  it("only PIN sign-offs, only for the intern's own entries, and never deletions", async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    await rpc(db, 'sync_push', [JSON.stringify(changesFor(d))]);
    const passkey = await rpc<PushResult>(db, 'sync_push', [JSON.stringify([signOff(d.entries[0]!.id, 'verified', 'passkey')])]);
    expect(passkey.rejected[0]!.reason).toMatch(/row-level security/);
    await actAs(db, BOB);
    const other = await rpc<PushResult>(db, 'sync_push', [JSON.stringify([signOff(d.entries[0]!.id, 'verified')])]);
    expect(other.rejected).toHaveLength(1);
    await actAs(db, ALICE);
    const v = signOff(d.entries[0]!.id, 'verified');
    await rpc(db, 'sync_push', [JSON.stringify([v])]);
    const del = await rpc<PushResult>(db, 'sync_push', [JSON.stringify([{ ...v, op: 'delete' }])]);
    expect(del.rejected[0]!.reason).toMatch(/cannot be deleted/);
  });
});

describe('assessment forms', () => {
  const form = (d: ReturnType<typeof deviceData>, over: Record<string, unknown> = {}) => ({
    table: 'assessment',
    op: 'upsert' as const,
    record: {
      id: uuidv7(),
      internship_id: d.internship.id,
      rotation_id: d.rotations[0]!.id,
      kind: 'end_of_rotation',
      sequence: 1,
      form_version: 'kmpdc-dental-3rd-2024',
      responses: {},
      grades: { k1: 3, s4: 1 },
      grade_remarks: { s4: 'Needs more supervised cases' },
      overall_grade: 2,
      recommendation: 'Satisfactory',
      progress_snapshot: { asOf: '2025-12-28', codes: [{ code: 'OMF 2', verified: 20, min: 20, status: 'met' }] },
      ...over,
    },
  });

  it('round-trips a form with its grades and evidence', async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    const res = await rpc<PushResult>(db, 'sync_push', [JSON.stringify([...changesFor(d), form(d)])]);
    expect(res.rejected).toEqual([]);
    const pull = await rpc<PullResult>(db, 'sync_pull', [0]);
    const row = pull.changes.assessment![0]!;
    expect(row.grades).toEqual({ k1: 3, s4: 1 });
    expect(row.grade_remarks).toEqual({ s4: 'Needs more supervised cases' });
    expect((row.progress_snapshot as { codes: unknown[] }).codes).toHaveLength(1);
  });

  it('keeps one live form per rotation, kind and month, and checks the extension period', async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    await rpc(db, 'sync_push', [JSON.stringify([...changesFor(d), form(d)])]);
    const dup = await rpc<PushResult>(db, 'sync_push', [JSON.stringify([form(d)])]);
    expect(dup.rejected[0]!.reason).toMatch(/duplicate key/);
    const extend = await rpc<PushResult>(db, 'sync_push', [JSON.stringify([form(d, { kind: 'overall_rotation', outcome: 'extend', grades: {}, grade_remarks: {} })])]);
    expect(extend.rejected[0]!.reason).toMatch(/check constraint/);
  });

  it('keeps forms private to the intern', async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    await rpc(db, 'sync_push', [JSON.stringify([...changesFor(d), form(d)])]);
    await actAs(db, BOB);
    expect((await db.query('select * from public.assessment')).rows).toHaveLength(0);
  });
});

describe('internship-level forms (5.8, 5.9)', () => {
  const internshipForm = (d: ReturnType<typeof deviceData>, over: Record<string, unknown> = {}) => ({
    table: 'assessment',
    op: 'upsert' as const,
    record: {
      id: uuidv7(),
      internship_id: d.internship.id,
      rotation_id: null,
      kind: 'end_of_internship',
      sequence: 1,
      form_version: 'kmpdc-dental-3rd-2024',
      responses: { e1: 'Recommended for registration' },
      grades: {},
      grade_remarks: {},
      outcome: 'completed',
      ...over,
    },
  });

  it('stores a form without a rotation, one per internship', async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    const res = await rpc<PushResult>(db, 'sync_push', [JSON.stringify([...changesFor(d), internshipForm(d)])]);
    expect(res.rejected).toEqual([]);
    const dup = await rpc<PushResult>(db, 'sync_push', [JSON.stringify([internshipForm(d)])]);
    expect(dup.rejected[0]!.reason).toMatch(/duplicate key/);
  });

  it('requires a rotation for rotation forms and none for internship forms', async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    await rpc(db, 'sync_push', [JSON.stringify(changesFor(d))]);
    const bad = await rpc<PushResult>(db, 'sync_push', [
      JSON.stringify([internshipForm(d, { kind: 'monthly' }), internshipForm(d, { kind: 'completion_verification', rotation_id: d.rotations[0]!.id })]),
    ]);
    expect(bad.rejected).toHaveLength(2);
    expect(bad.rejected.every((r) => /assessment_rotation_scope/.test(r.reason))).toBe(true);
  });
});

describe('case reports', () => {
  const cr = (d: ReturnType<typeof deviceData>, over: Record<string, unknown> = {}) => ({
    table: 'case_report',
    op: 'upsert' as const,
    record: {
      id: uuidv7(),
      internship_id: d.internship.id,
      rotation_id: d.rotations[0]!.id,
      date: '2025-11-10',
      title: 'Pericoronitis managed with surgical extraction',
      encounter_ids: [d.encounter.id],
      sections: { dx: 'Pericoronitis 38', mx: 'Surgical extraction', disc: 'Learning points' },
      status: 'submitted',
      ...over,
    },
  });
  const signOff = (target: Record<string, unknown>, decision = 'verified') => ({
    table: 'verification',
    op: 'upsert' as const,
    record: { id: uuidv7(), ...target, verifier_id: uuidv7(), decision, comment: decision === 'returned' ? 'Expand the discussion' : null, method: 'pin', signed_at: '2025-11-12T16:00:00.000Z', prev_hash: null, hash: 'c'.repeat(64) },
  });

  it('a PIN sign-off verifies a case report, after which its content is locked', async () => {
    const d = deviceData();
    const report = cr(d);
    await actAs(db, ALICE);
    const res = await rpc<PushResult>(db, 'sync_push', [JSON.stringify([...changesFor(d), report, signOff({ case_report_id: report.record.id })])]);
    expect(res.rejected).toEqual([]);
    expect((await db.query<{ status: string }>('select status from public.case_report')).rows[0]!.status).toBe('verified');
    const edit = await rpc<PushResult>(db, 'sync_push', [JSON.stringify([{ ...report, record: { ...report.record, status: 'verified', sections: { dx: 'changed' } } }])]);
    expect(edit.rejected[0]!.reason).toMatch(/Verified case reports cannot be changed/);
    const pull = await rpc<PullResult>(db, 'sync_pull', [0]);
    expect(pull.changes.case_report).toHaveLength(1);
    expect((pull.changes.case_report![0]!.sections as Record<string, string>).dx).toBe('Pericoronitis 38');
  });

  it('a device cannot mark its own case report verified', async () => {
    const d = deviceData();
    await actAs(db, ALICE);
    await rpc(db, 'sync_push', [JSON.stringify([...changesFor(d), cr(d, { status: 'verified' })])]);
    expect((await db.query<{ status: string }>('select status from public.case_report')).rows[0]!.status).toBe('submitted');
  });

  it('a verification has exactly one target, owned by the intern', async () => {
    const d = deviceData();
    const report = cr(d);
    await actAs(db, ALICE);
    await rpc(db, 'sync_push', [JSON.stringify([...changesFor(d), report])]);
    const both = await rpc<PushResult>(db, 'sync_push', [JSON.stringify([signOff({ case_report_id: report.record.id, entry_id: d.entries[0]!.id })])]);
    expect(both.rejected[0]!.reason).toMatch(/verification_one_target/);
    await actAs(db, BOB);
    const other = await rpc<PushResult>(db, 'sync_push', [JSON.stringify([signOff({ case_report_id: report.record.id })])]);
    expect(other.rejected).toHaveLength(1);
  });

  it('a returned case report can be revised and resubmitted', async () => {
    const d = deviceData();
    const report = cr(d);
    await actAs(db, ALICE);
    await rpc(db, 'sync_push', [JSON.stringify([...changesFor(d), report, signOff({ case_report_id: report.record.id }, 'returned')])]);
    const status = async () => (await db.query<{ status: string }>('select status from public.case_report')).rows[0]!.status;
    expect(await status()).toBe('returned');
    await rpc(db, 'sync_push', [JSON.stringify([{ ...report, record: { ...report.record, status: 'submitted', sections: { dx: 'x', mx: 'y', disc: 'Expanded' } } }])]);
    expect(await status()).toBe('submitted');
  });
});
