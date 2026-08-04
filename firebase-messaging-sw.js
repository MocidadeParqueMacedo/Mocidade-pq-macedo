// firebase-messaging-sw.js
// ⚠️ Este arquivo deve estar na RAIZ do repositório GitHub (mesmo nível do index.html)

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCjU1jeWCFFeoDhCylj_rx_Eo5EwleU75c",
  authDomain: "mocidade-parque-macedo.firebaseapp.com",
  databaseURL: "https://mocidade-parque-macedo-default-rtdb.firebaseio.com",
  projectId: "mocidade-parque-macedo",
  storageBucket: "mocidade-parque-macedo.firebasestorage.app",
  messagingSenderId: "357935733252",
  appId: "1:357935733252:web:8e720ceb0c84caafddf351"
});

const messaging = firebase.messaging();

// Recebe notificação quando app está FECHADO ou em background
messaging.onBackgroundMessage(function(payload) {
  const notif  = payload.notification || {};
  const titulo = notif.title || '📅 Reunião de Jovens';
  const corpo  = notif.body  || '';
  const tag    = (payload.data && payload.data.tag) || 'evento';

  return self.registration.showNotification(titulo, {
    body: corpo,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: tag,
    requireInteraction: true,
    vibrate: [200, 100, 200],
    actions: [
      { action: 'abrir', title: '📱 Abrir app' },
      { action: 'fechar', title: 'Fechar' }
    ]
  });
});

// Clique na notificação → abre o app
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  if (e.action === 'fechar') return;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var c of clientList) {
        if (c.url.includes('mocidadeparquemacedo') && 'focus' in c) return c.focus();
      }
      return clients.openWindow('/');
    })
  );
});
