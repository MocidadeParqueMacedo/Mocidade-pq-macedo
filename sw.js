// ══════════════════════════════════════════════
//  Macedão – Service Worker
//  Estratégia: Cache-first para assets estáticos
//              Network-first para Firebase/dados
// ══════════════════════════════════════════════

const CACHE_NAME = 'macedao-v1';
const CACHE_VERSION = 1;

// Arquivos que ficam em cache (shell do app)
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  './icons/apple-touch-icon.png',
  // Chart.js e plugins (CDN)
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/chartjs-plugin-datalabels/2.2.0/chartjs-plugin-datalabels.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
];

// Domínios que NUNCA devem ser interceptados (Firebase, auth, etc.)
const BYPASS_DOMAINS = [
  'firebaseio.com',
  'firebasestorage.app',
  'firebaseapp.com',
  'gstatic.com',
  'googleapis.com',
];

// ── INSTALL ──────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando Macedão v' + CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Adiciona um por um para não quebrar tudo se um CDN falhar
      return Promise.allSettled(
        STATIC_ASSETS.map((url) => cache.add(url).catch(() => null))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Ativando Macedão v' + CACHE_VERSION);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] Removendo cache antigo:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignora requisições não-GET
  if (event.request.method !== 'GET') return;

  // Ignora domínios do Firebase e Google (sempre online)
  if (BYPASS_DOMAINS.some((d) => url.hostname.includes(d))) return;

  // Ignora extensões de browser
  if (url.protocol === 'chrome-extension:') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      // Cache-first: retorna do cache se existir
      if (cached) return cached;

      // Senão, busca na rede e armazena em cache
      return fetch(event.request)
        .then((response) => {
          if (
            !response ||
            response.status !== 200 ||
            response.type === 'opaque'
          ) {
            return response;
          }

          const toCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, toCache);
          });

          return response;
        })
        .catch(() => {
          // Offline fallback: retorna o index.html para navegação
          if (event.request.destination === 'document') {
            return caches.match('./index.html');
          }
        });
    })
  );
});

// ── MENSAGENS ────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }
});
