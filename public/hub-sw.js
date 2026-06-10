// Shell caching — cache static assets on install, serve from cache when offline
const CACHE_NAME = 'hub-shell-v2'
const SHELL_ASSETS = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return
  const url = new URL(request.url)
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase')) return

  // Navigation requests (page loads): always go to network so auth redirects work correctly.
  // Only fall back to cache if the network is completely unavailable.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    )
    return
  }

  // Static assets: cache-first, populate cache on first fetch
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached
      return fetch(request).then(response => {
        if (response.ok && (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/'))) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
        }
        return response
      })
    })
  )
})

self.addEventListener('push', event => {
  const data = event.data?.json?.() ?? {}
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Hub', {
      body: data.body ?? '',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      data: { url: data.url ?? '/hub' },
      requireInteraction: false,
    })
  )
})

self.addEventListener('notificationclick', event => {
  const data = event.notification.data || {}
  event.notification.close()

  // Dialer answer-from-notification (Desktop Dialer Control — Session 5). The
  // incoming call is live in an open Hub window's JS context; route the chosen
  // action back to it via postMessage. A body click (no action button) just
  // focuses the window — it must NOT auto-answer.
  if (data.kind === 'dialer-incoming') {
    const action =
      event.action === 'dialer-answer' ? 'answer'
      : event.action === 'dialer-decline' ? 'decline'
      : 'focus'
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
        const hubClients = clientList.filter(c => c.url.includes(self.location.origin))
        for (const client of hubClients) {
          client.postMessage({ type: 'dialer-incoming-action', action })
        }
        const focusable = hubClients.find(c => 'focus' in c)
        if (focusable) return focusable.focus()
        // No open Hub window → the WebRTC session is already gone (a PWA call
        // can't survive window close). Open the dialer unless they declined.
        if (action !== 'decline' && clients.openWindow) {
          return clients.openWindow(data.url || '/hub/dialer')
        }
      })
    )
    return
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const targetUrl = data.url ?? '/hub'
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl)
    })
  )
})
