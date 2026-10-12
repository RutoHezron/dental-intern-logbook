import { createHash, randomBytes } from 'node:crypto';
import { AppError, iso, requireUser, rowRef, userRef, type Ctx, type Row } from './context';

/**
 * One-time invite codes (supervisor accounts and coordinator sharing), ported
 * from migrations 0900 and 1000: twelve characters from a 32-letter alphabet
 * without look-alikes (60 bits), shown as XXXX-XXXX-XXXX, single use, valid
 * for seven days. Only the SHA-256 of the code is stored (as the document id).
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const VALID_DAYS = 7;

export function newCode(): string {
  const bytes = randomBytes(12);
  return [...bytes].map((b) => ALPHABET[b % 32]).join('');
}

export const inviteHash = (code: string) =>
  createHash('sha256')
    .update(String(code).toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .digest('hex');

export const formatCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;

const inviteRef = (ctx: Ctx, hash: string) => ctx.db.doc(`invites/${hash}`);
/** Each intern's open invites, so a new one cancels the previous one. */
const openInvitesRef = (ctx: Ctx, owner: string) => ctx.db.doc(`users/${owner}/meta/invites`);
/** Supervisor record → account link, queried by the supervisor's account. */
export const linkRef = (ctx: Ctx, supervisorId: string) => ctx.db.doc(`supervisorLinks/${supervisorId}`);

export async function latestInternship(ctx: Ctx, owner: string): Promise<Row | null> {
  const snap = await ctx.db.collection(`users/${owner}/internship`).get();
  const live = snap.docs.map((d) => d.data() as Row).filter((i) => !i.deleted_at);
  live.sort((a, b) => String(b.period_from).localeCompare(String(a.period_from)));
  return live[0] ?? null;
}

async function createInvite(ctx: Ctx, owner: string, kind: 'supervisor' | 'coordinator', supervisorId: string | null) {
  const code = newCode();
  const hash = inviteHash(code);
  const expiresAt = new Date(ctx.now.getTime() + VALID_DAYS * 86_400_000);
  const slot = kind === 'supervisor' ? `supervisor:${supervisorId}` : 'coordinator';
  await ctx.db.runTransaction(async (tx) => {
    const open = (await tx.get(openInvitesRef(ctx, owner))).data() ?? {};
    const previous = open[slot] as string | undefined;
    if (previous) {
      const prev = await tx.get(inviteRef(ctx, previous));
      if (prev.exists && !prev.data()!.accepted_at) tx.delete(prev.ref);
    }
    tx.set(inviteRef(ctx, hash), {
      kind,
      owner_id: owner,
      supervisor_id: supervisorId,
      created_at: iso(ctx.now),
      expires_at: iso(expiresAt),
      accepted_at: null,
      accepted_by: null,
    });
    tx.set(openInvitesRef(ctx, owner), { [slot]: hash }, { merge: true });
  });
  return { code: formatCode(code), expires_at: iso(expiresAt) };
}

export async function createSupervisorInvite(ctx: Ctx, supervisorId: unknown) {
  const uid = requireUser(ctx, 'Sign in to invite a supervisor');
  const sup = typeof supervisorId === 'string' ? await rowRef(ctx, uid, 'supervisor', supervisorId).get() : null;
  if (!sup?.exists || sup.data()!.deleted_at) throw new AppError('not-found', 'Sync your logbook first: this supervisor is not on the server yet');
  return createInvite(ctx, uid, 'supervisor', supervisorId as string);
}

export async function createCoordinatorInvite(ctx: Ctx) {
  const uid = requireUser(ctx, 'Sign in to share your progress');
  if (!(await latestInternship(ctx, uid))) throw new AppError('not-found', 'Sync your logbook first: there is no internship on the server yet');
  return createInvite(ctx, uid, 'coordinator', null);
}

/** Validates and consumes an invite inside the caller's transaction. */
async function takeInvite(ctx: Ctx, tx: FirebaseFirestore.Transaction, code: unknown, kind: 'supervisor' | 'coordinator', selfMessage: string) {
  const ref = inviteRef(ctx, inviteHash(String(code ?? '')));
  const snap = await tx.get(ref);
  const inv = snap.data();
  if (!snap.exists || !inv || inv.kind !== kind || inv.accepted_at || String(inv.expires_at) < iso(ctx.now)) {
    throw new AppError('not-found', 'This invite code is not valid. Ask the intern for a new one.');
  }
  if (inv.owner_id === ctx.uid) throw new AppError('permission-denied', selfMessage);
  return { ref, inv };
}

export async function acceptSupervisorInvite(ctx: Ctx, code: unknown) {
  const uid = requireUser(ctx, 'Sign in to accept the invite');
  const out = await ctx.db.runTransaction(async (tx) => {
    const { ref, inv } = await takeInvite(ctx, tx, code, 'supervisor', 'You cannot supervise your own logbook.');
    const owner = inv.owner_id as string;
    const supRef = rowRef(ctx, owner, 'supervisor', inv.supervisor_id as string);
    const sup = await tx.get(supRef);
    const counter = await tx.get(userRef(ctx, owner));
    if (!sup.exists) throw new AppError('not-found', 'This invite code is not valid. Ask the intern for a new one.');
    const seq = ((counter.data()?.seq as number | undefined) ?? 0) + 1;
    // The supervisor row changes, so the intern's phone pulls the link.
    tx.set(supRef, { user_id: uid, linked_at: iso(ctx.now), server_seq: seq, server_received_at: iso(ctx.now) }, { merge: true });
    tx.set(userRef(ctx, owner), { seq }, { merge: true });
    tx.set(linkRef(ctx, supRef.id), { user_id: uid, owner_id: owner, supervisor_id: supRef.id, linked_at: iso(ctx.now) });
    tx.update(ref, { accepted_at: iso(ctx.now), accepted_by: uid });
    return { owner, supervisorName: sup.data()!.name as string, supervisorId: supRef.id };
  });
  const internship = await latestInternship(ctx, out.owner);
  return { supervisor_id: out.supervisorId, supervisor_name: out.supervisorName, intern_name: (internship?.intern_name as string) ?? null };
}

export async function unlinkSupervisorAccount(ctx: Ctx, supervisorId: unknown) {
  const uid = requireUser(ctx);
  if (typeof supervisorId !== 'string') throw new AppError('not-found', 'Supervisor not found');
  await ctx.db.runTransaction(async (tx) => {
    const supRef = rowRef(ctx, uid, 'supervisor', supervisorId);
    const sup = await tx.get(supRef);
    const counter = await tx.get(userRef(ctx, uid));
    if (!sup.exists) throw new AppError('not-found', 'Supervisor not found');
    const seq = ((counter.data()?.seq as number | undefined) ?? 0) + 1;
    tx.set(supRef, { user_id: null, linked_at: null, server_seq: seq, server_received_at: iso(ctx.now) }, { merge: true });
    tx.set(userRef(ctx, uid), { seq }, { merge: true });
    tx.delete(linkRef(ctx, supervisorId));
  });
  return null;
}

export async function acceptCoordinatorInvite(ctx: Ctx, code: unknown) {
  const uid = requireUser(ctx, 'Sign in to accept the invite');
  const owner = await ctx.db.runTransaction(async (tx) => {
    const { ref, inv } = await takeInvite(ctx, tx, code, 'coordinator', 'You cannot coordinate your own logbook.');
    const owner = inv.owner_id as string;
    const shareRef = ctx.db.doc(`coordinatorShares/${owner}_${uid}`);
    const existing = await tx.get(shareRef);
    if (!existing.exists || existing.data()!.revoked_at) {
      tx.set(shareRef, { owner_id: owner, coordinator_id: uid, coordinator_email: ctx.email ?? null, created_at: iso(ctx.now), revoked_at: null });
    }
    tx.update(ref, { accepted_at: iso(ctx.now), accepted_by: uid });
    return owner;
  });
  const internship = await latestInternship(ctx, owner);
  return { intern_name: (internship?.intern_name as string) ?? null };
}
