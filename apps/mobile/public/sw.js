/**
 * Web-push service worker (OH-223; docs/notifications-deep-link-format.md § web
 * push). v1 delivery is an EMPTY tickle — no payload to render or route by — so
 * this worker shows a generic notification (required: the subscription is
 * `userVisibleOnly`) and a click focuses (or opens) the app; the email/SMS/push
 * channels carry the real deep link. Served from apps/mobile/public/ at /sw.js
 * (Expo web static output copies public/ to the site root).
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('Our Haven', {
      body: 'You have new activity in Our Haven.',
      icon: '/favicon.ico',
      tag: 'our-haven-tickle', // collapse repeated tickles into one notification
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((w) => 'focus' in w);
      return existing ? existing.focus() : self.clients.openWindow('/');
    }),
  );
});
