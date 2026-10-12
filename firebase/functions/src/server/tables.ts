/**
 * Columns each synced table accepts from a device, generated from the Postgres
 * migrations (supabase/migrations) so both backends store exactly the same
 * fields. Anything else a device sends is dropped: personal mode has no
 * place for patient names, phone numbers or ID numbers.
 */

export const COLUMNS: Record<string, readonly string[]> = {
  facility: ["id", "name", "county", "facility_type", "deleted_at"],
  internship: ["id", "intern_name", "email", "licence_no", "facility_id", "institution", "requirement_set_id", "period_from", "period_to", "declaration_signed_at", "deleted_at"],
  supervisor: ["id", "name", "role", "rotation", "kmpdc_reg_no", "user_id", "deleted_at", "linked_at"],
  rotation: ["id", "internship_id", "rotation", "starts_on", "ends_on", "extended_by_days", "facility_id", "department", "supervisor_id", "objectives", "outcome", "deleted_at"],
  patient: ["id", "ref", "birth_year", "sex", "systemic_condition", "alerts", "created_at", "deleted_at"],
  activity: ["id", "internship_id", "rotation_id", "rotation_overridden", "date", "activity_type_id", "level", "supervisor_id", "community_item", "case_type", "case_slot", "follow_up_step", "weekly_report_no", "title", "notes", "created_at", "updated_at", "deleted_at"],
  logbook_entry: ["id", "internship_id", "requirement_code", "rotation_id", "encounter_id", "encounter_procedure_id", "activity_id", "performed_on", "patient_ref", "site", "level_claimed", "status", "rule", "override_reason", "supervisor_id", "created_at", "updated_at", "deleted_at"],
  reflection: ["id", "internship_id", "date", "encounter_id", "activity_id", "title", "interesting", "learned", "challenged", "do_differently", "revise", "need_exposure", "tags", "shared_with_supervisor", "created_at", "updated_at", "deleted_at"],
  report_snapshot: ["id", "kind", "label", "from", "to", "finalised_at", "payload", "sha256", "deleted_at"],
  assessment: ["id", "internship_id", "rotation_id", "kind", "sequence", "form_version", "held_on", "held_at", "responses", "grades", "grade_remarks", "overall_grade", "recommendation", "outcome", "extend_by", "progress_snapshot", "created_at", "updated_at", "deleted_at"],
  case_report: ["id", "internship_id", "rotation_id", "date", "title", "patient_id", "encounter_ids", "sections", "status", "supervisor_id", "created_at", "updated_at", "deleted_at"],
  treatment_plan: ["id", "internship_id", "patient_id", "created_on", "status", "items", "consent_note", "handover_note", "handover_to", "handed_over_on", "created_at", "updated_at", "deleted_at"],
  verification: ["id", "entry_id", "verifier_id", "decision", "level_observed", "comment", "method", "signed_at", "prev_hash", "hash", "case_report_id"],
  encounter: ["id", "internship_id", "rotation_id", "rotation_overridden", "date", "time", "patient_id", "visit_type", "setting", "supervisor_id", "complaint", "referred_to", "follow_up_needed", "notes", "tags", "created_at", "updated_at", "deleted_at"],
};

/** Pull order: parents before children (matches the sync_table registry). */
export const PULL_ORDER = ["facility", "internship", "supervisor", "rotation", "patient", "activity", "logbook_entry", "reflection", "report_snapshot", "assessment", "case_report", "treatment_plan", "verification"] as const;

/** Tables a device may write ('encounter' carries its child rows). */
export const DEVICE_WRITABLE = new Set<string>([...PULL_ORDER, 'encounter']);

/** Child rows stored inside their encounter. */
export const CHILD_KEYS: Record<'procedures' | 'findings' | 'investigations', readonly string[]> = {
  procedures: ["id", "procedure_type_id", "sites", "stage", "is_final_stage", "level", "notes", "other_name"],
  findings: ["term", "site", "is_diagnosis", "certainty"],
  investigations: ["kind", "site"],
};
