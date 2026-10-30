// v3 - notificações + instalação do app (registrado para todos ao abrir o app)
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(clients.claim()); });

// Abertura das páginas: sempre busca da rede (versão mais nova); sem internet,
// usa a última cópia guardada. Necessário para o navegador oferecer "Instalar app".
// Chamadas ao banco (Supabase) e outros arquivos não passam por aqui.
var CACHE_PAGINAS = 'macedao-paginas-v1';
self.addEventListener('fetch', function(e) {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(
    fetch(e.request).then(function(resp) {
      if (resp && resp.ok) {
        var copia = resp.clone();
        caches.open(CACHE_PAGINAS).then(function(c) { c.put(e.request, copia); });
      }
      return resp;
    }).catch(function() {
      return caches.match(e.request).then(function(r) { return r || caches.match('./'); });
    })
  );
});

self.addEventListener('push', function(e) {
  var data = {};
  try { data = e.data.json(); } catch(_) {
    data = { title: e.data ? e.data.text() : 'Notificacao' };
  }
  // Nome real do ícone no repositório: icon-192x192.png
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

// Toque na notificação: traz o app para a frente se já estiver aberto; senão abre.
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = 'https://mocidadeparquemacedo.github.io/Mocidade-pq-macedo/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(lista) {
      for (var i = 0; i < lista.length; i++) {
        if (lista[i].url.indexOf('/Mocidade-pq-macedo/') !== -1 && 'focus' in lista[i]) return lista[i].focus();
      }
      return clients.openWindow(url);
    })
  );
});
