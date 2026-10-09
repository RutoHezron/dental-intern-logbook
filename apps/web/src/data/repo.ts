import {
  buildRotationCalendar,
  checkPin,
  createCaseReportVerification,
  validateCaseReport,
  type CaseReport,
  validateAssessment,
  type Assessment,
  createVerification,
  hashPin,
  statusAfter,
  type Level,
  DEFAULT_COUNTING_RULES,
  deriveActivity,
  deriveEncounter,
  KMPDC_DENTAL_3,
  reconcileEntries,
  rotationCodeFor,
  rotationForDate,
  uuidv7,
  type Activity,
  type CountingRules,
  type Dataset,
  type Derivation,
  type Encounter,
  type Facility,
  type Internship,
  type LogbookEntry,
  type Patient,
  type Reflection,
  type ReportSnapshot,
  type Rotation,
  type RotationCode,
  type Supervisor,
} from '@logbook/core';
import { db, DEFAULT_PREFERENCES, getMeta, META, setMeta, type OutboxItem, type Preferences, type SyncTable } from './db';

/**
 * Repository: the only module that writes to the on-device store. Every
 * clinical write goes through the core rules (derive → reconcile) inside one
 * transaction, so the logbook can never drift from what was recorded.
 */

const nowISO = () => new Date().toISOString();
export const newId = () => uuidv7();

async function enqueue(table: SyncTable, recordId: string, op: OutboxItem['op'] = 'upsert') {
  await db.outbox.add({ table, recordId, op, createdAt: nowISO(), attempts: 0, status: 'pending' });
}

export class RepoError extends Error {}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export interface LoadedState {
  dataset: Dataset | null;
  facility: Facility | null;
  preferences: Preferences;
  demo: { asOf: string } | null;
  outboxPending: number;
  outboxErrors: number;
}

export async function loadState(): Promise<LoadedState> {
  const [internshipId, preferences, demo] = await Promise.all([
    getMeta<string | null>(META.activeInternship, null),
    getMeta<Preferences>(META.preferences, DEFAULT_PREFERENCES),
    getMeta<{ asOf: string } | null>(META.demo, null),
  ]);
  const [outboxPending, outboxErrors] = await Promise.all([
    db.outbox.where('status').equals('pending').count(),
    db.outbox.where('status').equals('error').count(),
  ]);
  const base = { preferences: { ...DEFAULT_PREFERENCES, ...preferences }, demo, outboxPending, outboxErrors };
  if (!internshipId) return { ...base, dataset: null, facility: null };
  const internship = await db.internships.get(internshipId);
  if (!internship) return { ...base, dataset: null, facility: null };

  const [rules, facility, rotations, patients, supervisors, encounters, activities, entries, verifications, reflections, caseReports] = await Promise.all([
    getMeta<CountingRules>(META.rules, DEFAULT_COUNTING_RULES),
    db.facilities.get(internship.facilityId),
    db.rotations.where('internshipId').equals(internshipId).toArray(),
    db.patients.toArray(),
    db.supervisors.toArray(),
    db.encounters.toArray(),
    db.activities.toArray(),
    db.entries.toArray(),
    db.verifications.toArray(),
    db.reflections.toArray(),
    db.caseReports.toArray(),
  ]);
  return {
    ...base,
    facility: facility ?? null,
    dataset: {
      requirementSet: KMPDC_DENTAL_3,
      rules: { ...DEFAULT_COUNTING_RULES, ...rules },
      internship,
      rotations: rotations.sort((a, b) => a.startsOn.localeCompare(b.startsOn)),
      patients,
      supervisors,
      encounters,
      activities,
      entries,
      verifications,
      reflections,
      caseReports: caseReports.filter((r) => !r.deletedAt),
    },
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export interface SetupInput {
  internName: string;
  email?: string;
  licenceNo?: string;
  facilityName: string;
  county?: string;
  periodFrom: string;
  rotationOrder: RotationCode[];
  supervisors: { name: string; rotation?: RotationCode; role?: string }[];
}

export async function setupInternship(input: SetupInput): Promise<string> {
  if (!input.internName.trim()) throw new RepoError('Enter your name.');
  if (!input.facilityName.trim()) throw new RepoError('Enter your internship training centre.');
  const facility: Facility = { id: newId(), name: input.facilityName.trim(), county: input.county?.trim() || undefined };
  const internshipId = newId();
  const rotations = buildRotationCalendar(KMPDC_DENTAL_3, internshipId, input.periodFrom, input.rotationOrder, newId).map((r) => ({
    ...r,
    facilityId: facility.id,
    department: KMPDC_DENTAL_3.rotations.find((x) => x.code === r.rotation)?.name,
  }));
  const periodTo = rotations.at(-1)!.endsOn;
  const internship: Internship = {
    id: internshipId,
    internName: input.internName.trim(),
    email: input.email?.trim() || undefined,
    licenceNo: input.licenceNo?.trim() || undefined,
    facilityId: facility.id,
    institution: facility.name,
    requirementSetId: KMPDC_DENTAL_3.id,
    periodFrom: input.periodFrom,
    periodTo,
  };
  const supervisors: Supervisor[] = input.supervisors.filter((s) => s.name.trim()).map((s) => ({ id: newId(), name: s.name.trim(), rotation: s.rotation, role: s.role }));
  await db.transaction('rw', db.tables, async () => {
    await db.facilities.put(facility);
    await db.internships.put(internship);
    await db.rotations.bulkPut(rotations);
    await db.supervisors.bulkPut(supervisors);
    await setMeta(META.activeInternship, internshipId);
    await setMeta(META.rules, DEFAULT_COUNTING_RULES);
    await setMeta(META.demo, null);
    await enqueue('facilities', facility.id);
    await enqueue('internships', internshipId);
    for (const r of rotations) await enqueue('rotations', r.id);
    for (const s of supervisors) await enqueue('supervisors', s.id);
  });
  return internshipId;
}

/** Replace everything on this device with the synthetic demo internship. */
export async function loadDemo(asOf: string): Promise<void> {
  // The generator is only needed for the demo, so it is loaded on demand.
  const { DEMO_FACILITY, generateDemoDataset } = await import('@logbook/core/synthetic');
  const ds = generateDemoDataset({ asOf });
  await clearAll();
  await db.transaction('rw', db.tables, async () => {
    await db.facilities.put(DEMO_FACILITY);
    await db.internships.put(ds.internship);
    await db.rotations.bulkPut(ds.rotations);
    await db.patients.bulkPut(ds.patients);
    await db.supervisors.bulkPut(ds.supervisors);
    await db.encounters.bulkPut(ds.encounters);
    await db.activities.bulkPut(ds.activities);
    await db.entries.bulkPut(ds.entries);
    await db.verifications.bulkPut(ds.verifications);
    await db.reflections.bulkPut(ds.reflections);
    if (ds.assessments) await db.assessments.bulkPut(ds.assessments);
    if (ds.caseReports) await db.caseReports.bulkPut(ds.caseReports);
    await setMeta(META.activeInternship, ds.internship.id);
    await setMeta(META.rules, ds.rules);
    await setMeta(META.demo, { asOf });
    await setMeta(META.preferences, DEFAULT_PREFERENCES);
  });
}

export async function clearAll(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });
}

// ---------------------------------------------------------------------------
// Patients (pseudonymous)
// ---------------------------------------------------------------------------

export interface PatientInput {
  ref: string;
  birthYear?: number;
  sex?: Patient['sex'];
  systemicCondition?: boolean;
}

export function normaliseRef(ref: string): string {
  return ref.trim().toUpperCase().replace(/\s+/g, '');
}

async function upsertPatient(input: PatientInput): Promise<Patient> {
  const ref = normaliseRef(input.ref);
  if (!ref) throw new RepoError('Enter the hospital / outpatient number.');
  if (ref.length > 24) throw new RepoError('The patient number looks too long.');
  const existing = await db.patients.where('ref').equals(ref).first();
  const patient: Patient = existing
    ? {
        ...existing,
        birthYear: input.birthYear ?? existing.birthYear,
        sex: input.sex ?? existing.sex,
        systemicCondition: input.systemicCondition ?? existing.systemicCondition,
      }
    : { id: newId(), ref, birthYear: input.birthYear, sex: input.sex, systemicCondition: input.systemicCondition, createdAt: nowISO() };
  await db.patients.put(patient);
  await enqueue('patients', patient.id);
  return patient;
}

// ---------------------------------------------------------------------------
// Encounters and activities
// ---------------------------------------------------------------------------

export interface SaveResult {
  derivation: Derivation;
  created: number;
  withdrawn: number;
  /** Verified entries the change would alter: they need a correction, not an edit. */
  conflicts: LogbookEntry[];
}

async function context(internshipId: string) {
  const [rotations, rules] = await Promise.all([
    db.rotations.where('internshipId').equals(internshipId).toArray(),
    getMeta<CountingRules>(META.rules, DEFAULT_COUNTING_RULES),
  ]);
  return { rotations, rules: { ...DEFAULT_COUNTING_RULES, ...rules } };
}

function assignRotation<T extends { date: string; rotationId: string | null; rotationOverridden?: boolean }>(rec: T, rotations: Rotation[]): T {
  if (rec.rotationOverridden && rec.rotationId) return rec;
  return { ...rec, rotationId: rotationForDate(rotations, rec.date)?.id ?? null, rotationOverridden: false };
}

/**
 * Preview what an encounter will create, without saving (the review strip in
 * Quick Entry). Uses the same rules as save.
 */
export async function previewEncounter(encounter: Encounter, patient: PatientInput | null): Promise<Derivation> {
  const { rotations, rules } = await context(encounter.internshipId);
  const e = assignRotation(encounter, rotations);
  const existing = patient?.ref ? await db.patients.where('ref').equals(normaliseRef(patient.ref)).first() : undefined;
  const p: Patient | null = patient?.ref
    ? { id: existing?.id ?? 'preview', ref: normaliseRef(patient.ref), createdAt: '', birthYear: patient.birthYear ?? existing?.birthYear, systemicCondition: patient.systemicCondition ?? existing?.systemicCondition }
    : null;
  return deriveEncounter(e, { set: KMPDC_DENTAL_3, rules, rotation: rotationCodeFor(rotations, e.rotationId), patient: p });
}

export async function saveEncounter(draft: Encounter, patientInput: PatientInput | null): Promise<SaveResult> {
  return db.transaction('rw', [db.encounters, db.entries, db.patients, db.rotations, db.meta, db.outbox], async () => {
    const { rotations, rules } = await context(draft.internshipId);
    const patient = patientInput?.ref?.trim() ? await upsertPatient(patientInput) : null;
    const now = nowISO();
    const prev = await db.encounters.get(draft.id);
    const encounter: Encounter = assignRotation(
      { ...draft, patientId: patient?.id ?? null, createdAt: prev?.createdAt ?? now, updatedAt: now, deletedAt: null },
      rotations,
    );
    const derivation = deriveEncounter(encounter, { set: KMPDC_DENTAL_3, rules, rotation: rotationCodeFor(rotations, encounter.rotationId), patient });
    const existing = await db.entries.where('encounterId').equals(encounter.id).toArray();
    const rec = reconcileEntries(
      derivation.entries,
      existing,
      {
        internshipId: encounter.internshipId,
        rotationId: encounter.rotationId,
        performedOn: encounter.date,
        encounterId: encounter.id,
        patientRef: patient?.ref,
        supervisorId: encounter.supervisorId,
        status: 'submitted',
      },
      now,
      newId,
    );
    if (rec.conflicts.length) {
      throw new RepoError(
        `${rec.conflicts.length} verified logbook entr${rec.conflicts.length === 1 ? 'y' : 'ies'} would change. Verified entries cannot be edited; add a correction instead.`,
      );
    }
    await db.encounters.put(encounter);
    await enqueue('encounters', encounter.id);
    for (const e of [...rec.create, ...rec.update, ...rec.withdraw]) {
      await db.entries.put(e);
      await enqueue('entries', e.id);
    }
    return { derivation, created: rec.create.length, withdrawn: rec.withdraw.length, conflicts: rec.conflicts };
  });
}

/** Delete an encounter. Refused when any of its entries is verified (blueprint: corrections, not deletions). */
export async function deleteEncounter(id: string): Promise<void> {
  await db.transaction('rw', [db.encounters, db.entries, db.outbox], async () => {
    const entries = await db.entries.where('encounterId').equals(id).toArray();
    if (entries.some((e) => e.status === 'verified' || e.status === 'locked')) {
      throw new RepoError('This visit has verified logbook entries and cannot be deleted. Ask your supervisor to return them first.');
    }
    const now = nowISO();
    const enc = await db.encounters.get(id);
    if (!enc) return;
    await db.encounters.put({ ...enc, deletedAt: now, updatedAt: now });
    await enqueue('encounters', id, 'delete');
    for (const e of entries.filter((x) => x.status !== 'withdrawn')) {
      await db.entries.put({ ...e, status: 'withdrawn', updatedAt: now });
      await enqueue('entries', e.id);
    }
  });
}

export async function previewActivity(activity: Activity): Promise<Derivation> {
  const { rotations, rules } = await context(activity.internshipId);
  const a = assignRotation(activity, rotations);
  return deriveActivity(a, { set: KMPDC_DENTAL_3, rules, rotation: rotationCodeFor(rotations, a.rotationId) });
}

export async function saveActivity(draft: Activity): Promise<SaveResult> {
  return db.transaction('rw', [db.activities, db.entries, db.rotations, db.meta, db.outbox], async () => {
    const { rotations, rules } = await context(draft.internshipId);
    const now = nowISO();
    const prev = await db.activities.get(draft.id);
    const activity = assignRotation({ ...draft, createdAt: prev?.createdAt ?? now, updatedAt: now, deletedAt: null }, rotations);
    const derivation = deriveActivity(activity, { set: KMPDC_DENTAL_3, rules, rotation: rotationCodeFor(rotations, activity.rotationId) });
    const existing = await db.entries.where('activityId').equals(activity.id).toArray();
    const rec = reconcileEntries(
      derivation.entries,
      existing,
      { internshipId: activity.internshipId, rotationId: activity.rotationId, performedOn: activity.date, supervisorId: activity.supervisorId, status: 'submitted' },
      now,
      newId,
    );
    if (rec.conflicts.length) throw new RepoError('A verified logbook entry would change. Verified entries cannot be edited.');
    await db.activities.put(activity);
    await enqueue('activities', activity.id);
    for (const e of [...rec.create, ...rec.update, ...rec.withdraw]) {
      await db.entries.put(e);
      await enqueue('entries', e.id);
    }
    return { derivation, created: rec.create.length, withdrawn: rec.withdraw.length, conflicts: rec.conflicts };
  });
}

export async function deleteActivity(id: string): Promise<void> {
  await db.transaction('rw', [db.activities, db.entries, db.outbox], async () => {
    const entries = await db.entries.where('activityId').equals(id).toArray();
    if (entries.some((e) => e.status === 'verified' || e.status === 'locked')) {
      throw new RepoError('This activity has a verified logbook entry and cannot be deleted.');
    }
    const now = nowISO();
    const a = await db.activities.get(id);
    if (!a) return;
    await db.activities.put({ ...a, deletedAt: now, updatedAt: now });
    await enqueue('activities', id, 'delete');
    for (const e of entries.filter((x) => x.status !== 'withdrawn')) {
      await db.entries.put({ ...e, status: 'withdrawn', updatedAt: now });
      await enqueue('entries', e.id);
    }
  });
}

// ---------------------------------------------------------------------------
// Diary, rotations, supervisors, preferences, snapshots
// ---------------------------------------------------------------------------

export async function saveReflection(r: Reflection): Promise<void> {
  const now = nowISO();
  const prev = await db.reflections.get(r.id);
  await db.reflections.put({ ...r, createdAt: prev?.createdAt ?? now, updatedAt: now, deletedAt: null });
  await enqueue('reflections', r.id);
}

export async function deleteReflection(id: string): Promise<void> {
  const r = await db.reflections.get(id);
  if (!r) return;
  await db.reflections.put({ ...r, deletedAt: nowISO() });
  await enqueue('reflections', id, 'delete');
}

/**
 * Save the rotation calendar and re-assign every record that was placed
 * automatically, so a corrected date range moves entries to the right rotation.
 */
export async function saveRotations(internshipId: string, rotations: Rotation[]): Promise<{ moved: number }> {
  let moved = 0;
  await db.transaction('rw', [db.rotations, db.encounters, db.activities, db.entries, db.internships, db.outbox], async () => {
    await db.rotations.where('internshipId').equals(internshipId).delete();
    await db.rotations.bulkPut(rotations);
    for (const r of rotations) await enqueue('rotations', r.id);
    const internship = await db.internships.get(internshipId);
    if (internship && rotations.length) {
      const sorted = [...rotations].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
      const last = sorted.at(-1)!;
      await db.internships.put({ ...internship, periodFrom: sorted[0]!.startsOn, periodTo: last.endsOn });
    }
    for (const e of await db.encounters.toArray()) {
      if (e.rotationOverridden) continue;
      const rid = rotationForDate(rotations, e.date)?.id ?? null;
      if (rid !== e.rotationId) {
        moved++;
        await db.encounters.put({ ...e, rotationId: rid });
        for (const entry of await db.entries.where('encounterId').equals(e.id).toArray()) {
          if (entry.status === 'verified' || entry.status === 'locked') continue;
          await db.entries.put({ ...entry, rotationId: rid });
        }
      }
    }
    for (const a of await db.activities.toArray()) {
      if (a.rotationOverridden) continue;
      const rid = rotationForDate(rotations, a.date)?.id ?? null;
      if (rid !== a.rotationId) {
        moved++;
        await db.activities.put({ ...a, rotationId: rid });
      }
    }
  });
  return { moved };
}

export async function saveSupervisor(s: Supervisor): Promise<void> {
  if (!s.name.trim()) throw new RepoError('Enter the supervisor\'s name.');
  await db.supervisors.put({ ...s, name: s.name.trim() });
  await enqueue('supervisors', s.id);
}

// ---------------------------------------------------------------------------
// Supervisor sign-off on the intern's phone
// ---------------------------------------------------------------------------

export async function setSupervisorPin(supervisorId: string, pin: string): Promise<void> {
  const s = await db.supervisors.get(supervisorId);
  if (!s) throw new RepoError('Supervisor not found.');
  if (s.pinHash) throw new RepoError('This supervisor already has a PIN.');
  const hashed = await hashPin(pin);
  await db.supervisors.put({ ...s, ...hashed, pinSetAt: nowISO() });
}

export interface SignOffDecision {
  /** Exactly one of entryId / caseReportId. */
  entryId?: string;
  caseReportId?: string;
  decision: 'verified' | 'returned';
  levelObserved?: Level;
  comment?: string;
}

/**
 * Apply a supervisor's decisions after checking their PIN. Each decision
 * becomes an append-only verification, hash-chained to the previous one, and
 * sets the entry's status. Only entries awaiting verification and submitted
 * to this supervisor can be signed.
 */
export async function signOff(supervisorId: string, pin: string, decisions: SignOffDecision[]): Promise<{ verified: number; returned: number }> {
  const supervisor = await db.supervisors.get(supervisorId);
  if (!supervisor) throw new RepoError('Supervisor not found.');
  if (!(await checkPin(pin, supervisor))) throw new RepoError('That PIN is not correct.');
  if (!decisions.length) throw new RepoError('No decisions to sign.');
  let verified = 0;
  let returned = 0;
  await db.transaction('rw', [db.entries, db.caseReports, db.verifications, db.outbox], async () => {
    const all = await db.verifications.toArray();
    let prevHash = all.sort((a, b) => a.signedAt.localeCompare(b.signedAt) || a.id.localeCompare(b.id)).at(-1)?.hash ?? null;
    let t = Date.now();
    for (const d of decisions) {
      if (d.caseReportId) {
        const report = await db.caseReports.get(d.caseReportId);
        if (!report || report.status !== 'submitted') throw new RepoError('A case report was changed while you were reviewing. Start the sign-off again.');
        if ((report.supervisorId ?? null) !== supervisorId) throw new RepoError('A case report is assigned to a different supervisor.');
        if (d.decision === 'returned' && !d.comment?.trim()) throw new RepoError('Say what needs fixing for each returned case report.');
        const signedAt = new Date(t++).toISOString();
        const v = createCaseReportVerification(report, { verifierId: supervisorId, decision: d.decision, comment: d.comment?.trim() || undefined, method: 'pin' }, prevHash, signedAt, newId());
        prevHash = v.hash;
        await db.verifications.put(v);
        await db.caseReports.put({ ...report, status: statusAfter(v), updatedAt: signedAt });
        await enqueue('caseReports', report.id);
        await enqueue('verifications', v.id);
        if (d.decision === 'verified') verified++;
        else returned++;
        continue;
      }
      const entry = d.entryId ? await db.entries.get(d.entryId) : undefined;
      if (!entry || entry.status !== 'submitted') throw new RepoError('An entry was changed while you were reviewing. Start the sign-off again.');
      if ((entry.supervisorId ?? null) !== supervisorId) throw new RepoError('An entry is assigned to a different supervisor.');
      if (d.decision === 'returned' && !d.comment?.trim()) throw new RepoError('Say what needs fixing for each returned entry.');
      // Strictly increasing timestamps keep the chain order unambiguous.
      const signedAt = new Date(t++).toISOString();
      const v = createVerification(
        entry,
        {
          verifierId: supervisorId,
          decision: d.decision,
          levelObserved: d.decision === 'verified' ? d.levelObserved ?? entry.levelClaimed : undefined,
          comment: d.comment?.trim() || undefined,
          method: 'pin',
        },
        prevHash,
        signedAt,
        newId(),
      );
      prevHash = v.hash;
      await db.verifications.put(v);
      await db.entries.put({ ...entry, status: statusAfter(v), updatedAt: signedAt });
      await enqueue('entries', entry.id);
      await enqueue('verifications', v.id);
      if (d.decision === 'verified') verified++;
      else returned++;
    }
  });
  return { verified, returned };
}

// ---------------------------------------------------------------------------
// Assessment forms
// ---------------------------------------------------------------------------

export async function saveAssessment(a: Assessment, rotationCode: string): Promise<void> {
  const issues = validateAssessment(a, rotationCode);
  const error = issues.find((i) => i.level === 'error');
  if (error) throw new RepoError(error.message);
  const now = nowISO();
  const prev = await db.assessments.get(a.id);
  await db.assessments.put({ ...a, createdAt: prev?.createdAt ?? now, updatedAt: now, deletedAt: null });
  await enqueue('assessments', a.id);
}

// ---------------------------------------------------------------------------
// Case reports
// ---------------------------------------------------------------------------

/**
 * Save a case report; with `submit`, send it for verification. A returned
 * report goes back to the supervisor when resubmitted. Verified reports are
 * locked.
 */
export async function saveCaseReport(r: CaseReport, today: string, submit: boolean): Promise<CaseReport> {
  const prev = await db.caseReports.get(r.id);
  if (prev?.status === 'verified') throw new RepoError('This case report is verified and cannot be changed.');
  const issues = validateCaseReport(r, today, submit);
  const error = issues.find((i) => i.level === 'error');
  if (error) throw new RepoError(error.message);
  const now = nowISO();
  const status: CaseReport['status'] = submit ? 'submitted' : prev?.status === 'submitted' ? 'submitted' : prev?.status === 'returned' ? 'returned' : 'draft';
  const saved: CaseReport = { ...r, status, createdAt: prev?.createdAt ?? now, updatedAt: now, deletedAt: null };
  await db.caseReports.put(saved);
  await enqueue('caseReports', saved.id);
  return saved;
}

export async function deleteCaseReport(id: string): Promise<void> {
  const r = await db.caseReports.get(id);
  if (!r) return;
  if (r.status === 'verified') throw new RepoError('Verified case reports cannot be deleted.');
  await db.caseReports.put({ ...r, deletedAt: nowISO() });
  await enqueue('caseReports', id, 'delete');
}

export async function saveInternship(i: Internship): Promise<void> {
  await db.internships.put(i);
  await enqueue('internships', i.id);
}

export async function saveFacility(f: Facility): Promise<void> {
  await db.facilities.put(f);
  await enqueue('facilities', f.id);
}

export async function savePreferences(p: Preferences): Promise<void> {
  await setMeta(META.preferences, p);
}

export async function saveRules(rules: CountingRules): Promise<void> {
  await setMeta(META.rules, rules);
}

export async function saveSnapshot(s: ReportSnapshot): Promise<void> {
  await db.snapshots.put(s);
  await enqueue('snapshots', s.id);
}

// ---------------------------------------------------------------------------
// Backup (full personal export, brief §19)
// ---------------------------------------------------------------------------

const BACKUP_TABLES = ['meta', 'facilities', 'internships', 'rotations', 'patients', 'supervisors', 'encounters', 'activities', 'entries', 'verifications', 'reflections', 'snapshots', 'assessments', 'caseReports'] as const;

export async function exportBackup(): Promise<string> {
  const out: Record<string, unknown> = { format: 'dental-intern-logbook-backup', version: 1, exportedAt: nowISO() };
  for (const t of BACKUP_TABLES) out[t] = await db.table(t).toArray();
  return JSON.stringify(out);
}

export async function importBackup(json: string): Promise<void> {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json);
  } catch {
    throw new RepoError('This file is not a valid backup.');
  }
  if (data.format !== 'dental-intern-logbook-backup') throw new RepoError('This file is not a logbook backup.');
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    for (const t of BACKUP_TABLES) {
      const rows = data[t];
      if (Array.isArray(rows)) await db.table(t).bulkPut(rows);
    }
  });
}
