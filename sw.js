/* PDFConvert.net – Service Worker
   Hält die komplette App (inkl. Bibliotheken, Schriften und Texterkennung) offline bereit.
   Bei jeder neuen Version APP_VERSION erhöhen (gleicher Wert wie in index.html).
   LIB_CACHE/OCR_CACHE nur erhöhen, wenn sich Dateien in vendor/ ändern – dann werden sie neu geladen. */
const APP_VERSION = '2.2.0';
const APP_CACHE = 'pdfconvert-app-' + APP_VERSION;
const LIB_CACHE = 'pdfconvert-lib-1';
const OCR_CACHE = 'pdfconvert-ocr-1';
const KEEP = [APP_CACHE, LIB_CACHE, OCR_CACHE];

// Pflicht: ohne diese Dateien startet die App nicht offline
const APP_FILES = [
  './', './index.html', './manifest.json', './config.js', './scanner.js',
  './icons/favicon.svg', './icons/favicon-32.png', './icons/icon-192.png', './icons/icon-512.png',
  './icons/maskable-512.png', './icons/apple-touch-icon.png'
];
const FONT_FILES = [];
for (const w of [400, 500, 600, 700]) for (const s of ['latin', 'latin-ext']) FONT_FILES.push(`./vendor/fonts/inter-${s}-${w}-normal.woff2`);
const LIB_FILES = [
  './vendor/pdf-lib/pdf-lib.min.js',
  './vendor/pdfjs/pdf.min.js',
  './vendor/pdfjs/pdf.worker.min.js',
  './vendor/mammoth/mammoth.browser.min.js',
  './vendor/xlsx/xlsx.full.min.js',
  './vendor/jszip/jszip.min.js',
  './vendor/pdf-lib/LICENSE.txt', './vendor/pdfjs/LICENSE.txt', './vendor/mammoth/LICENSE.txt', './vendor/xlsx/LICENSE.txt',
  './vendor/jszip/LICENSE.txt', './vendor/tesseract/LICENSE.txt', './vendor/fonts/LICENSE-Inter.txt',
  './vendor/tesseract/core/LICENSE.txt', './vendor/pdfjs/cmaps/LICENSE.txt', './vendor/pdfjs/standard_fonts/LICENSE_FOXIT.txt', './vendor/pdfjs/standard_fonts/LICENSE_LIBERATION.txt',
  ...FONT_FILES
];
// Texterkennung (ca. 5 MB): wird nach der Installation im Hintergrund geladen
const OCR_BASE = ['./vendor/tesseract/tesseract.min.js', './vendor/tesseract/worker.min.js', './vendor/tesseract/lang/deu.traineddata.gz'];

const abs = u => new URL(u, self.registration.scope).href;
const fresh = u => new Request(abs(u), { cache: 'reload' });

// gleiche Prüfung wie in tesseract.js: unterstützt das Gerät WebAssembly-SIMD?
function hasSimd(){
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch (e) { return false; }
}
function ocrFiles(){
  return OCR_BASE.concat(hasSimd() ? './vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js' : './vendor/tesseract/core/tesseract-core-lstm.wasm.js');
}

async function addMissing(cacheName, files){
  const cache = await caches.open(cacheName);
  await Promise.all(files.map(async u => {
    if (await cache.match(abs(u))) return;
    const resp = await fetch(fresh(u));
    if (!resp.ok) throw new Error('Datei fehlt: ' + u + ' (' + resp.status + ')');
    await cache.put(abs(u), resp);
  }));
}
async function hasAll(cacheName, files){
  if (!(await caches.has(cacheName))) return false;     // nicht anlegen, nur prüfen
  const cache = await caches.open(cacheName);
  for (const u of files) if (!(await cache.match(abs(u)))) return false;
  return true;
}

let ocrJob = null;
function warmOcr(){
  if (!ocrJob) ocrJob = addMissing(OCR_CACHE, ocrFiles()).finally(() => { ocrJob = null; });
  return ocrJob;
}
async function status(){
  const [app, lib, ocr] = await Promise.all([hasAll(APP_CACHE, APP_FILES), hasAll(LIB_CACHE, LIB_FILES), hasAll(OCR_CACHE, ocrFiles())]);
  return { type: 'status', version: APP_VERSION, offline: app && lib, ocr, ocrLoading: !!ocrJob };
}
async function broadcast(){
  const msg = await status();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage(msg);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const app = await caches.open(APP_CACHE);
    await app.addAll(APP_FILES.map(fresh));
    await addMissing(LIB_CACHE, LIB_FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('pdfconvert') && !KEEP.includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
    await broadcast();
  })());
  // Texterkennung im Hintergrund vorbereiten (blockiert die Aktivierung nicht)
  warmOcr().then(broadcast, broadcast);
});

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'status' || data.type === 'warm-ocr') {
    event.waitUntil((async () => {
      if (data.type === 'warm-ocr') { try { await warmOcr(); } catch (e) { /* offline – später erneut */ } }
      if (event.source) event.source.postMessage(await status());
    })());
  }
});

function timeout(ms){ return new Promise(resolve => setTimeout(() => resolve(null), ms)); }

// Seite, Manifest und Konfiguration: zuerst aus dem Netz (Updates kommen sofort an),
// bei schlechtem Netz nach 4 s oder offline aus dem Speicher
function networkFirst(event, isNav){
  const url = new URL(event.request.url);
  url.hash = '';
  const net = fetch(new Request(url.href, { cache: 'no-cache', credentials: 'same-origin' })).then(resp => {
    if (resp && resp.ok && resp.type === 'basic') {
      const copy = resp.clone();
      return caches.open(APP_CACHE).then(c => c.put(url.href, copy)).catch(() => {}).then(() => resp);
    }
    return resp;
  });
  event.waitUntil(net.catch(() => {}));
  const cached = async () => (await caches.match(url.href, { cacheName: APP_CACHE, ignoreSearch: true })) ||
    (isNav ? caches.match(abs('./index.html'), { cacheName: APP_CACHE }) : null);
  return (async () => {
    try {
      const first = await Promise.race([net, timeout(4000)]);
      if (first) return first;
      return (await cached()) || await net;
    } catch (e) {
      const c = await cached();
      if (c) return c;
      if (isNav) return new Response('<!doctype html><meta charset="utf-8"><title>Offline</title><p style="font-family:sans-serif;padding:24px">PDFConvert.net ist gerade nicht erreichbar. Bitte einmal mit Internetverbindung öffnen.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return Response.error();
    }
  })();
}

// Bibliotheken, Schriften, Symbole: aus dem Speicher, sonst laden und merken
async function cacheFirst(req){
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const resp = await fetch(req);
  if (resp && resp.ok && resp.type === 'basic') {
    const path = new URL(req.url).pathname;
    const name = path.includes('/vendor/tesseract/') ? OCR_CACHE : (path.includes('/vendor/') ? LIB_CACHE : APP_CACHE);
    const cache = await caches.open(name);
    cache.put(req, resp.clone());
  }
  return resp;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.headers.has('range')) return;
  const isNav = req.mode === 'navigate';
  if (isNav || /(\/|\.html|\/manifest\.json|\/config\.js|\/scanner\.js)$/.test(url.pathname)) event.respondWith(networkFirst(event, isNav));
  else event.respondWith(cacheFirst(req));
});
