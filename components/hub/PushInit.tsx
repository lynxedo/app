'use client'

import { useEffect } from 'react'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_HUB_VAPID_PUBLIC_KEY ?? ''

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

// Capacitor plugin types — accessed via the native bridge, not imported as npm package
type CapPushPlugin = {
  requestPermissions(): Promise<{ receive: 'granted' | 'denied' | 'prompt' }>
  register(): Promise<void>
  addListener(event: 'registration', handler: (token: { value: string }) => void): Promise<void>
  addListener(event: 'registrationError', handler: (err: { error: string }) => void): Promise<void>
}
declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform(): boolean
      Plugins: { PushNotifications?: CapPushPlugin }
    }
  }
}

async function initNativePush() {
  const plugin = window.Capacitor?.Plugins?.PushNotifications
  if (!plugin) return

  try {
    const { receive } = await plugin.requestPermissions()
    if (receive !== 'granted') return

    await plugin.register()

    plugin.addListener('registration', async (token) => {
      await fetch('/api/hub/apns-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_token: token.value }),
      })
    })

    plugin.addListener('registrationError', (err) => {
      console.error('[PushInit] APNs registration error:', err.error)
    })
  } catch {
    // Non-critical — silently ignore
  }
}

async function initWebPush() {
  if (!VAPID_PUBLIC_KEY || !('serviceWorker' in navigator) || !('PushManager' in window)) return

  try {
    const reg = await navigator.serviceWorker.register('/hub-sw.js', { scope: '/hub' })
    await navigator.serviceWorker.ready

    if (Notification.permission === 'default') {
      const result = await Notification.requestPermission()
      if (result !== 'granted') return
    }
    if (Notification.permission !== 'granted') return

    const existing = await reg.pushManager.getSubscription()
    if (existing) return

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

async function initAndroidFcm() {
  const w = window as Window & { __fcmToken?: string }
  let registered = false

  const registerToken = async (token: string) => {
    if (!token || registered) return
    registered = true
    try {
      await fetch('/api/hub/fcm-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
    } catch {
      registered = false // allow retry on error
    }
  }

  if (w.__fcmToken) {
    await registerToken(w.__fcmToken)
    return
  }

  // Listen for injection event from MainActivity (fires after onPageFinished or token fetch)
  window.addEventListener('fcmTokenReady', () => {
    if (w.__fcmToken) registerToken(w.__fcmToken)
  }, { once: true })

  // Poll for up to 15 seconds in case the event fires before this listener was added
  let attempts = 0
  const poll = setInterval(() => {
    attempts++
    if (w.__fcmToken) {
      clearInterval(poll)
      registerToken(w.__fcmToken)
    } else if (attempts >= 15) {
      clearInterval(poll)
    }
  }, 1000)
}

export default function PushInit() {
  useEffect(() => {
    const isAndroid = /android/i.test(navigator.userAgent)
    const isNative = window.Capacitor?.isNativePlatform() ||
      localStorage.getItem('lynxedo_native') === '1'

    if (isNative && isAndroid) {
      initAndroidFcm()
    } else if (isNative) {
      initNativePush()
    } else {
      initWebPush()
    }
  }, [])

  return null
}
