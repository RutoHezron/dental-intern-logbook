/** Shared test data: one intern's device dataset and the push batch for it. */
import {
  buildRotationCalendar,
  DEFAULT_COUNTING_RULES,
  deriveEncounter,
  KMPDC_DENTAL_3,
  reconcileEntries,
  rotationForDate,
  toWire,
  uuidv7,
  type Encounter,
  type Internship,
  type LogbookEntry,
  type Patient,
  type PushChange,
  type Rotation,
} from '@logbook/core';

export const ALICE = '0190a000-0000-7000-8000-00000000a11c';
export const BOB = '0190a000-0000-7000-8000-000000000b0b';

export interface DeviceData {
  facility: { id: string; name: string };
  internship: Internship;
  rotations: Rotation[];
  patient: Patient;
  encounter: Encounter;
  entries: LogbookEntry[];
}

export function deviceData(): DeviceData {
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

export function changesFor(d: DeviceData): PushChange[] {
  return [
    { table: 'facility', op: 'upsert', record: toWire(d.facility) },
    { table: 'internship', op: 'upsert', record: toWire(d.internship) },
    ...d.rotations.map((r) => ({ table: 'rotation', op: 'upsert' as const, record: toWire(r) })),
    { table: 'patient', op: 'upsert', record: toWire(d.patient) },
    { table: 'encounter', op: 'upsert', record: toWire(d.encounter) },
    ...d.entries.map((e) => ({ table: 'logbook_entry', op: 'upsert' as const, record: toWire(e) })),
  ];
}

