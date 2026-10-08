import Dexie, { type Table } from 'dexie';
import type {
  Activity,
  Assessment,
  CountingRules,
  Encounter,
  Facility,
  Internship,
  LogbookEntry,
  Patient,
  Reflection,
  ReportSnapshot,
  Rotation,
  Supervisor,
  Verification,
} from '@logbook/core';

/**
 * On-device store (IndexedDB). Every screen reads and writes here first, so
 * the app never waits for the network. Each write also appends to the outbox,
 * which the sync engine (M3) drains to the server.
 */

export type SyncTable =
  | 'facilities'
  | 'internships'
  | 'rotations'
  | 'patients'
  | 'supervisors'
  | 'encounters'
  | 'activities'
  | 'entries'
  | 'verifications'
  | 'reflections'
  | 'snapshots'
  | 'assessments';

export interface OutboxItem {
  seq?: number;
  table: SyncTable;
  recordId: string;
  op: 'upsert' | 'delete';
  createdAt: string;
  attempts: number;
  status: 'pending' | 'error';
  error?: string;
}

export interface Preferences {
  favourites: string[];
  defaultSupervisorId?: string;
  theme: 'system' | 'light' | 'dark';
  /** Dashboard widgets the intern has hidden. */
  hiddenWidgets: string[];
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

export class LogbookDB extends Dexie {
  meta!: Table<MetaRecord, string>;
  facilities!: Table<Facility, string>;
  internships!: Table<Internship, string>;
  rotations!: Table<Rotation, string>;
  patients!: Table<Patient, string>;
  supervisors!: Table<Supervisor, string>;
  encounters!: Table<Encounter, string>;
  activities!: Table<Activity, string>;
  entries!: Table<LogbookEntry, string>;
  verifications!: Table<Verification, string>;
  reflections!: Table<Reflection, string>;
  snapshots!: Table<ReportSnapshot, string>;
  assessments!: Table<Assessment, string>;
  outbox!: Table<OutboxItem, number>;

  constructor(name = 'dental-intern-logbook') {
    super(name);
    this.version(1).stores({
      meta: 'key',
      facilities: 'id',
      internships: 'id',
      rotations: 'id, internshipId, startsOn',
      patients: 'id, ref',
      supervisors: 'id',
      encounters: 'id, date, patientId, rotationId',
      activities: 'id, date, rotationId',
      entries: 'id, encounterId, activityId, requirementCode, performedOn, status',
      verifications: 'id, entryId, signedAt',
      reflections: 'id, date',
      snapshots: 'id, kind, from',
      outbox: '++seq, table, recordId, status',
    });
    // v2: KMPDC assessment and evaluation forms.
    this.version(2).stores({ assessments: 'id, rotationId, kind' });
  }
}

export const db = new LogbookDB();

export const META = {
  activeInternship: 'activeInternshipId',
  rules: 'countingRules',
  preferences: 'preferences',
  demo: 'demo',
  finalReflection: 'finalReflection',
  lastSyncAt: 'lastSyncAt',
} as const;

export const DEFAULT_PREFERENCES: Preferences = {
  favourites: ['exam_plan', 'extraction', 'composite', 'scaling_polishing', 'rct', 'behaviour_ohe'],
  theme: 'system',
  hiddenWidgets: [],
};

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const rec = await db.meta.get(key);
  return rec ? (rec.value as T) : fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export type { CountingRules };
