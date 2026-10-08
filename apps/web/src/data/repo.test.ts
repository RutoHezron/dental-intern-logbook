import { checkVerificationChain, createVerification, type Encounter, type Level } from '@logbook/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  clearAll,
  deleteEncounter,
  exportBackup,
  importBackup,
  loadState,
  newId,
  RepoError,
  saveActivity,
  saveEncounter,
  saveRotations,
  setSupervisorPin,
  setupInternship,
  signOff,
} from './repo';

async function setup() {
  await clearAll();
  const id = await setupInternship({
    internName: 'Dr Test Intern',
    facilityName: 'Test Hospital',
    periodFrom: '2025-10-13',
    rotationOrder: ['OMF', 'PAED', 'PER', 'CONS', 'COMM'],
    supervisors: [{ name: 'Dr Sup', rotation: 'OMF' }],
  });
  const state = await loadState();
  return { id, ds: state.dataset! };
}

function visit(internshipId: string, over: Partial<Encounter> = {}): Encounter {
  return {
    id: newId(),
    internshipId,
    rotationId: null,
    date: '2025-11-03',
    patientId: null,
    visitType: 'new',
    findings: [{ term: 'Irreversible pulpitis', isDiagnosis: true }],
    investigations: [],
    procedures: [
      { id: newId(), procedureTypeId: 'exam_plan', sites: [], level: 3 },
      { id: newId(), procedureTypeId: 'extraction', sites: ['36', '37'], level: 4 },
    ],
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('repository', () => {
  beforeEach(async () => {
    await db.open();
  });

  it('sets up an internship with a 52-week rotation calendar', async () => {
    const { ds } = await setup();
    expect(ds.rotations.map((r) => r.rotation)).toEqual(['OMF', 'PAED', 'PER', 'CONS', 'COMM']);
    expect(ds.internship.periodTo).toBe('2026-10-11');
    expect(ds.supervisors).toHaveLength(1);
  });

  it('saves a visit once and derives the logbook entries, assigning the rotation by date', async () => {
    const { id, ds } = await setup();
    const res = await saveEncounter(visit(id), { ref: ' op-25-12345 ', birthYear: 1990 });
    expect(res.created).toBe(3); // OMF 1 + OMF 2 ×2 teeth
    const entries = await db.entries.toArray();
    expect(entries.map((e) => e.requirementCode).sort()).toEqual(['OMF 1', 'OMF 2', 'OMF 2']);
    expect(entries.every((e) => e.status === 'submitted' && e.patientRef === 'OP-25-12345')).toBe(true);
    const enc = (await db.encounters.toArray())[0]!;
    expect(enc.rotationId).toBe(ds.rotations[0]!.id);
    expect(await db.outbox.count()).toBeGreaterThan(0);
  });

  it('stores only the pseudonymous patient fields', async () => {
    const { id } = await setup();
    await saveEncounter(visit(id), { ref: 'OP-25-1', birthYear: 1990, sex: 'F' });
    const patient = (await db.patients.toArray())[0]!;
    expect(Object.keys(patient).sort()).toEqual(['birthYear', 'createdAt', 'id', 'ref', 'sex', 'systemicCondition'].sort());
  });

  it('reuses a returning patient by number', async () => {
    const { id } = await setup();
    await saveEncounter(visit(id), { ref: 'OP-25-7' });
    await saveEncounter(visit(id, { date: '2025-11-10', visitType: 'review' }), { ref: 'op-25-7' });
    expect(await db.patients.count()).toBe(1);
  });

  it('updates entries in place when a visit is edited, and withdraws ones that no longer apply', async () => {
    const { id } = await setup();
    const v = visit(id);
    await saveEncounter(v, { ref: 'OP-25-1' });
    const before = await db.entries.toArray();
    const edited: Encounter = { ...v, procedures: [{ ...v.procedures[1]!, sites: ['36'], level: 5 as Level }] };
    const res = await saveEncounter(edited, { ref: 'OP-25-1' });
    expect(res.withdrawn).toBe(2); // OMF 1 (exam removed) and the second tooth
    const live = (await db.entries.toArray()).filter((e) => e.status !== 'withdrawn');
    expect(live).toHaveLength(1);
    expect(live[0]!.levelClaimed).toBe(5);
    expect(before.map((e) => e.id)).toContain(live[0]!.id);
  });

  it('refuses to change or delete a visit with verified entries', async () => {
    const { id } = await setup();
    const v = visit(id);
    await saveEncounter(v, { ref: 'OP-25-1' });
    const entry = (await db.entries.toArray())[0]!;
    const ver = createVerification(entry, { verifierId: 's', decision: 'verified', method: 'pin' }, null, new Date().toISOString(), newId());
    await db.verifications.put(ver);
    await db.entries.put({ ...entry, status: 'verified' });
    await expect(saveEncounter({ ...v, date: '2025-11-04' }, { ref: 'OP-25-1' })).rejects.toBeInstanceOf(RepoError);
    await expect(deleteEncounter(v.id)).rejects.toThrow(/verified/);
  });

  it('deletes an unverified visit by soft-deleting it and withdrawing its entries', async () => {
    const { id } = await setup();
    const v = visit(id);
    await saveEncounter(v, { ref: 'OP-25-1' });
    await deleteEncounter(v.id);
    expect((await db.encounters.get(v.id))?.deletedAt).toBeTruthy();
    expect((await db.entries.toArray()).every((e) => e.status === 'withdrawn')).toBe(true);
  });

  it('logs activities without a patient', async () => {
    const { id } = await setup();
    const res = await saveActivity({ id: newId(), internshipId: id, rotationId: null, date: '2025-11-05', activityTypeId: 'postmortem', level: 1, createdAt: '', updatedAt: '' });
    expect(res.derivation.entries[0]!.requirementCode).toBe('OMF 19');
  });

  it('moves records to the right rotation when the calendar changes', async () => {
    const { id, ds } = await setup();
    await saveEncounter(visit(id, { date: '2025-12-30' }), { ref: 'OP-25-1' }); // first day of PAED
    const omfExtended = ds.rotations.map((r) => (r.rotation === 'OMF' ? { ...r, extendedByDays: 7 } : r.rotation === 'PAED' ? { ...r, startsOn: '2026-01-05' } : r));
    const { moved } = await saveRotations(id, omfExtended);
    expect(moved).toBe(1);
    expect((await db.encounters.toArray())[0]!.rotationId).toBe(ds.rotations[0]!.id);
  });

  it('round-trips a full backup', async () => {
    const { id } = await setup();
    await saveEncounter(visit(id), { ref: 'OP-25-1' });
    const json = await exportBackup();
    await clearAll();
    expect(await db.encounters.count()).toBe(0);
    await importBackup(json);
    expect(await db.encounters.count()).toBe(1);
    expect(await db.entries.count()).toBe(3);
    await expect(importBackup('{"format":"other"}')).rejects.toThrow(/not a logbook backup/);
  });

  it('lets the supervisor sign on the phone with their PIN, chaining every decision', async () => {
    const { id } = await setup();
    const supervisorId = (await db.supervisors.toArray())[0]!.id;
    await saveEncounter(visit(id, { supervisorId }), { ref: 'OP-25-1' });
    const [a, b, c] = await db.entries.toArray();
    await expect(signOff(supervisorId, '4071', [{ entryId: a!.id, decision: 'verified' }])).rejects.toThrow(/not correct/);
    await setSupervisorPin(supervisorId, '4071');
    expect(JSON.stringify(await db.supervisors.get(supervisorId))).not.toContain('"4071"');
    await expect(setSupervisorPin(supervisorId, '5555')).rejects.toThrow(/already has a PIN/);
    await expect(signOff(supervisorId, '4071', [{ entryId: a!.id, decision: 'returned' }])).rejects.toThrow(/what needs fixing/);

    const res = await signOff(supervisorId, '4071', [
      { entryId: a!.id, decision: 'verified' },
      { entryId: b!.id, decision: 'verified', levelObserved: 3 },
      { entryId: c!.id, decision: 'returned', comment: 'Check the tooth number' },
    ]);
    expect(res).toEqual({ verified: 2, returned: 1 });
    const entries = new Map((await db.entries.toArray()).map((e) => [e.id, e]));
    expect([entries.get(a!.id)!.status, entries.get(b!.id)!.status, entries.get(c!.id)!.status]).toEqual(['verified', 'verified', 'returned']);
    const vs = await db.verifications.toArray();
    expect(vs.every((v) => v.method === 'pin' && v.verifierId === supervisorId)).toBe(true);
    expect(checkVerificationChain(vs, entries)).toEqual([]);
    // Signing again is refused: those entries are no longer awaiting verification.
    await expect(signOff(supervisorId, '4071', [{ entryId: a!.id, decision: 'verified' }])).rejects.toThrow(/changed while you were reviewing/);
    expect((await db.outbox.toArray()).filter((o) => o.table === 'verifications')).toHaveLength(3);
  });

  it('refuses to sign entries submitted to a different supervisor', async () => {
    const { id } = await setup();
    const supervisorId = (await db.supervisors.toArray())[0]!.id;
    await saveEncounter(visit(id, { supervisorId: null }), { ref: 'OP-25-1' });
    await setSupervisorPin(supervisorId, '4071');
    const entry = (await db.entries.toArray())[0]!;
    await expect(signOff(supervisorId, '4071', [{ entryId: entry.id, decision: 'verified' }])).rejects.toThrow(/different supervisor/);
  });
});
