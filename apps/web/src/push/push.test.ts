import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { base64UrlToBytes, disablePush, enablePush } from './push';

/** Opt-in push: permission, subscription saved to the account, and the service-worker handler. */

function mockPush(permission: NotificationPermission) {
  const sub = {
    endpoint: 'https://push.example.org/abc',
    toJSON: () => ({ endpoint: 'https://push.example.org/abc', keys: { p256dh: 'P256', auth: 'AUTH' } }),
    unsubscribe: vi.fn(async () => true),
  };
  let current: typeof sub | null = null;
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => (current = sub)),
  };
  vi.stubGlobal('Notification', { requestPermission: vi.fn(async () => permission) });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ pushManager }) } });
  return { pushManager, sub };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('push opt-in', () => {
  it('decodes the URL-safe base64 VAPID key', () => {
    expect([...base64UrlToBytes('AQID_-8')]).toEqual([1, 2, 3, 255, 239]);
  });

  it('asks permission, subscribes, and saves only endpoint and keys to the account', async () => {
    const { pushManager } = mockPush('granted');
    const rpc = vi.fn(async () => null);
    await enablePush(rpc);
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(rpc).toHaveBeenCalledWith('save_push_subscription', { p_endpoint: 'https://push.example.org/abc', p_p256dh: 'P256', p_auth: 'AUTH' });
  });

  it('explains how to fix blocked notifications, and saves nothing', async () => {
    const { pushManager } = mockPush('denied');
    const rpc = vi.fn(async () => null);
    await expect(enablePush(rpc)).rejects.toThrow(/blocked for this site/);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('turning off removes the subscription from the account and the browser', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'AQID');
    vi.stubGlobal('PushManager', function PushManager() {});
    const { sub } = mockPush('granted');
    const rpc = vi.fn(async () => null);
    await enablePush(rpc);
    await disablePush(rpc);
    expect(rpc).toHaveBeenLastCalledWith('delete_push_subscription', { p_endpoint: 'https://push.example.org/abc' });
    expect(sub.unsubscribe).toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe('service worker push handler', () => {
  function loadHandler() {
    const handlers: Record<string, (e: unknown) => void> = {};
    const showNotification = vi.fn(async () => undefined);
    const focus = vi.fn(async () => undefined);
    const navigate = vi.fn(async () => undefined);
    const openWindow = vi.fn(async () => undefined);
    const self = {
      addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
      registration: { showNotification },
      location: { origin: 'https://logbook.example.org' },
      clients: { matchAll: vi.fn(async () => [{ focus, navigate }]), openWindow },
    };
    const code = readFileSync(join(__dirname, '../../public/push-handler.js'), 'utf8');
    new Function('self', code)(self);
    return { handlers, showNotification, focus, navigate, openWindow };
  }

  it('shows the counts-only reminder it was sent', async () => {
    const h = loadHandler();
    let waited: Promise<unknown> | undefined;
    h.handlers.push!({ data: { json: () => ({ title: 'Logbook reminder', body: '2 entries were returned.', url: '/logbook?status=returned' }) }, waitUntil: (p: Promise<unknown>) => (waited = p) });
    await waited;
    expect(h.showNotification).toHaveBeenCalledWith('Logbook reminder', expect.objectContaining({ body: '2 entries were returned.', data: { url: '/logbook?status=returned' } }));
  });

  it('opens the in-app page on tap, and never another site', async () => {
    const h = loadHandler();
    let waited: Promise<unknown> | undefined;
    const close = vi.fn();
    h.handlers.notificationclick!({ notification: { close, data: { url: '/sign-off' } }, waitUntil: (p: Promise<unknown>) => (waited = p) });
    await waited;
    expect(h.navigate).toHaveBeenCalledWith('https://logbook.example.org/sign-off');
    expect(h.focus).toHaveBeenCalled();

    waited = undefined;
    h.handlers.notificationclick!({ notification: { close, data: { url: 'https://evil.example/x' } }, waitUntil: (p: Promise<unknown>) => (waited = p) });
    expect(waited).toBeUndefined();
    expect(h.openWindow).not.toHaveBeenCalled();
  });
});
