/**
 * Kawan Kas - Service Worker
 * Strategi: NETWORK-FIRST untuk file aplikasi sendiri, supaya setiap kali
 * ada update yang diupload ke GitHub, versi terbaru langsung terpakai
 * (bukan versi lama yang nyangkut di cache). Cache tetap dipakai sebagai
 * fallback saat offline saja.
 */
const CACHE_NAME = 'kawan-kas-v2'; // GANTI angka ini (v3, v4, dst) setiap kali mau memaksa refresh cache semua user
const ASSETS = [
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // CDN eksternal & Google Apps Script: langsung ke network, fallback cache kalau offline
  if (url.includes('cdnjs.cloudflare.com') || url.includes('script.google.com') || url.includes('unpkg.com')) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  // File aplikasi sendiri: NETWORK-FIRST (selalu coba versi terbaru dulu)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request)) // offline -> pakai cache terakhir yang berhasil disimpan
  );
});
