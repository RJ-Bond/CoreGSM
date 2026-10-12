// Minimal service worker: lets the browser offer "install app". Nothing is cached and requests are not intercepted: the panel is always live.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
