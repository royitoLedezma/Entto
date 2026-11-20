// Funcionamiento sin internet: guarda la app en el celular.
// Archivos propios: primero la red (para recibir actualizaciones), si no hay, lo guardado.
// Librerías externas (Firebase, Excel): lo guardado primero.
const CACHE = 'entto-v8';
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './js/app.js', './js/db.js', './js/firebase-config.js', './js/parser.js', './js/model.js', './js/athlete.js', './js/coach.js', './js/stats.js', './js/charts.js',
  './js/vendor/lit-html/lit-html.js', './js/vendor/lit-html/directive.js', './js/vendor/lit-html/directive-helpers.js', './js/vendor/lit-html/directives/live.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // La base de datos y el inicio de sesión los maneja Firebase (tiene su propio modo sin internet).
  if (/firestore\.googleapis\.com|identitytoolkit|securetoken|googleapis\.com\/(identity|v1)/.test(url.href)) return;
  const external = url.origin !== self.location.origin;
  if (external) {
    if (!/gstatic\.com\/firebasejs|cdn\.sheetjs\.com/.test(url.href)) return;
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })));
    return;
  }
  e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
    .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))));
});
