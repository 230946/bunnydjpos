// Service worker compartido por los 3 POS (Restaurante, Minimercado, Peluquería).
// Cada página lo registra con su propio scope, así que self.registration.scope
// es único por app y sirve para no mezclar el caché de una con el de otra.
const CACHE = 'pos-shell-' + self.registration.scope.split('/').filter(Boolean).pop();

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(self.registration.scope))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Los datos del negocio (ventas, inventario, caja...) nunca se sirven desde
// caché — solo la cáscara de la página se guarda para que abra más rápido
// y no quede en blanco ante un corte de red muy breve.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
