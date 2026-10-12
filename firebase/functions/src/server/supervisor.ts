import type { DocumentReference } from 'firebase-admin/firestore';
import { AppError, iso, requireUser, rowRef, userRef, type Ctx, type Row } from './context';
import { latestInternship, linkRef } from './invites';

/**
 * Supervisor accounts (port of migration 0900): a linked supervisor reads only
 * what was submitted to them, and signs on their own chain. The chain head is
 * kept in users/{owner}/chains/{supervisorId}; signing runs in a transaction,
 * so a record that does not extend the current head is refused (chain_moved)
 * and two devices can never fork the chain.
 */

interface Link {
  owner: string;
  supervisorId: string;
  supervisor: Row;
}

async function myLinks(ctx: Ctx, uid: string): Promise<Link[]> {
  const snap = await ctx.db.collection('supervisorLinks').where('user_id', '==', uid).get();
  const out: Link[] = [];
  for (const d of snap.docs) {
    const owner = d.data().owner_id as string;
    const sup = await rowRef(ctx, owner, 'supervisor', d.id).get();
    const s = sup.data();
    if (s && !s.deleted_at && s.user_id === uid) out.push({ owner, supervisorId: d.id, supervisor: s });
  }
  return out;
}

const chainRef = (ctx: Ctx, owner: string, supervisorId: string) => ctx.db.doc(`users/${owner}/chains/${supervisorId}`);

export async function supervisorQueue(ctx: Ctx) {
  const uid = requireUser(ctx, 'Sign in to review');
  const links = await myLinks(ctx, uid);
  const outLinks: Row[] = [];
  const entries: Row[] = [];
  const reports: Row[] = [];
  for (const l of links) {
    const internship = await latestInternship(ctx, l.owner);
    const tip = (await chainRef(ctx, l.owner, l.supervisorId).get()).data();
    outLinks.push({
      supervisor_id: l.supervisorId,
      owner_id: l.owner,
      supervisor_name: l.supervisor.name,
      intern_name: internship?.intern_name ?? null,
      licence_no: internship?.licence_no ?? null,
      institution: internship?.institution ?? null,
      tip: tip ? { id: tip.id, hash: tip.hash, signed_at: tip.signed_at } : null,
    });

    const rotations = new Map((await ctx.db.collection(`users/${l.owner}/rotation`).get()).docs.map((d) => [d.id, d.data().rotation as string]));
    const entrySnap = await ctx.db.collection(`users/${l.owner}/logbook_entry`).where('supervisor_id', '==', l.supervisorId).get();
    for (const d of entrySnap.docs) {
      const e = d.data() as Row;
      if (e.status !== 'submitted' || e.deleted_at) continue;
      const row: Row = { ...e, rotation: rotations.get(e.rotation_id as string) ?? null };
      if (e.encounter_id) {
        const enc = (await rowRef(ctx, l.owner, 'encounter', e.encounter_id as string).get()).data();
        if (enc) {
          row.visit = {
            time: enc.time ?? undefined,
            visit_type: enc.visit_type ?? undefined,
            setting: enc.setting ?? undefined,
            procedures: ((enc.procedures as Row[] | undefined) ?? []).map((p) => ({
              id: p.id,
              procedure_type_id: p.procedure_type_id,
              sites: p.sites,
              stage: p.stage ?? undefined,
              level: p.level,
              other_name: p.other_name ?? undefined,
            })),
            diagnoses: ((enc.findings as Row[] | undefined) ?? []).filter((f) => f.is_diagnosis).map((f) => `${f.term}${f.site ? ` (${f.site})` : ''}`),
          };
        }
      }
      if (e.activity_id) {
        const a = (await rowRef(ctx, l.owner, 'activity', e.activity_id as string).get()).data();
        if (a) row.activity = { activity_type_id: a.activity_type_id, title: a.title ?? undefined };
      }
      entries.push(row);
    }
    const reportSnap = await ctx.db.collection(`users/${l.owner}/case_report`).where('supervisor_id', '==', l.supervisorId).get();
    for (const d of reportSnap.docs) {
      const { patient_id: _omit, ...r } = d.data() as Row;
      if (r.status === 'submitted' && !r.deleted_at) reports.push(r);
    }
  }
  const byDate = (a: Row, b: Row, k: string) => String(a[k]).localeCompare(String(b[k])) || String(a.id).localeCompare(String(b.id));
  entries.sort((a, b) => byDate(a, b, 'performed_on'));
  reports.sort((a, b) => byDate(a, b, 'date'));
  outLinks.sort((a, b) => String(a.intern_name).localeCompare(String(b.intern_name)));
  return { links: outLinks, entries, case_reports: reports };
}

export async function supervisorSign(ctx: Ctx, records: unknown) {
  const uid = requireUser(ctx, 'Sign in to sign');
  if (!Array.isArray(records) || records.length === 0) throw new AppError('invalid-argument', 'Nothing to sign');
  if (records.length > 200) throw new AppError('invalid-argument', 'Sign at most 200 items at a time');
  const recs = records as Row[];

  return ctx.db.runTransaction(async (tx) => {
    // ---- reads ----
    const links = new Map<string, { owner: string; sup: Row } | null>();
    for (const r of recs) {
      const sid = String(r.verifier_id ?? '');
      if (links.has(sid)) continue;
      const link = sid ? (await tx.get(linkRef(ctx, sid))).data() : undefined;
      if (!link || link.user_id !== uid) {
        links.set(sid, null);
        continue;
      }
      const sup = (await tx.get(rowRef(ctx, link.owner_id, 'supervisor', sid))).data();
      links.set(sid, sup && !sup.deleted_at && sup.user_id === uid ? { owner: link.owner_id, sup } : null);
    }
    const targets = new Map<string, { ref: DocumentReference; row: Row | undefined }>();
    const chains = new Map<string, Row | null>();
    const counters = new Map<string, number>();
    for (const r of recs) {
      const link = links.get(String(r.verifier_id ?? ''));
      if (!link) throw new AppError('permission-denied', 'You are not linked as this supervisor');
      const table = r.entry_id != null && r.case_report_id == null ? 'logbook_entry' : r.case_report_id != null && r.entry_id == null ? 'case_report' : null;
      if (!table) throw new AppError('invalid-argument', 'A sign-off needs exactly one entry or case report');
      const ref = rowRef(ctx, link.owner, table, String(r.entry_id ?? r.case_report_id));
      if (!targets.has(ref.path)) targets.set(ref.path, { ref, row: (await tx.get(ref)).data() as Row | undefined });
      const ck = chainRef(ctx, link.owner, String(r.verifier_id)).path;
      if (!chains.has(ck)) chains.set(ck, ((await tx.get(ctx.db.doc(ck))).data() as Row | undefined) ?? null);
      if (!counters.has(link.owner)) counters.set(link.owner, ((await tx.get(userRef(ctx, link.owner))).data()?.seq as number | undefined) ?? 0);
    }

    // ---- checks, in order, chaining in memory ----
    const writes: { ref: DocumentReference; data: Row }[] = [];
    for (const r of recs) {
      const sid = String(r.verifier_id);
      const { owner } = links.get(sid)!;
      if (r.method !== 'account') throw new AppError('invalid-argument', 'Account sign-offs only');
      const table = r.entry_id != null ? 'logbook_entry' : 'case_report';
      const targetId = String(r.entry_id ?? r.case_report_id);
      const target = targets.get(rowRef(ctx, owner, table, targetId).path)!;
      if (!target.row || target.row.deleted_at || target.row.supervisor_id !== sid) throw new AppError('permission-denied', 'This item was not submitted to you');
      if (target.row.status !== 'submitted') throw new AppError('failed-precondition', `stale: ${targetId} is no longer awaiting verification`);

      const ck = chainRef(ctx, owner, sid).path;
      const tip = chains.get(ck) ?? null;
      if ((r.prev_hash ?? null) !== ((tip?.hash as string | undefined) ?? null)) {
        throw new AppError('failed-precondition', `chain_moved: the chain head is now ${(tip?.hash as string | undefined) ?? 'empty'}`);
      }
      const signed = Date.parse(String(r.signed_at));
      if (!Number.isFinite(signed)) throw new AppError('invalid-argument', 'Invalid signing time');
      if (tip && signed <= Date.parse(String(tip.signed_at))) throw new AppError('failed-precondition', 'chain_moved: a sign-off must be later than the chain head');
      if (signed > ctx.now.getTime() + 10 * 60_000 || signed < ctx.now.getTime() - 86_400_000) {
        throw new AppError('invalid-argument', "Check this device's clock: the signing time is not plausible");
      }
      if (typeof r.hash !== 'string' || !/^[0-9a-f]{64}$/.test(r.hash)) throw new AppError('invalid-argument', 'Invalid hash');
      if (!['verified', 'returned'].includes(r.decision as string)) throw new AppError('invalid-argument', 'invalid decision');
      if (r.decision === 'returned' && !(typeof r.comment === 'string' && r.comment.trim())) throw new AppError('invalid-argument', 'A returned decision needs a comment');

      const seq = counters.get(owner)! + 1;
      counters.set(owner, seq + 1);
      const now = iso(ctx.now);
      const v: Row = {
        id: r.id,
        owner_id: owner,
        entry_id: r.entry_id ?? null,
        case_report_id: r.case_report_id ?? null,
        verifier_id: sid,
        decision: r.decision,
        level_observed: r.level_observed ?? null,
        comment: (r.comment as string | undefined) || null,
        method: 'account',
        signed_at: r.signed_at,
        prev_hash: r.prev_hash ?? null,
        hash: r.hash,
        server_seq: seq,
        server_received_at: now,
      };
      writes.push({ ref: rowRef(ctx, owner, 'verification', String(r.id)), data: v });
      target.row = { ...target.row, status: r.decision === 'verified' ? 'verified' : 'returned', server_seq: seq + 1, server_received_at: now };
      chains.set(ck, { id: r.id, hash: r.hash, signed_at: r.signed_at });
    }

    // ---- writes ----
    for (const w of writes) tx.create(w.ref, w.data);
    for (const t of targets.values()) if (t.row) tx.set(t.ref, t.row);
    for (const [path, tip] of chains) if (tip) tx.set(ctx.db.doc(path), tip);
    for (const [owner, seq] of counters) tx.set(userRef(ctx, owner), { seq }, { merge: true });
    return { signed: writes.length };
  });
}
