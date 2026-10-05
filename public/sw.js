const CACHE_NAME = 'letsgosport-v54';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/css/tokens.css?v=2',
  '/css/style.css?v=35',
  '/css/layout.css?v=4',
  '/css/coach.css?v=2',
  '/css/admin.css?v=3',
  '/css/call.css?v=4',
  '/css/chat.css?v=4',
  '/js/api.js?v=2',
  '/js/main.js?v=15',
  '/js/ui.js?v=13',
  '/js/auth.js?v=7',
  '/js/profilo.js?v=8',
  '/js/admin-api.js?v=1',
  '/js/admin-ui.js?v=7',
  '/js/admin.js?v=8',
  '/js/chat-socket.js?v=14',
  '/js/chat-messaggi.js?v=9',
  '/js/chat-audio.js?v=5',
  '/js/call.js?v=13',
  '/uploads/sliders/associazione-sportiva-1.jpg',
  '/uploads/sliders/associazione-sportiva-2.jpg',
  '/uploads/sliders/associazione-sportiva-3.jpg',
  '/uploads/sliders/basket.jpg',
  '/uploads/sliders/nuoto.jpg',
  '/uploads/sliders/giocoleria.jpg',
  '/uploads/sliders/trofei.jpg',
  '/uploads/sliders/maratona.jpg'
];

const CACHEABLE_DESTINATIONS = new Set(['style', 'script', 'image', 'font']);
const STATIC_UPLOAD_PREFIXES = [
  '/uploads/buttons/',
  '/uploads/catalog/',
  '/uploads/defaults/',
  '/uploads/sliders/'
];

function isPrivateOrDynamicRequest(url) {
  const isDynamicUpload = url.pathname.startsWith('/uploads/')
    && !STATIC_UPLOAD_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io/') ||
    isDynamicUpload
  );
}

function shouldUseRuntimeCache(request, url) {
  if (request.method !== 'GET') return false;
  if (url.origin !== self.location.origin) return false;
  if (isPrivateOrDynamicRequest(url)) return false;
  return request.mode === 'navigate' || CACHEABLE_DESTINATIONS.has(request.destination);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!shouldUseRuntimeCache(event.request, url)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copia = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        }
        return response;
      })
      .catch(async () => {
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) return cachedResponse;
        if (event.request.mode === 'navigate') return caches.match('/index.html');
        return Response.error();
      })
  );
});
