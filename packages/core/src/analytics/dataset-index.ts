import type { Activity, Dataset, Encounter, ID, Level, LogbookEntry, Patient, Requirement, Rotation, Verification } from '../types';
import { LOGGED_STATUSES } from '../rules/counting';
import { effectiveLevel, latestVerifications } from '../rules/verification';

/**
 * Pre-computed lookups over a dataset. Analytics functions take an index so
 * that a dashboard rendering many widgets does the expensive work once.
 */
export interface DatasetIndex {
  ds: Dataset;
  encounters: Encounter[];
  activities: Activity[];
  /** Entries that represent a live claim (not draft, not withdrawn). */
  entries: LogbookEntry[];
  patients: Map<ID, Patient>;
  rotations: Map<ID, Rotation>;
  requirements: Map<string, Requirement>;
  latest: Map<ID, Verification>;
  effLevel: (e: LogbookEntry) => Level;
  rotationCode: (rotationId: ID | null | undefined) => string | null;
}

export function indexDataset(ds: Dataset): DatasetIndex {
  const latest = latestVerifications(ds.verifications);
  const rotations = new Map(ds.rotations.map((r) => [r.id, r]));
  return {
    ds,
    encounters: ds.encounters.filter((e) => !e.deletedAt).sort((a, b) => a.date.localeCompare(b.date)),
    activities: ds.activities.filter((a) => !a.deletedAt).sort((a, b) => a.date.localeCompare(b.date)),
    entries: ds.entries.filter((e) => LOGGED_STATUSES.includes(e.status)).sort((a, b) => a.performedOn.localeCompare(b.performedOn)),
    patients: new Map(ds.patients.map((p) => [p.id, p])),
    rotations,
    requirements: new Map(ds.requirementSet.requirements.map((r) => [r.code, r])),
    latest,
    effLevel: (e) => effectiveLevel(e, latest),
    rotationCode: (id) => (id ? rotations.get(id)?.rotation ?? null : null),
  };
}
