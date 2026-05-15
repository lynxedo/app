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
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const targetUrl = event.notification.data?.url ?? '/hub'
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
