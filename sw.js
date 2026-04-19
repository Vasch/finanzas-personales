const CACHE = 'finanzas-v1'

self.addEventListener('install', (e) => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim())
})

self.addEventListener('fetch', (e) => {
  // Solo manejar requests GET de nuestro dominio
  if (e.request.method !== 'GET') return
  if (!e.request.url.startsWith(self.location.origin)) return
  
  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Guardar en caché solo los archivos estáticos de la app
        const url = e.request.url
        if (url.endsWith('.html') || url.endsWith('.css') || url.endsWith('.js') || url.endsWith('.json') || url.endsWith('.png')) {
          const clone = response.clone()
          caches.open(CACHE).then(cache => cache.put(e.request, clone))
        }
        return response
      })
      .catch(() => caches.match(e.request))
  )
})
