import {
  buildRotationCalendar,
  DEFAULT_COUNTING_RULES,
  deriveActivity,
  deriveEncounter,
  KMPDC_DENTAL_3,
  reconcileEntries,
  rotationForDate,
  type Activity,
  type Dataset,
  type Encounter,
  type EncounterProcedure,
  type Level,
  type Patient,
} from '../src';

/**
 * Tiny hand-built internship for precise assertions. Internship starts Monday
 * 2025-10-13; rotations OMF → PAED → PER → CONS → COMM (11/11/11/11/8 weeks).
 */

let n = 0;
export const id = (prefix = 'id') => `${prefix}-${++n}`;

export function emptyDataset(): Dataset {
  n = 0;
  const internship = {
    id: 'int-1',
    internName: 'Test Intern',
    facilityId: 'fac-1',
    requirementSetId: KMPDC_DENTAL_3.id,
    periodFrom: '2025-10-13',
    periodTo: '2026-10-11',
  };
  return {
    requirementSet: KMPDC_DENTAL_3,
    rules: { ...DEFAULT_COUNTING_RULES },
    internship,
    rotations: buildRotationCalendar(KMPDC_DENTAL_3, internship.id, internship.periodFrom, ['OMF', 'PAED', 'PER', 'CONS', 'COMM'], () => id('rot')),
    patients: [],
    supervisors: [{ id: 'sup-1', name: 'Dr Test Supervisor' }],
    encounters: [],
    activities: [],
    entries: [],
    verifications: [],
    reflections: [],
  };
}

export function addPatient(ds: Dataset, p: Partial<Patient> = {}): Patient {
  const patient: Patient = { id: id('pat'), ref: `OP-${n}`, birthYear: 1990, sex: 'F', createdAt: '2025-10-13T08:00:00Z', ...p };
  ds.patients.push(patient);
  return patient;
}

export function proc(procedureTypeId: string, level: Level, sites: string[] = [], extra: Partial<EncounterProcedure> = {}): EncounterProcedure {
  return { id: id('proc'), procedureTypeId, level, sites, ...extra };
}

/** Add an encounter and derive its logbook entries as the app would. */
export function addEncounter(
  ds: Dataset,
  date: string,
  procedures: EncounterProcedure[],
  opts: { patient?: Patient | null; diagnosis?: boolean; visitType?: Encounter['visitType']; setting?: Encounter['setting'] } = {},
): Encounter {
  const rot = rotationForDate(ds.rotations, date);
  const patient = opts.patient === undefined ? addPatient(ds) : opts.patient;
  const e: Encounter = {
    id: id('enc'),
    internshipId: ds.internship.id,
    rotationId: rot?.id ?? null,
    date,
    patientId: patient?.id ?? null,
    visitType: opts.visitType ?? 'new',
    setting: opts.setting ?? 'opd',
    supervisorId: 'sup-1',
    findings: opts.diagnosis === false ? [] : [{ term: 'Dental caries', isDiagnosis: true }],
    investigations: [],
    procedures,
    createdAt: `${date}T12:00:00Z`,
    updatedAt: `${date}T12:00:00Z`,
  };
  ds.encounters.push(e);
  const d = deriveEncounter(e, { set: ds.requirementSet, rules: ds.rules, rotation: rot?.rotation ?? null, patient });
  const rec = reconcileEntries(
    d.entries,
    [],
    { internshipId: ds.internship.id, rotationId: e.rotationId, performedOn: date, encounterId: e.id, patientRef: patient?.ref, supervisorId: 'sup-1', status: 'submitted' },
    e.createdAt,
    () => id('entry'),
  );
  ds.entries.push(...rec.create);
  return e;
}

export function addActivity(ds: Dataset, date: string, activityTypeId: string, level: Level, extra: Partial<Activity> = {}): Activity {
  const rot = rotationForDate(ds.rotations, date);
  const a: Activity = {
    id: id('act'),
    internshipId: ds.internship.id,
    rotationId: rot?.id ?? null,
    date,
    activityTypeId,
    level,
    supervisorId: 'sup-1',
    createdAt: `${date}T12:00:00Z`,
    updatedAt: `${date}T12:00:00Z`,
    ...extra,
  };
  ds.activities.push(a);
  const d = deriveActivity(a, { set: ds.requirementSet, rules: ds.rules, rotation: rot?.rotation ?? null });
  const rec = reconcileEntries(
    d.entries,
    [],
    { internshipId: ds.internship.id, rotationId: a.rotationId, performedOn: date, supervisorId: 'sup-1', status: 'submitted' },
    a.createdAt,
    () => id('entry'),
  );
  ds.entries.push(...rec.create);
  return a;
}
