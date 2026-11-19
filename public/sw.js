// Service worker PWA: intercetta alcune richieste statiche e usa la cache per il funzionamento offline.
// Il frontend gira nel browser: il DOM rappresenta gli elementi HTML e gli eventi collegano le azioni dell’utente
// ai metodi.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// CACHE_NAME: Nome della versione di cache usata dal service worker.
const CACHE_NAME = 'letsgosport-v63';
// ASSETS: Risorse statiche che il service worker prova a memorizzare durante l’installazione.
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/css/tokens.css?v=2',
  '/css/style.css?v=35',
  '/css/layout.css?v=7',
  '/css/coach.css?v=2',
  '/css/admin.css?v=3',
  '/css/call.css?v=8',
  '/css/chat.css?v=6',
  '/js/api.js?v=3',
  '/js/main.js?v=18',
  '/js/ui.js?v=16',
  '/js/auth.js?v=7',
  '/js/profilo.js?v=8',
  '/js/admin-api.js?v=1',
  '/js/admin-ui.js?v=7',
  '/js/admin.js?v=8',
  '/js/chat-socket.js?v=16',
  '/js/chat-messaggi.js?v=11',
  '/js/chat-audio.js?v=8',
  '/js/call-interface.js?v=2',
  '/js/call.js?v=18',
  '/uploads/sliders/associazione-sportiva-1.jpg',
  '/uploads/sliders/associazione-sportiva-2.jpg',
  '/uploads/sliders/associazione-sportiva-3.jpg',
  '/uploads/sliders/trofei.jpg',
  '/uploads/sliders/maratona.jpg'
];

// CACHEABLE_DESTINATIONS: Tipi di risorsa statica ammessi nella cache durante l’uso.
const CACHEABLE_DESTINATIONS = new Set(['style', 'script', 'image', 'font']);
// STATIC_UPLOAD_PREFIXES: Directory degli asset distribuiti con il codice e distinguibili dagli upload dinamici.
const STATIC_UPLOAD_PREFIXES = [
  '/uploads/buttons/',
  '/uploads/catalog/',
  '/uploads/defaults/',
  '/uploads/sliders/'
];

// isPrivateOrDynamicRequest: Riconosce API, Socket.IO e upload dinamici che devono restare fuori dalla cache del
// service worker.
// Riceve: url (indirizzo della risorsa o del servizio).
function isPrivateOrDynamicRequest(url) {
  // isDynamicUpload: Indica un upload che non appartiene alle cartelle degli asset statici consentiti.
  const isDynamicUpload = url.pathname.startsWith('/uploads/')
    // Controlla il criterio che deve essere soddisfatto da almeno un elemento.
    // Riceve: prefix (prefisso della stanza).
    && !STATIC_UPLOAD_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io/') ||
    isDynamicUpload
  );
}

// shouldUseRuntimeCache: Permette la cache soltanto per richieste GET della stessa origine e risorse statiche
// ammesse.
// Riceve: request (richiesta intercettata dal service worker); url (indirizzo della risorsa o del servizio).
function shouldUseRuntimeCache(request, url) {
  if (request.method !== 'GET') return false;
  // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
  if (url.origin !== self.location.origin) return false;
  if (isPrivateOrDynamicRequest(url)) return false;
  return request.mode === 'navigate' || CACHEABLE_DESTINATIONS.has(request.destination);
}

// Prepara la cache del service worker durante l’installazione.
// Riceve: event (evento del browser).
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // Elabora il risultato quando la Promise precedente si completa con successo.
      // Riceve: cache (archivio Cache del browser).
      .then((cache) => {
        return cache.addAll(ASSETS);
      })
      // Elabora il risultato quando la Promise precedente si completa con successo.
      .then(() => self.skipWaiting())
  );
});

// Elimina le vecchie cache e rende attiva questa versione del service worker.
// Riceve: event (evento del browser).
self.addEventListener('activate', (event) => {
  event.waitUntil(
    // Elabora il risultato quando la Promise precedente si completa con successo.
    // Riceve: keys (nomi delle cache presenti).
    caches.keys().then((keys) => {
      return Promise.all(
        // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
        // Riceve: key (chiave della raccolta).
        keys.filter((key) => key !== CACHE_NAME)
            // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
            // Riceve: key (chiave della raccolta).
            .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Decide se servire la richiesta dalla rete o dal ripiego in cache.
// Riceve: event (evento del browser).
self.addEventListener('fetch', (event) => {
  // url: Indirizzo analizzato per distinguere origine, percorso e parametri.
  const url = new URL(event.request.url);
  if (!shouldUseRuntimeCache(event.request, url)) return;

  event.respondWith(
    fetch(event.request)
      // Elabora il risultato quando la Promise precedente si completa con successo.
      // Riceve: response (risposta HTTP ricevuta).
      .then((response) => {
        if (response.ok) {
          // copia: Risultato della chiamata response.clone, riutilizzato nelle istruzioni successive.
          const copia = response.clone();
          // Elabora il risultato quando la Promise precedente si completa con successo.
          // Riceve: cache (archivio Cache del browser).
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        }
        return response;
      })
      // Gestisce il rifiuto della Promise secondo il recupero o la propagazione previsti nel blocco.
      // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
      .catch(async () => {
        // cachedResponse: Risposta già disponibile nella cache, usata quando la rete non risponde.
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) return cachedResponse;
        if (event.request.mode === 'navigate') return caches.match('/index.html');
        return Response.error();
      })
  );
});
