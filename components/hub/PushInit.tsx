'use client'

import { useEffect } from 'react'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_HUB_VAPID_PUBLIC_KEY ?? ''

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export default function PushInit() {
  useEffect(() => {
    if (!VAPID_PUBLIC_KEY || !('serviceWorker' in navigator) || !('PushManager' in window)) return

    async function init() {
      try {
        const reg = await navigator.serviceWorker.register('/hub-sw.js', { scope: '/hub' })
        await navigator.serviceWorker.ready

        if (Notification.permission === 'default') {
          const result = await Notification.requestPermission()
          if (result !== 'granted') return
        }
        if (Notification.permission !== 'granted') return

        const existing = await reg.pushManager.getSubscription()
        if (existing) return // already subscribed

        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        })

        await fetch('/api/hub/push-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub.toJSON()),
        })
      } catch {
        // Silently ignore — push is non-critical
      }
    }

    init()
  }, [])

  return null
}
