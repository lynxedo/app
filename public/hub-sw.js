// Shell caching — keep a copy of the few screens that have to open with no signal.
//
// ⚠⚠ WHY THIS EXISTS AT ALL: until Sep 2026 this worker was only ever registered
// on the web/PWA path, because the registration sat inside PushInit AFTER the
// native branches returned. So inside the phone apps there was no worker, no
// cache, and a cold start with no signal showed the webview's own "webpage not
// available" — the offline punch queue and the route-sheet cache were both
// unreachable, because the page holding them could not load in the first place.
// components/hub/OfflineShell.tsx now registers this on every platform.
//
// ⚠ Only these three routes are kept. Clocking in is the one that costs real
// money when it fails, and the route sheet is the one people need mid-route;
// everything else can wait for signal. Keeping every page would mean serving
// stale screens nobody asked to be saved.
const CACHE_NAME = 'hub-shell-v3'
const SHELL_ASSETS = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
]
const OFFLINE_ROUTES = ['/hub', '/hub/timesheet', '/hub/daily-log-v2']

/** Cache key for a page: pathname only, so /hub/timesheet?source=push finds the
 *  copy saved by a plain visit. */
function pageKey(url) {
  return new Request(new URL(url.pathname, self.location.origin).toString())
}

function isOfflineRoute(pathname) {
  const p = pathname.replace(/\/+$/, '') || '/hub'
  return OFFLINE_ROUTES.includes(p)
}

// Shown only when the network is gone AND we have no saved copy of that screen.
// A plain browser error tells someone nothing; this at least says what happened
// and which screens will work.
const OFFLINE_FALLBACK = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>No signal</title>
<style>
 :root { color-scheme: dark }
 body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
        background:#0b1220; color:#e2e8f0; font:16px/1.5 system-ui,-apple-system,sans-serif; padding:24px }
 .box { max-width:22rem; text-align:center }
 h1 { font-size:1.25rem; margin:0 0 .5rem }
 p { color:#94a3b8; margin:0 0 1.25rem }
 a { display:block; padding:.75rem 1rem; margin:.5rem 0; border-radius:.5rem;
     background:#1e293b; color:#e2e8f0; text-decoration:none }
</style></head>
<body><div class="box">
  <h1>No signal</h1>
  <p>This screen wasn't saved for offline use. Clocking in and the route sheet are.</p>
  <a href="/hub/timesheet">Time clock</a>
  <a href="/hub/daily-log-v2">Route sheet</a>
</div></body></html>`

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

// ⚠⚠ A saved page must not outlive the person who loaded it. These copies are
// of SIGNED-IN screens — someone else's name, stops and hours — so signing out
// has to take them with it, or the next person to open the app with no signal
// sees the last user's route sheet. lib/hub-signout.ts sends this.
self.addEventListener('message', event => {
  if (event.data?.type !== 'clear-offline-pages') return
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      const keys = await cache.keys()
      await Promise.all(
        keys
          .filter(req => isOfflineRoute(new URL(req.url).pathname))
          .map(req => cache.delete(req))
      )
    })
  )
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return
  const url = new URL(request.url)
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase')) return

  // Navigation requests (page loads): always go to network so auth redirects work
  // correctly. Only fall back to a saved copy if the network is gone.
  //
  // ⚠⚠ NEVER cache a redirected response. A signed-out load answers 200 at the
  // END of a redirect to /login — saving that under /hub/timesheet would pin the
  // login page as "the time clock" for as long as the cache lives, offline AND
  // online. response.redirected is the only thing that tells them apart.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok && !response.redirected && isOfflineRoute(url.pathname)) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then(cache => cache.put(pageKey(url), clone))
          }
          return response
        })
        .catch(async () => {
          const saved = await caches.match(pageKey(url))
          if (saved) return saved
          return new Response(OFFLINE_FALLBACK, {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        })
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
      tag: data.groupKey || data.type || 'hub',
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
