import { isNative } from '../storage/device';
import type { Rpc } from '../supervise/api';

/**
 * Daily push reminders on this device (opt-in). The server sends at most one
 * a day, with counts and an in-app link only. Needs a signed-in account, a
 * browser with Push API support, and the server's public VAPID key. The
 * Android app's WebView has no web push, so it relies on in-app reminders.
 */

/** The server's public VAPID key, from the build configuration. */
export const vapidPublicKey = (): string => (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '';

export function pushSupported(): boolean {
  return (
    Boolean(vapidPublicKey()) &&
    !isNative &&
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** VAPID keys are URL-safe base64; the Push API wants bytes. */
export function base64UrlToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
  ]);
  if (!reg) throw new Error('Reminders need the installed app (service worker). Reload the page and try again.');
  return reg;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  return (await registration()).pushManager.getSubscription();
}

export async function enablePush(rpc: Rpc): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications are blocked for this site. Allow them in the browser’s site settings, then try again.');
  }
  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(vapidPublicKey()) as BufferSource }));
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('The browser returned an incomplete subscription.');
  await rpc('save_push_subscription', { p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth });
}

export async function disablePush(rpc: Rpc): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}
