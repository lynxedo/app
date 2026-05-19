'use client'

import { useEffect } from 'react'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_HUB_VAPID_PUBLIC_KEY ?? ''

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

// iOS Capacitor PushNotifications plugin — accessed via native bridge
type CapPushPlugin = {
  requestPermissions(): Promise<{ receive: 'granted' | 'denied' | 'prompt' }>
  register(): Promise<void>
  addListener(event: 'registration', handler: (token: { value: string }) => void): Promise<void>
  addListener(event: 'registrationError', handler: (err: { error: string }) => void): Promise<void>
}

// Android native bridge — exposed by FcmBridge.java via addJavascriptInterface
type AndroidFcm = {
  getToken(): string
  getPlatform(): string
}

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform(): boolean
      Plugins: { PushNotifications?: CapPushPlugin }
    }
    AndroidFcm?: AndroidFcm
  }
}

async function initIosApns() {
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
    // Non-critical
  }
}

async function initAndroidFcm() {
  const bridge = window.AndroidFcm
  if (!bridge) return

  let registered = false
  const tryRegister = async (): Promise<boolean> => {
    if (registered) return true
    let token = ''
    try { token = bridge.getToken() } catch { return false }
    if (!token) return false
    try {
      const res = await fetch('/api/hub/fcm-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (!res.ok) {
        console.error('[PushInit] FCM subscribe failed:', res.status, await res.text())
        return false
      }
      registered = true
      return true
    } catch (e) {
      console.error('[PushInit] FCM subscribe error:', e)
      return false
    }
  }

  // Try immediately; on first install the token may not be cached yet,
  // so poll for up to 30s (FirebaseMessaging.getToken is async on first run).
  if (await tryRegister()) return
  let attempts = 0
  const poll = setInterval(async () => {
    attempts++
    if (await tryRegister() || attempts >= 30) clearInterval(poll)
  }, 1000)
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

export default function PushInit() {
  useEffect(() => {
    // Android: addJavascriptInterface bridge from MainActivity (works on remote URLs)
    if (window.AndroidFcm) {
      initAndroidFcm()
      return
    }
    // iOS: Capacitor bridge is available on remote URLs via WKWebView script injection
    if (window.Capacitor?.isNativePlatform()) {
      initIosApns()
      return
    }
    // Browser / PWA
    initWebPush()
  }, [])

  return null
}
