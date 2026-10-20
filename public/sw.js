// Офлайн-режим: сначала пробуем сеть (чтобы обновления приходили сразу), без сети отдаём сохранённую копию.
// При изменении файлов сайта увеличьте номер версии, чтобы старый кэш удалился.
const CACHE = 'hvostik-v35';
const SHELL = ['/', '/styles.css', '/app.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== self.location.origin || u.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok && !res.redirected) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('/') : Response.error())))
  );
});

// Напоминание с сервера: { title, body, tag }. iPhone требует показать уведомление на каждое сообщение.
self.addEventListener('push', event => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch (e) { /* пустое или битое сообщение */ }
  event.waitUntil(self.registration.showNotification(m.title || 'Хвостик', {
    body: m.body || 'Пора заглянуть в журнал питомцев',
    tag: m.tag || 'hvostik',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: '/' }
  }));
});

// Нажали на уведомление: открываем уже запущенный Хвостик или запускаем новый
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const open = list.find(c => new URL(c.url).origin === self.location.origin);
      if (open) return open.focus().then(c => c && c.navigate ? c.navigate('/#/') : c).catch(() => open);
      return self.clients.openWindow('/#/');
    })
  );
});
