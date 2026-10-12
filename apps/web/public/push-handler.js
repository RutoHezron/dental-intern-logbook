/* Push reminders, imported into the service worker (see vite.config.ts).
 * A reminder carries counts and an in-app link only. */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Logbook reminder', {
      body: data.body || 'Open your logbook.',
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: data.tag || 'logbook-daily',
      data: { url: typeof data.url === 'string' ? data.url : '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  // Only ever open this app.
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(target.href);
          return client.focus();
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
