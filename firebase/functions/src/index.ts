import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret, defineString } from 'firebase-functions/params';
import webpush from 'web-push';
import { sendAll } from '../../../supabase/functions/send-reminders/send';
import { AppError, type Ctx } from './server/context';
import { coordinatorCohort, myCoordinatorShares, revokeCoordinatorShare } from './server/coordinator';
import { acceptCoordinatorInvite, acceptSupervisorInvite, createCoordinatorInvite, createSupervisorInvite, unlinkSupervisorAccount } from './server/invites';
import { deletePushSubscription, pushDue, pushReport, savePushSubscription } from './server/push';
import { supervisorQueue, supervisorSign } from './server/supervisor';
import { syncPull, syncPush } from './server/sync';

/**
 * Firebase backend for the logbook. Every function is a callable: the app
 * calls it signed in (Firebase Auth), and Firestore itself is closed to
 * clients (firestore.rules denies all), so these functions are the only way
 * in — the same model as the Postgres RPCs they port.
 */

initializeApp();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

const REGION = defineString('REGION', { default: 'africa-south1' });
setGlobalOptions({ region: REGION, maxInstances: 10 });

type Handler = (ctx: Ctx, data: Record<string, unknown>) => Promise<unknown>;

function callable(fn: Handler) {
  return onCall({ enforceAppCheck: false }, async (req: CallableRequest<Record<string, unknown>>) => {
    const ctx: Ctx = { db, uid: req.auth?.uid ?? null, email: (req.auth?.token.email as string | undefined) ?? null, now: new Date() };
    try {
      return await fn(ctx, req.data ?? {});
    } catch (err) {
      if (err instanceof AppError) throw new HttpsError(err.code, err.message);
      throw err;
    }
  });
}

// Names match the Postgres functions in camelCase; the app maps one to the other.
export const syncPushFn = callable((c, d) => syncPush(c, d.changes));
export const syncPullFn = callable((c, d) => syncPull(c, d.since));
export const createSupervisorInviteFn = callable((c, d) => createSupervisorInvite(c, d.p_supervisor));
export const acceptSupervisorInviteFn = callable((c, d) => acceptSupervisorInvite(c, d.p_code));
export const unlinkSupervisorAccountFn = callable((c, d) => unlinkSupervisorAccount(c, d.p_supervisor));
export const supervisorQueueFn = callable((c) => supervisorQueue(c));
export const supervisorSignFn = callable((c, d) => supervisorSign(c, d.p_records));
export const createCoordinatorInviteFn = callable((c) => createCoordinatorInvite(c));
export const acceptCoordinatorInviteFn = callable((c, d) => acceptCoordinatorInvite(c, d.p_code));
export const myCoordinatorSharesFn = callable((c) => myCoordinatorShares(c));
export const revokeCoordinatorShareFn = callable((c, d) => revokeCoordinatorShare(c, d.p_share));
export const coordinatorCohortFn = callable((c) => coordinatorCohort(c));
export const savePushSubscriptionFn = callable((c, d) => savePushSubscription(c, d.p_endpoint, d.p_p256dh, d.p_auth));
export const deletePushSubscriptionFn = callable((c, d) => deletePushSubscription(c, d.p_endpoint));

const VAPID_PUBLIC_KEY = defineString('VAPID_PUBLIC_KEY', { default: '' });
const VAPID_SUBJECT = defineString('VAPID_SUBJECT', { default: 'mailto:rutohezron28@gmail.com' });
const VAPID_PRIVATE_KEY = defineSecret('VAPID_PRIVATE_KEY');

/** Daily reminders at 15:00 in Kenya. Logs counts only. */
export const sendReminders = onSchedule({ schedule: '0 15 * * *', timeZone: 'Africa/Nairobi', secrets: [VAPID_PRIVATE_KEY] }, async () => {
  if (!VAPID_PUBLIC_KEY.value()) {
    console.log('Reminders are not configured (no VAPID key).');
    return;
  }
  webpush.setVapidDetails(VAPID_SUBJECT.value(), VAPID_PUBLIC_KEY.value(), VAPID_PRIVATE_KEY.value());
  const ctx: Ctx = { db, uid: null, now: new Date() };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(ctx.now);
  const due = await pushDue(ctx, today);
  const outcome = await sendAll(due, (target, payload) => webpush.sendNotification(target, payload, { TTL: 12 * 3600, urgency: 'normal' }));
  await pushReport(ctx, outcome, today);
  console.log(JSON.stringify({ due: due.length, sent: outcome.sent.length, gone: outcome.gone.length, failed: outcome.failed.length }));
});
