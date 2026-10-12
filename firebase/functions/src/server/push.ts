import { createHash } from 'node:crypto';
import { addDaysISO, AppError, requireUser, type Ctx, type Row } from './context';
import type { DuePush } from '../../../../supabase/functions/send-reminders/send';

/**
 * Daily push reminders (port of migration 1100): counts and an in-app link
 * only, at most one per subscription per day. Subscriptions are stored by the
 * SHA-256 of their endpoint; only Cloud Functions can read them.
 */

const subRef = (ctx: Ctx, endpoint: string) => ctx.db.doc(`pushSubscriptions/${createHash('sha256').update(endpoint).digest('hex')}`);

export async function savePushSubscription(ctx: Ctx, endpoint: unknown, p256dh: unknown, auth: unknown) {
  const uid = requireUser(ctx, 'Sign in to turn on reminders');
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || typeof p256dh !== 'string' || typeof auth !== 'string') {
    throw new AppError('invalid-argument', 'Invalid subscription');
  }
  // An endpoint belongs to one browser; re-subscribing moves it to the current account.
  await subRef(ctx, endpoint).set({ owner_id: uid, endpoint, p256dh, auth_key: auth, created_at: ctx.now.toISOString(), last_sent_on: null, failures: 0 });
  return null;
}

export async function deletePushSubscription(ctx: Ctx, endpoint: unknown) {
  const uid = requireUser(ctx);
  if (typeof endpoint !== 'string') return null;
  const ref = subRef(ctx, endpoint);
  const snap = await ref.get();
  if (snap.exists && snap.data()!.owner_id === uid) await ref.delete();
  return null;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What a user should be reminded of today: counts only. */
export async function reminderDigest(ctx: Ctx, user: string, today: string): Promise<{ id: string; text: string; url: string }[]> {
  const items: { id: string; text: string; url: string }[] = [];
  const live = (rows: Row[]) => rows.filter((r) => !r.deleted_at);
  const q = async (table: string, field: string, value: unknown) => live((await ctx.db.collection(`users/${user}/${table}`).where(field, '==', value).get()).docs.map((d) => d.data() as Row));

  const returned = (await q('logbook_entry', 'status', 'returned')).length;
  if (returned) items.push({ id: 'returned', text: `${returned} logbook entr${plural(returned, 'y was', 'ies were')} returned by your supervisor. Fix and resubmit.`, url: '/logbook?status=returned' });

  const returnedReports = (await q('case_report', 'status', 'returned')).length;
  if (returnedReports) items.push({ id: 'returned-reports', text: `${returnedReports} case report${plural(returnedReports, ' was', 's were')} returned for revision.`, url: '/case-reports' });

  const waiting = await q('logbook_entry', 'status', 'submitted');
  const stale = waiting.filter((e) => String(e.performed_on) < addDaysISO(today, -7)).length;
  if (stale) items.push({ id: 'stale', text: `${stale} entr${plural(stale, 'y has', 'ies have')} waited more than a week for verification.`, url: '/sign-off' });

  const internships = live((await ctx.db.collection(`users/${user}/internship`).get()).docs.map((d) => d.data() as Row));
  const inInternship = internships.some((i) => String(i.period_from) <= today && today <= String(i.period_to));
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 Sunday
  if (inInternship && dow >= 2 && dow <= 5) {
    const recent = await ctx.db.collection(`users/${user}/logbook_entry`).where('performed_on', '>=', addDaysISO(today, -3)).limit(5).get();
    if (!recent.docs.some((d) => !d.data().deleted_at)) {
      items.push({ id: 'quiet', text: 'Nothing logged for a few days. Add your recent patients while you remember the details.', url: '/log' });
    }
  }

  // As a supervisor: items waiting for this user's verification.
  let toVerify = 0;
  for (const link of (await ctx.db.collection('supervisorLinks').where('user_id', '==', user).get()).docs) {
    const owner = link.data().owner_id as string;
    const sup = (await ctx.db.doc(`users/${owner}/supervisor/${link.id}`).get()).data();
    if (!sup || sup.deleted_at || sup.user_id !== user) continue;
    for (const table of ['logbook_entry', 'case_report']) {
      const rows = (await ctx.db.collection(`users/${owner}/${table}`).where('supervisor_id', '==', link.id).get()).docs.map((d) => d.data());
      toVerify += rows.filter((r) => r.status === 'submitted' && !r.deleted_at).length;
    }
  }
  if (toVerify) items.push({ id: 'to-verify', text: `${toVerify} item${plural(toVerify, ' is', 's are')} waiting for your verification.`, url: '/supervise' });
  return items;
}

/** Today's notifications, one per subscription not yet reminded today. */
export async function pushDue(ctx: Ctx, today: string): Promise<DuePush[]> {
  const subs = await ctx.db.collection('pushSubscriptions').get();
  const out: DuePush[] = [];
  const digests = new Map<string, Awaited<ReturnType<typeof reminderDigest>>>();
  for (const d of subs.docs) {
    const s = d.data();
    if (s.last_sent_on === today) continue;
    if (!digests.has(s.owner_id)) digests.set(s.owner_id, await reminderDigest(ctx, s.owner_id, today));
    const items = digests.get(s.owner_id)!;
    if (!items.length) continue;
    out.push({
      id: d.id,
      endpoint: s.endpoint,
      p256dh: s.p256dh,
      auth: s.auth_key,
      title: 'Logbook reminder',
      body: items.length === 1 ? items[0]!.text : `${items[0]!.text} (+${items.length - 1} more)`,
      url: items[0]!.url,
    });
  }
  return out;
}

export async function pushReport(ctx: Ctx, outcome: { sent: string[]; gone: string[]; failed: string[] }, today: string) {
  const batch = ctx.db.batch();
  for (const id of outcome.sent) batch.update(ctx.db.doc(`pushSubscriptions/${id}`), { last_sent_on: today, failures: 0 });
  for (const id of outcome.gone) batch.delete(ctx.db.doc(`pushSubscriptions/${id}`));
  await batch.commit();
  for (const id of outcome.failed) {
    const ref = ctx.db.doc(`pushSubscriptions/${id}`);
    const failures = (((await ref.get()).data()?.failures as number | undefined) ?? 0) + 1;
    if (failures >= 5) await ref.delete();
    else await ref.update({ failures });
  }
}
