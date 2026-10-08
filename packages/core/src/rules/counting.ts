import type { CountingRules, EntryStatus } from '../types';

/**
 * Default counting rules (blueprint §12.2). The KMPDC logbook does not define
 * them, so every rule is configurable and shown as "default rules" until an
 * internship training centre confirms (R10).
 */
export const DEFAULT_COUNTING_RULES: CountingRules = {
  rotationScope: true, // R1
  completedStatuses: ['verified', 'locked'], // R2
  finalStageOnly: true, // R4
  paediatricMaxAge: 17, // R7
  lateEntryDays: 3, // R8
  preferSystemicCode: true, // PER 02 before PER 03
  confirmed: false, // R10
};

export const RULE_DESCRIPTIONS: Record<string, string> = {
  R1: 'An entry counts only toward codes of the rotation during which it was performed.',
  R2: 'Completed = verified entries. "At expected level" uses the supervisor\'s observed level where given.',
  R3: 'Single-visit tooth procedures count one entry per tooth per visit.',
  R4: 'Multi-stage procedures (RCT, crown/bridge) count once, at the final stage.',
  R5: 'Diagnosis/planning codes count one per patient visit (OMF 1 needs a recorded diagnosis).',
  R6: 'One procedure never counts under two codes; per-visit codes count once per encounter.',
  R7: 'Paediatric codes require the patient to be under 17 on the date (KMPDC 4.4.1).',
  R8: 'Entries logged more than 3 days after the procedure are flagged to the supervisor.',
  R9: 'Non-patient evidence (postmortems, sessions, calls, talks) is logged as an activity.',
  R10: 'Codes show "met (default rules)" until the training centre confirms these rules.',
};

/** Statuses that represent a live (non-withdrawn, non-draft) claim. */
export const LOGGED_STATUSES: EntryStatus[] = ['submitted', 'returned', 'verified', 'locked'];
export const PENDING_STATUSES: EntryStatus[] = ['submitted', 'returned'];
