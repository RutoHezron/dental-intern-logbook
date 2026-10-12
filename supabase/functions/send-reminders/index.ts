// Daily reminder sender (Supabase Edge Function, Deno).
//
// Run once a day by a scheduled job (see docs/04-deployment.md). It asks the
// database which subscriptions have something to remind about today
// (push_due), sends each a counts-only notification, and reports back
// (push_report) so nobody gets more than one a day and dead subscriptions
// are removed.
//
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…),
// CRON_SECRET (the scheduled job sends it as a Bearer token).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';
import { sendAll, type DuePush } from './send.ts';

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing secret ${k}`);
  return v;
};

Deno.serve(async (req) => {
  if (req.headers.get('authorization') !== `Bearer ${env('CRON_SECRET')}`) {
    return new Response('Forbidden', { status: 403 });
  }
  webpush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

  const { data, error } = await db.rpc('push_due');
  if (error) return new Response(error.message, { status: 500 });
  const due = (data ?? []) as DuePush[];

  const outcome = await sendAll(due, (target, payload) => webpush.sendNotification(target, payload, { TTL: 12 * 3600, urgency: 'normal' }));
  const report = await db.rpc('push_report', { p_sent: outcome.sent, p_gone: outcome.gone, p_failed: outcome.failed });
  if (report.error) return new Response(report.error.message, { status: 500 });

  // Counts only: never log endpoints or notification text.
  return Response.json({ due: due.length, sent: outcome.sent.length, gone: outcome.gone.length, failed: outcome.failed.length });
});
