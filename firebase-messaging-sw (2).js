// firebase-messaging-sw.js — Web Push handler simples (sem Firebase SDK)
self.addEventListener('push', function(e) {
  var data = {};
  try { data = e.data.json(); } catch(_) {
    data = { title: e.data ? e.data.text() : 'Notificação' };
  }
  e.waitUntil(
    self.registration.showNotification(data.title || '📅 Reunião de Jovens', {
      body: data.body || '',
      icon: data.icon || 'https://mocidadeparquemacedo.github.io/Mocidade-pq-macedo/icon-192x192.png',
      requireInteraction: true,
      tag: data.tag || 'evento',
      vibrate: [200, 100, 200]
    })
  );
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  e.waitUntil(
    clients.openWindow('https://mocidadeparquemacedo.github.io/Mocidade-pq-macedo/')
  );
});
