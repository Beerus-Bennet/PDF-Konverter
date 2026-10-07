const CACHE = 'pdfconvert-v4';
// Pflicht: ohne diese Dateien startet die App nicht offline
const APP_CORE = ['./', './index.html'];
// Optional: fehlt eine davon, wird trotzdem installiert
const APP_EXTRA = ['./manifest.json', './icon-192.png', './icon-512.png'];
const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/';
const LIBS = [
  CDN + 'pdf-lib/1.17.1/pdf-lib.min.js',
  CDN + 'pdf.js/3.11.174/pdf.min.js',
  CDN + 'pdf.js/3.11.174/pdf.worker.min.js',
  CDN + 'mammoth/1.6.0/mammoth.browser.min.js',
  CDN + 'xlsx/0.18.5/xlsx.full.min.js',
  CDN + 'jszip/3.10.1/jszip.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_CORE);
    await Promise.all(APP_EXTRA.map(async (url) => {
      try {
        const resp = await fetch(url, { cache: 'reload' });
        if (resp.ok) await cache.put(url, resp);
      } catch (e) { /* fehlende Datei blockiert die Installation nicht */ }
    }));
    // Bibliotheken vorab speichern, damit die App offline vollständig läuft
    await Promise.all(LIBS.map(async (url) => {
      try {
        const resp = await fetch(url, { mode: 'cors' });
        if (resp.ok) await cache.put(url, resp);
      } catch (e) { /* wird beim ersten Gebrauch nachgeladen */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const resp = await fetch(request);
    if (resp && resp.ok) cache.put(request, resp.clone());
    return resp;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') return cache.match('./index.html');
    return Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const resp = await fetch(request);
  if (resp && (resp.ok || resp.type === 'opaque')) cache.put(request, resp.clone());
  return resp;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isPage = req.mode === 'navigate' || (url.origin === self.location.origin && /(\/|\.html|\.json|\.png)$/.test(url.pathname));
  // eigene Dateien (Seite, Manifest, Icons): zuerst aus dem Netz, damit Updates sofort ankommen; offline aus dem Speicher
  event.respondWith(isPage ? networkFirst(req) : cacheFirst(req));
});
