'use client'

import { useEffect, useState } from 'react'

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

  // Attach listeners BEFORE register() so a fast callback can't race past us.
  try {
    await plugin.addListener('registration', async (token) => {
      try {
        await fetch('/api/hub/apns-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_token: token.value }),
        })
      } catch { /* non-critical */ }
    })

    await plugin.addListener('registrationError', (err) => {
      console.error('[PushInit] iOS APNs registrationError:', err.error)
    })
  } catch (e) {
    console.error('[PushInit] iOS addListener threw:', e)
  }

  try {
    const { receive } = await plugin.requestPermissions()
    if (receive !== 'granted') return
    await plugin.register()
  } catch (e) {
    console.error('[PushInit] iOS requestPermissions/register threw:', e)
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

  if (await tryRegister()) return
  let attempts = 0
  const poll = setInterval(async () => {
    attempts++
    if (await tryRegister() || attempts >= 30) clearInterval(poll)
  }, 1000)
}

// Subscribe to web push and POST the subscription to the server.
// Caller is responsible for ensuring Notification.permission === 'granted' first.
async function subscribeAndPost(reg: ServiceWorkerRegistration) {
  const existing = await reg.pushManager.getSubscription()
  const sub = existing ?? await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })

  await fetch('/api/hub/push-subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  })
}

export default function PushInit() {
  const [permission, setPermission] = useState<NotificationPermission | null>(null)
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Android native path
    if (window.AndroidFcm) {
      initAndroidFcm()
      return
    }
    // iOS native (Capacitor) path
    if (window.Capacitor?.isNativePlatform()) {
      initIosApns()
      return
    }
    // Web / PWA path
    if (!VAPID_PUBLIC_KEY || !('serviceWorker' in navigator) || !('PushManager' in window)) return
    if (typeof Notification === 'undefined') return

    let cancelled = false
    ;(async () => {
      try {
        const reg = await navigator.serviceWorker.register('/hub-sw.js', { scope: '/hub' })
        await navigator.serviceWorker.ready
        if (cancelled) return
        setRegistration(reg)
        setPermission(Notification.permission)
        // If permission is already granted, subscribe silently — no user gesture needed
        // for subscribe() itself, only for requestPermission().
        if (Notification.permission === 'granted') {
          await subscribeAndPost(reg)
        }
      } catch {
        // Silently ignore — push is non-critical
      }
    })()

    return () => { cancelled = true }
  }, [])

  // Read remembered dismissal once on mount so the banner doesn't re-appear every session
  useEffect(() => {
    try {
      if (localStorage.getItem('hub-push-banner-dismissed') === '1') setDismissed(true)
    } catch { /* private browsing */ }
  }, [])

  async function handleEnable() {
    if (!registration || busy) return
    setBusy(true)
    try {
      // requestPermission MUST be called inside this click handler (user gesture)
      // — iOS Safari/PWA will silently ignore it otherwise.
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result === 'granted') {
        await subscribeAndPost(registration)
      }
    } catch (e) {
      console.error('[PushInit] enable failed:', e)
    } finally {
      setBusy(false)
    }
  }

  function handleDismiss() {
    setDismissed(true)
    try { localStorage.setItem('hub-push-banner-dismissed', '1') } catch { /* private browsing */ }
  }

  // Only show the banner when: web/PWA context, SW registered, permission is 'default'
  // (never asked yet), and user hasn't dismissed it this device.
  const showBanner = registration !== null && permission === 'default' && !dismissed

  if (!showBanner) return null

  return (
    <div
      className="fixed left-1/2 z-50 -translate-x-1/2 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-sm text-amber-100 shadow-lg backdrop-blur"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom) + 1rem)',
        maxWidth: 'calc(100vw - 2rem)',
      }}
    >
      <div className="flex items-center gap-3">
        <span>🔔 Enable notifications to get DMs and mentions on this device.</span>
        <button
          type="button"
          onClick={handleEnable}
          disabled={busy}
          className="rounded bg-amber-500 px-3 py-1 text-xs font-medium text-slate-900 hover:bg-amber-400 disabled:opacity-50"
        >
          {busy ? '…' : 'Enable'}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="text-amber-200/70 hover:text-amber-100"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
