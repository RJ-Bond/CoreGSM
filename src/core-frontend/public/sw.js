// Service worker: lets the browser offer "install app", shows push notifications and, when the network is gone, shows a
// small offline page instead of the browser's error. Nothing else is cached: the panel is always live.
const OFFLINE = '/offline.html';
const CACHE = 'coregsm-offline-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE)).catch(() => undefined).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// only page navigations are intercepted, and only to answer with the offline page when the network fails
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(async () => (await caches.match(OFFLINE)) || Response.error()));
});

// a notification from the panel: { title, body, url, tag, actions }
self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data ? e.data.text() : '' }; }
  if (!m || typeof m !== 'object') m = {};
  // up to two buttons: { action, title, url }; the browser shows them where it can, the click goes to the address of the pressed one
  const buttons = Array.isArray(m.actions) ? m.actions.filter((a) => a && typeof a.action === 'string' && typeof a.title === 'string' && typeof a.url === 'string').slice(0, 2) : [];
  const urls = {};
  for (const a of buttons) urls[a.action] = a.url;
  e.waitUntil(self.registration.showNotification(String(m.title || 'CoreGSM'), {
    body: String(m.body || ''),
    icon: '/logo-192.png',
    badge: '/logo-128.png',
    tag: m.tag ? String(m.tag) : undefined,
    renotify: !!m.tag,
    actions: buttons.map((a) => ({ action: a.action, title: a.title })),
    data: { url: typeof m.url === 'string' ? m.url : '/', urls },
  }));
});

// the address of a notification must stay on the panel's own origin: anything else opens the start page
const safeUrl = (raw) => {
  try {
    const u = new URL(raw || '/', self.location.origin);
    return u.origin === self.location.origin ? u.href : self.location.origin + '/';
  } catch { return self.location.origin + '/'; }
};

// a click opens the page of the notification: an open tab of the panel is reused
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  // a pressed button has its own address; a press on the notification itself opens the main one
  const url = safeUrl((e.action && d.urls && d.urls[e.action]) || d.url);
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of tabs) {
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
        await c.focus();
        if ('navigate' in c) await c.navigate(url).catch(() => undefined);
        return;
      }
    }
    await self.clients.openWindow(url).catch(() => undefined);
  })());
});

// the browser renewed or dropped the push subscription: subscribe again with the panel's key and tell the panel
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    try {
      const { publicKey } = await (await fetch('/api/push/key')).json();
      const pad = '='.repeat((4 - (publicKey.length % 4)) % 4);
      const raw = atob((publicKey + pad).replace(/-/g, '+').replace(/_/g, '/'));
      const key = Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      // the panel stores subscriptions per signed-in user: an open tab does that with the user's session
      for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage({ type: 'push-resubscribe', subscription: sub.toJSON() });
    } catch { /* the panel offers to subscribe again on the next visit */ }
  })());
});
