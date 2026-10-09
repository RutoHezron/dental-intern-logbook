/**
 * Wire format between the device store and the server.
 *
 * Device records use camelCase; database rows use snake_case. Nested arrays
 * (an encounter's procedures, findings and investigations) travel inside
 * their parent and are stored server-side in child tables. Server-only
 * columns never reach the device.
 */

export type ClientTable =
  | 'facilities'
  | 'internships'
  | 'supervisors'
  | 'rotations'
  | 'patients'
  | 'encounters'
  | 'activities'
  | 'entries'
  | 'verifications'
  | 'reflections'
  | 'snapshots'
  | 'assessments'
  | 'caseReports'
  | 'treatmentPlans';

export const SERVER_TABLE: Record<ClientTable, string> = {
  facilities: 'facility',
  internships: 'internship',
  supervisors: 'supervisor',
  rotations: 'rotation',
  patients: 'patient',
  encounters: 'encounter',
  activities: 'activity',
  entries: 'logbook_entry',
  verifications: 'verification',
  reflections: 'reflection',
  snapshots: 'report_snapshot',
  assessments: 'assessment',
  caseReports: 'case_report',
  treatmentPlans: 'treatment_plan',
};

export const CLIENT_TABLE: Record<string, ClientTable> = Object.fromEntries(
  Object.entries(SERVER_TABLE).map(([c, s]) => [s, c as ClientTable]),
) as Record<string, ClientTable>;

/** Parents before children, so foreign keys resolve within one push. */
export const PUSH_ORDER: ClientTable[] = [
  'facilities',
  'internships',
  'supervisors',
  'rotations',
  'patients',
  'encounters',
  'treatmentPlans',
  'activities',
  'entries',
  'reflections',
  'snapshots',
  'assessments',
  'caseReports',
  // After entries: a verification signed on the phone references its entry.
  'verifications',
];

/** Tables the device may write. Verifications from the phone are accepted only for PIN sign-off (see migration 0400). */
export const CLIENT_WRITABLE = new Set<ClientTable>(PUSH_ORDER);

const SERVER_ONLY = new Set(['owner_id', 'server_seq', 'server_received_at']);

/** Device-only secrets that must never leave the phone. */
const DEVICE_ONLY = new Set(['pinSalt', 'pinHash', 'pinSetAt']);

/** Keys whose null value is meaningful on the device (kept as null rather than dropped). */
const NULLABLE = new Set(['rotationId', 'patientId', 'supervisorId', 'deletedAt', 'prevHash']);

/** Opaque payload fields stored as-is (no key conversion inside). */
const OPAQUE = new Set(['payload', 'sections', 'responses', 'grades', 'gradeRemarks', 'grade_remarks', 'progressSnapshot', 'progress_snapshot']);

const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function convertKeys(value: unknown, fn: (k: string) => string, dropNulls: boolean, parentKey?: string): unknown {
  if (Array.isArray(value)) return value.map((v) => convertKeys(v, fn, dropNulls));
  if (value === null || typeof value !== 'object') return value;
  if (parentKey && OPAQUE.has(parentKey)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    const key = fn(k);
    if (v === null && dropNulls && !NULLABLE.has(key)) continue;
    out[key] = convertKeys(v, fn, dropNulls, key);
  }
  return out;
}

/** Device record → server row (snake_case, nested arrays kept for the push function). */
export function toWire(record: object): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) if (!DEVICE_ONLY.has(k)) clean[k] = v;
  return convertKeys(clean, toSnake, false) as Record<string, unknown>;
}

/** Server row → device record (camelCase, server-only columns removed, empty optionals dropped). */
export function fromWire<T>(row: Record<string, unknown>): T {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!SERVER_ONLY.has(k)) clean[k] = v;
  return convertKeys(clean, toCamel, true) as T;
}

export interface PushChange {
  table: string;
  op: 'upsert' | 'delete';
  record: Record<string, unknown>;
}

export interface PushResult {
  accepted: { table: string; id: string }[];
  rejected: { table: string; id: string; reason: string }[];
}

export interface PullResult {
  cursor: number;
  changes: Record<string, Record<string, unknown>[]>;
}
