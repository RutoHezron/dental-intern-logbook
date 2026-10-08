/**
 * Core domain types.
 *
 * Dates are ISO calendar dates ("YYYY-MM-DD") and times are "HH:mm" in the
 * facility's local time. Timestamps are ISO-8601 strings. Keeping dates as
 * plain strings avoids time-zone drift between device and server.
 */

export type ISODate = string;
export type ISODateTime = string;
export type ID = string;

/** Rotation codes. Configurable per requirement set; KMPDC uses these five. */
export type RotationCode = string;

/**
 * KMPDC competency level (5.2.2):
 * 1 observes · 2 assists · 3 whole procedure under direct supervision ·
 * 4 under indirect supervision · 5 independently.
 * "Level 0 / no exposure" is a derived display state, never stored.
 */
export type Level = 1 | 2 | 3 | 4 | 5;
export const LEVELS: readonly Level[] = [1, 2, 3, 4, 5] as const;

export type EntryStatus = 'draft' | 'submitted' | 'returned' | 'verified' | 'locked' | 'withdrawn';

export type Provenance = 'clinician' | 'system' | 'ai_accepted' | 'ai_edited' | 'imported';

export type VisitType = 'new' | 'review' | 'continuing' | 'emergency';

export type Setting = 'opd' | 'ward' | 'theatre' | 'emergency' | 'outreach' | 'other';

export type SiteKind = 'tooth' | 'region' | 'none';

export type ProcedureCategory =
  | 'diagnosis'
  | 'oral_surgery'
  | 'restorative'
  | 'endodontic'
  | 'periodontal'
  | 'prosthodontic'
  | 'paediatric'
  | 'preventive'
  | 'orthodontic'
  | 'emergency'
  | 'general';

export type ReflectionTag = 'important' | 'learning' | 'challenging' | 'revision' | 'milestone';

// ---------------------------------------------------------------------------
// Configuration: requirement sets and catalogue
// ---------------------------------------------------------------------------

export interface RotationDef {
  code: RotationCode;
  name: string;
  /** Default length in weeks. */
  weeks: number;
  /** Logbook section reference, e.g. "5.3". */
  section?: string;
}

/** Unit of count (see counting rule R3–R5). */
export type UnitRule = 'per_tooth' | 'per_patient_visit' | 'per_case_completion' | 'per_session' | 'per_activity';

export interface Requirement {
  code: string;
  rotation: RotationCode;
  description: string;
  minCount: number;
  expectedLevel: Level;
  /** Rows printed in the paper book (CONS 07 has none). */
  printedRows: number;
  unitRule: UnitRule;
  /** False for postmortems, diagnostic sessions, conferences etc. */
  needsPatient: boolean;
  /** Grouping for display, e.g. "Activities", "Case follow-up". */
  group?: string;
  notes?: string;
}

/** Competencies that the source framework expects but does not code (KMPDC G1, G2, G6). */
export interface UncodedCompetency {
  code: string;
  area: string;
  description: string;
  source: string;
}

export interface RequirementSet {
  id: ID;
  issuer: string;
  title: string;
  edition: string;
  effectiveFrom?: ISODate;
  rotations: RotationDef[];
  requirements: Requirement[];
  uncoded: UncodedCompetency[];
}

/** Condition under which a procedure or activity maps to a requirement code. */
export interface MappingCondition {
  /** Only during this rotation (rule R1, when enabled). */
  rotation?: RotationCode;
  /** Patient must be younger than this on the date (KMPDC 4.4.1: under 17). */
  maxAgeExclusive?: number;
  /** Tooth class taken from the FDI number. */
  toothClass?: 'anterior' | 'posterior';
  /** Patient has an active systemic condition alert. */
  systemicAlert?: boolean;
  /** Encounter must record at least one diagnosis. */
  requiresDiagnosis?: boolean;
  /** Only the final stage of a multi-stage procedure counts (rule R4). */
  finalStageOnly?: boolean;
}

export interface CodeMapping {
  requirementCode: string;
  when: MappingCondition;
  /** Short rule label shown to the intern, e.g. "R3 per tooth". */
  rule: string;
}

export interface ProcedureType {
  id: string;
  name: string;
  shortName: string;
  category: ProcedureCategory;
  siteKind: SiteKind;
  /** Number of stages for multi-visit procedures (RCT = 3). */
  stages: number;
  stageNames?: string[];
  /** Ordered: the first mapping whose condition matches wins (rule R6: one code per procedure). */
  mappings: CodeMapping[];
  /** Uncoded competency this contributes exposure to. */
  uncoded?: string;
  /** Rotations in which this procedure is typical (drives favourites and the "unusual for rotation" check). */
  typicalRotations: RotationCode[];
  keywords?: string[];
}

export type ActivityGroup = 'clinical' | 'academic' | 'community' | 'other';

export interface ActivityType {
  id: string;
  name: string;
  group: ActivityGroup;
  mappings: CodeMapping[];
  /** Default level suggested for the activity, if the framework fixes it (e.g. postmortem = L1). */
  fixedLevel?: Level;
  /** Community activity: requires choosing the item / case / step. */
  needs?: 'community_item' | 'community_case' | 'weekly_report';
  typicalRotations: RotationCode[];
}

/** Counting rules R1–R10 (blueprint §12.2). Defaults until an ITC confirms. */
export interface CountingRules {
  /** R1: an entry counts only toward codes of the rotation it was performed in. */
  rotationScope: boolean;
  /** R2: which statuses count toward "completed". */
  completedStatuses: EntryStatus[];
  /** R4: multi-stage procedures count once, at the final stage. */
  finalStageOnly: boolean;
  /** R7: paediatric age limit (exclusive). */
  paediatricMaxAge: number;
  /** R8: entries logged more than N days after the procedure are flagged. */
  lateEntryDays: number;
  /** R6/PER 02: when a periodontal procedure qualifies for both PER 02 and PER 03, prefer PER 02. */
  preferSystemicCode: boolean;
  /** R10: label shown while rules are unconfirmed. */
  confirmed: boolean;
}

// ---------------------------------------------------------------------------
// People and structure
// ---------------------------------------------------------------------------

export interface Facility {
  id: ID;
  name: string;
  county?: string;
  facilityType?: string;
}

export interface Supervisor {
  id: ID;
  name: string;
  role?: string;
  /** Rotation / department the supervisor is attached to. */
  rotation?: RotationCode;
  kmpdcRegNo?: string;
}

export interface Internship {
  id: ID;
  internName: string;
  email?: string;
  licenceNo?: string;
  facilityId: ID;
  institution?: string;
  requirementSetId: ID;
  periodFrom: ISODate;
  periodTo: ISODate;
  declarationSignedAt?: ISODateTime;
}

export interface Rotation {
  id: ID;
  internshipId: ID;
  rotation: RotationCode;
  startsOn: ISODate;
  endsOn: ISODate;
  extendedByDays: number;
  facilityId?: ID;
  department?: string;
  supervisorId?: ID;
  objectives?: string;
  outcome?: 'completed' | 'extended' | 'irredeemable';
}

// ---------------------------------------------------------------------------
// Clinical record (pseudonymous: no names, phones or IDs, ever)
// ---------------------------------------------------------------------------

export interface Patient {
  id: ID;
  /** Hospital / outpatient number, as written in the paper logbook. */
  ref: string;
  birthYear?: number;
  sex?: 'F' | 'M' | 'X';
  /** Structured alert: has an active systemic condition (for PER 02, safety prompts). */
  systemicCondition?: boolean;
  alerts?: string[];
  createdAt: ISODateTime;
}

export interface Finding {
  term: string;
  site?: string;
  isDiagnosis: boolean;
  certainty?: 'provisional' | 'confirmed';
}

export interface Investigation {
  kind: string;
  site?: string;
}

export interface EncounterProcedure {
  id: ID;
  procedureTypeId: string;
  /** FDI tooth numbers ("36") or region labels; empty for siteKind none. */
  sites: string[];
  /** 1-based stage for multi-stage procedures. */
  stage?: number;
  /** Explicit final-stage flag (defaults to stage === stages). */
  isFinalStage?: boolean;
  level: Level;
  notes?: string;
  /** Free-text name when procedureTypeId === "other". */
  otherName?: string;
}

export interface Encounter {
  id: ID;
  internshipId: ID;
  /** Assigned automatically from the date; may be corrected manually. */
  rotationId: ID | null;
  rotationOverridden?: boolean;
  date: ISODate;
  time?: string;
  patientId: ID | null;
  visitType: VisitType;
  setting?: Setting;
  supervisorId?: ID | null;
  complaint?: string;
  findings: Finding[];
  investigations: Investigation[];
  procedures: EncounterProcedure[];
  referredTo?: string;
  followUpNeeded?: boolean;
  notes?: string;
  tags?: string[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt?: ISODateTime | null;
}

export interface Activity {
  id: ID;
  internshipId: ID;
  rotationId: ID | null;
  rotationOverridden?: boolean;
  date: ISODate;
  activityTypeId: string;
  level: Level;
  supervisorId?: ID | null;
  /** Community 5.7.4 item number (1–16). */
  communityItem?: number;
  /** Community 5.7.5 case: type, slot and step. */
  caseType?: string;
  caseSlot?: number;
  followUpStep?: 'identification' | 'genogram' | 'home_visit' | 'clinic_review';
  /** Community weekly report number (1–8). */
  weeklyReportNo?: number;
  title?: string;
  notes?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt?: ISODateTime | null;
}

// ---------------------------------------------------------------------------
// Logbook (derived) and verification (append-only)
// ---------------------------------------------------------------------------

export interface LogbookEntry {
  id: ID;
  internshipId: ID;
  requirementCode: string;
  rotationId: ID | null;
  encounterId?: ID;
  encounterProcedureId?: ID;
  activityId?: ID;
  performedOn: ISODate;
  patientRef?: string;
  site?: string;
  levelClaimed: Level;
  status: EntryStatus;
  /** Rule that produced the entry, shown to intern and supervisor. */
  rule: string;
  /** Set when the intern overrode the derived code. */
  overrideReason?: string;
  supervisorId?: ID | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Verification {
  id: ID;
  entryId: ID;
  verifierId: ID;
  decision: 'verified' | 'returned';
  levelObserved?: Level;
  comment?: string;
  method: 'passkey' | 'pin' | 'wet_signature_scan' | 'co_located_qr' | 'demo';
  signedAt: ISODateTime;
  prevHash: string | null;
  hash: string;
}

// ---------------------------------------------------------------------------
// Reflection diary
// ---------------------------------------------------------------------------

export interface Reflection {
  id: ID;
  internshipId: ID;
  date: ISODate;
  encounterId?: ID;
  activityId?: ID;
  title: string;
  interesting?: string;
  learned?: string;
  challenged?: string;
  doDifferently?: string;
  revise?: string;
  needExposure?: string;
  tags: ReflectionTag[];
  sharedWithSupervisor: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt?: ISODateTime | null;
}

/** Everything the analytics layer needs, in one bundle. */
export interface Dataset {
  requirementSet: RequirementSet;
  rules: CountingRules;
  internship: Internship;
  rotations: Rotation[];
  patients: Patient[];
  supervisors: Supervisor[];
  encounters: Encounter[];
  activities: Activity[];
  entries: LogbookEntry[];
  verifications: Verification[];
  reflections: Reflection[];
}
