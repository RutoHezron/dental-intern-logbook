import { AppError, iso, requireUser, type Ctx, type Row } from './context';
import { latestInternship } from './invites';

/**
 * Coordinator sharing (port of migration 1000). The coordinator never reads
 * an intern's records: coordinatorCohort returns counts per logbook code (from
 * statuses only a verification sets), rotation dates, whether each assessment
 * was held with its overall grade and outcome, and case-report statuses.
 */

export async function myCoordinatorShares(ctx: Ctx) {
  const uid = requireUser(ctx);
  const snap = await ctx.db.collection('coordinatorShares').where('owner_id', '==', uid).get();
  return snap.docs
    .map((d): Row => ({ ...(d.data() as Row), id: d.id }))
    .filter((s) => !s.revoked_at)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((s) => ({ id: s.id, coordinator_email: s.coordinator_email ?? null, created_at: s.created_at }));
}

export async function revokeCoordinatorShare(ctx: Ctx, shareId: unknown) {
  const uid = requireUser(ctx);
  const ref = ctx.db.doc(`coordinatorShares/${String(shareId ?? '_')}`);
  const snap = await ref.get();
  if (!snap.exists || snap.data()!.owner_id !== uid || snap.data()!.revoked_at) throw new AppError('not-found', 'Share not found');
  await ref.update({ revoked_at: iso(ctx.now) });
  return null;
}

export async function coordinatorCohort(ctx: Ctx) {
  const uid = requireUser(ctx, 'Sign in to view your cohort');
  const shares = (await ctx.db.collection('coordinatorShares').where('coordinator_id', '==', uid).get()).docs.map((d) => d.data() as Row).filter((s) => !s.revoked_at);
  const out: Row[] = [];
  for (const s of shares) {
    const owner = s.owner_id as string;
    const i = await latestInternship(ctx, owner);
    if (!i) continue;
    const of = async (table: string) => (await ctx.db.collection(`users/${owner}/${table}`).where('internship_id', '==', i.id).get()).docs.map((d) => d.data() as Row).filter((r) => !r.deleted_at);
    const facility = i.facility_id ? (await ctx.db.doc(`users/${owner}/facility/${i.facility_id}`).get()).data() : undefined;

    const counts = new Map<string, { code: string; logged: number; verified: number; pending: number; returned: number; last_on: string | null }>();
    for (const e of await of('logbook_entry')) {
      if (e.status === 'withdrawn') continue;
      const code = e.requirement_code as string;
      const c = counts.get(code) ?? { code, logged: 0, verified: 0, pending: 0, returned: 0, last_on: null };
      c.logged++;
      if (e.status === 'verified' || e.status === 'locked') c.verified++;
      else c.pending++;
      if (e.status === 'returned') c.returned++;
      if (!c.last_on || String(e.performed_on) > c.last_on) c.last_on = e.performed_on as string;
      counts.set(code, c);
    }

    out.push({
      owner_id: owner,
      shared_at: s.created_at,
      intern_name: i.intern_name,
      licence_no: i.licence_no ?? null,
      institution: i.institution ?? null,
      facility_name: facility?.name ?? null,
      period_from: i.period_from,
      period_to: i.period_to,
      rotations: (await of('rotation'))
        .sort((a, b) => String(a.starts_on).localeCompare(String(b.starts_on)))
        .map((r) => ({ id: r.id, internship_id: r.internship_id, rotation: r.rotation, starts_on: r.starts_on, ends_on: r.ends_on, extended_by_days: r.extended_by_days ?? 0, outcome: r.outcome ?? null })),
      counts: [...counts.values()],
      assessments: (await of('assessment')).map((a) => ({
        rotation_id: a.rotation_id ?? null,
        kind: a.kind,
        sequence: a.sequence ?? 1,
        held_on: a.held_on ?? null,
        overall_grade: a.overall_grade ?? null,
        outcome: a.outcome ?? null,
      })),
      case_reports: (await of('case_report')).map((c) => ({ rotation_id: c.rotation_id ?? null, status: c.status })),
    });
  }
  return out.sort((a, b) => String(a.intern_name).localeCompare(String(b.intern_name)));
}
