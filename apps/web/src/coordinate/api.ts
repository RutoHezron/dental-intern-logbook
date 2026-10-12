import { fromWire, type ID, type Rotation, type SharedProgress } from '@logbook/core';
import type { Rpc } from '../supervise/api';

/** Coordinator cohort view: progress aggregates the interns chose to share. */

export async function loadCohort(rpc: Rpc): Promise<SharedProgress[]> {
  const rows = (await rpc('coordinator_cohort', {})) as Record<string, unknown>[];
  return rows.map((r) => {
    const s = fromWire<SharedProgress>(r);
    return {
      ...s,
      rotations: (s.rotations ?? []).map((x: Rotation) => ({ ...x, extendedByDays: x.extendedByDays ?? 0 })),
      counts: (s.counts ?? []).map((c) => ({ ...c, lastOn: c.lastOn ?? null })),
      assessments: (s.assessments ?? []).map((a) => ({ ...a, rotationId: a.rotationId ?? null, heldOn: a.heldOn ?? null, overallGrade: a.overallGrade ?? null, outcome: a.outcome ?? null })),
      caseReports: (s.caseReports ?? []).map((c) => ({ ...c, rotationId: c.rotationId ?? null })),
    };
  });
}

export async function createCoordinatorInvite(rpc: Rpc): Promise<{ code: string; expiresAt: string }> {
  return fromWire(await (rpc('create_coordinator_invite', {}) as Promise<Record<string, unknown>>));
}

export async function acceptCoordinatorInvite(rpc: Rpc, code: string): Promise<{ internName: string | null }> {
  return fromWire(await (rpc('accept_coordinator_invite', { p_code: code }) as Promise<Record<string, unknown>>));
}

export interface CoordinatorShare {
  id: ID;
  coordinatorEmail: string | null;
  createdAt: string;
}

export async function myShares(rpc: Rpc): Promise<CoordinatorShare[]> {
  return ((await rpc('my_coordinator_shares', {})) as Record<string, unknown>[]).map((r) => fromWire<CoordinatorShare>(r));
}

export async function revokeShare(rpc: Rpc, id: ID): Promise<void> {
  await rpc('revoke_coordinator_share', { p_share: id });
}
