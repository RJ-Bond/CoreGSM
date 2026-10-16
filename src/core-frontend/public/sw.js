// Service worker: lets the browser offer "install app" and shows push notifications. Nothing is cached and
// requests are not intercepted: the panel is always live.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// a notification from the panel: { title, body, url, tag }
self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'CoreGSM', {
    body: m.body || '',
    icon: '/logo-192.png',
    badge: '/logo-128.png',
    tag: m.tag || undefined,
    renotify: !!m.tag,
    data: { url: m.url || '/' },
  }));
});

// a click opens the page of the notification: an open tab of the panel is reused
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of tabs) {
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
        await c.focus();
        if ('navigate' in c) await c.navigate(url).catch(() => undefined);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
