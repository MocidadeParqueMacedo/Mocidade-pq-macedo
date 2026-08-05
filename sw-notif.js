// v2 - com icone e skipWaiting
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(clients.claim()); });

self.addEventListener('push', function(e) {
  var data = {};
  try { data = e.data.json(); } catch(_) {
    data = { title: e.data ? e.data.text() : 'Notificacao' };
  }
  var iconUrl = 'https://mocidadeparquemacedo.github.io/Mocidade-pq-macedo/icon-192x192.png';
  e.waitUntil(
    self.registration.showNotification(data.title || 'Reuniao de Jovens', {
      body: data.body || '',
      icon: iconUrl,
      badge: iconUrl,
      requireInteraction: true,
      tag: data.tag || 'evento',
      vibrate: [200, 100, 200]
    })
  );
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  e.waitUntil(clients.openWindow('https://mocidadeparquemacedo.github.io/Mocidade-pq-macedo/'));
});
