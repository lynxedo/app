'use client'

import { useEffect, useState } from 'react'
import { isChimeEnabled, setChimeEnabled, playChime, primeChimeAudio } from '@/lib/hub-chime'

type Platform = 'web' | 'ios-native' | 'android-native' | 'electron' | 'unsupported'

// Window.Capacitor and Window.AndroidFcm are declared globally in PushInit.tsx —
// we use loose casts here to avoid a duplicate declaration with a different shape.
type CapBridgeShape = {
  isNativePlatform(): boolean
  Plugins: {
    PushNotifications?: {
      requestPermissions(): Promise<{ receive: 'granted' | 'denied' | 'prompt' }>
      register(): Promise<void>
    }
  }
}
type AndroidBridgeShape = { getToken(): string; getPlatform(): string }
function getCapacitor(): CapBridgeShape | undefined {
  return (window as unknown as { Capacitor?: CapBridgeShape }).Capacitor
}
function getAndroidFcm(): AndroidBridgeShape | undefined {
  return (window as unknown as { AndroidFcm?: AndroidBridgeShape }).AndroidFcm
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'unsupported'
  if (getAndroidFcm()) return 'android-native'
  if (getCapacitor()?.isNativePlatform()) return 'ios-native'
  if (navigator.userAgent.includes('Electron')) return 'electron'
  if ('serviceWorker' in navigator && 'PushManager' in window) return 'web'
  return 'unsupported'
}

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_HUB_VAPID_PUBLIC_KEY ?? ''

export default function NotificationDeviceControls() {
  const [platform, setPlatform] = useState<Platform>('unsupported')
  const [webStatus, setWebStatus] = useState<'unknown' | 'enabled' | 'no-permission' | 'permission-denied' | 'no-subscription'>('unknown')
  const [busy, setBusy] = useState<'reset' | 'test' | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null)
  const [soundOn, setSoundOn] = useState(true)
  const [notifSound, setNotifSound] = useState<string>('default')
  const [soundSaving, setSoundSaving] = useState(false)

  useEffect(() => {
    setPlatform(detectPlatform())
    setSoundOn(isChimeEnabled())
  }, [])

  // Load the saved APNs notification sound when we know we're on iOS native
  useEffect(() => {
    if (platform !== 'ios-native') return
    fetch('/api/hub/notification-prefs')
      .then(r => r.json())
      .then((d: { prefs?: Array<{ room_id: string | null; notification_sound?: string | null }> }) => {
        const global = d.prefs?.find(p => p.room_id === null)
        if (global?.notification_sound) setNotifSound(global.notification_sound)
      })
      .catch(() => { /* use default */ })
  }, [platform])

  async function handleSoundChange(sound: string) {
    setNotifSound(sound)
    setSoundSaving(true)
    try {
      await fetch('/api/hub/notification-prefs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_sound: sound }),
      })
    } catch {
      // best-effort save; next load will show the current DB value
    } finally {
      setSoundSaving(false)
    }
  }

  function handleToggleSound() {
    const next = !soundOn
    setSoundOn(next)
    setChimeEnabled(next)
    // Toggling on from inside this click both unlocks audio and previews the sound.
    if (next) {
      primeChimeAudio()
      playChime()
    }
  }

  useEffect(() => {
    if (platform !== 'web') return
    ;(async () => {
      if (typeof Notification === 'undefined') return setWebStatus('unknown')
      if (Notification.permission === 'denied') return setWebStatus('permission-denied')
      if (Notification.permission !== 'granted') return setWebStatus('no-permission')
      const reg = await navigator.serviceWorker.getRegistration('/hub')
      const sub = reg ? await reg.pushManager.getSubscription() : null
      setWebStatus(sub ? 'enabled' : 'no-subscription')
    })().catch(() => setWebStatus('unknown'))
  }, [platform, busy])

  async function handleTest() {
    if (busy) return
    setBusy('test')
    setMsg(null)

    // The in-app chime is a separate system from push notifications, so play it
    // here too — this one button then verifies the new-message sound as well.
    // Running it inside the click also unlocks audio for later background chimes.
    if (isChimeEnabled()) {
      primeChimeAudio()
      playChime()
    }

    try {
      const res = await fetch('/api/hub/push-test', { method: 'POST' })
      if (!res.ok) {
        setMsg({ kind: 'err', text: `Test request failed (${res.status})` })
        return
      }
      const d = await res.json() as { total_sent: number; web: { subs: number }; apns: { tokens: number }; fcm: { tokens: number } }
      if (d.total_sent === 0) {
        setMsg({ kind: 'err', text: 'No active subscriptions on any device. Tap Reset below to subscribe.' })
      } else {
        const parts: string[] = []
        if (d.web.subs > 0) parts.push(`${d.web.subs} web`)
        if (d.apns.tokens > 0) parts.push(`${d.apns.tokens} iOS`)
        if (d.fcm.tokens > 0) parts.push(`${d.fcm.tokens} Android`)
        setMsg({ kind: 'ok', text: `Test sent to ${parts.join(' + ')}. Background the app — notification should appear within a few seconds.` })
      }
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Test failed' })
    } finally {
      setBusy(null)
    }
  }

  async function handleReset() {
    if (busy) return
    setBusy('reset')
    setMsg(null)
    try {
      if (platform === 'web') {
        if (!VAPID_PUBLIC_KEY) throw new Error('Server VAPID key not configured')
        const reg = await navigator.serviceWorker.register('/hub-sw.js', { scope: '/hub' })
        await navigator.serviceWorker.ready

        // Step 1: unsubscribe existing sub and drop its DB row
        const existing = await reg.pushManager.getSubscription()
        if (existing) {
          const oldEndpoint = existing.endpoint
          await existing.unsubscribe()
          await fetch('/api/hub/push-subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: oldEndpoint }),
          }).catch(() => { /* fall through — server will clean up on next stale-token sweep */ })
        }

        // Step 2: request permission if needed (must be inside this click handler)
        if (Notification.permission === 'default') {
          const result = await Notification.requestPermission()
          if (result !== 'granted') {
            setMsg({ kind: 'err', text: 'Permission denied. Enable notifications for lynxedo.com in your browser settings.' })
            return
          }
        } else if (Notification.permission === 'denied') {
          setMsg({ kind: 'err', text: 'Permission is blocked. Open browser site settings for lynxedo.com and allow notifications, then try again.' })
          return
        }

        // Step 3: fresh subscribe
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        })
        const res = await fetch('/api/hub/push-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub.toJSON()),
        })
        if (!res.ok) throw new Error(`Server rejected subscription (${res.status})`)
        setMsg({ kind: 'ok', text: 'This device is registered. Tap "Send test" to verify.' })
      } else if (platform === 'android-native') {
        const bridge = getAndroidFcm()
        if (!bridge) throw new Error('Android bridge not available')
        const token = bridge.getToken()
        if (!token) throw new Error('No FCM token yet — relaunch the app and try again')
        const res = await fetch('/api/hub/fcm-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        if (!res.ok) throw new Error(`Server rejected FCM token (${res.status})`)
        setMsg({ kind: 'ok', text: 'This device is registered. Tap "Send test" to verify.' })
      } else if (platform === 'ios-native') {
        const plugin = getCapacitor()?.Plugins?.PushNotifications
        if (!plugin) throw new Error('Capacitor PushNotifications plugin not loaded')
        const { receive } = await plugin.requestPermissions()
        if (receive !== 'granted') {
          setMsg({ kind: 'err', text: 'Notifications denied. Open iOS Settings → Notifications → Lynxedo Hub to enable.' })
          return
        }
        await plugin.register()
        setMsg({ kind: 'info', text: 'Re-registration triggered. The device will report its token in a few seconds. Then tap "Send test".' })
      } else if (platform === 'electron') {
        setMsg({ kind: 'info', text: 'The desktop app uses the live message stream, not push subscriptions. No reset needed — if notifications stop working, fully quit and reopen the app.' })
      } else {
        setMsg({ kind: 'err', text: 'Push notifications are not supported on this device.' })
      }
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Reset failed' })
    } finally {
      setBusy(null)
    }
  }

  const platformLabel = {
    'web': 'Browser / PWA',
    'ios-native': 'iOS app',
    'android-native': 'Android app',
    'electron': 'Desktop app (Mac/Windows)',
    'unsupported': 'Unknown',
  }[platform]

  const statusBadge = (() => {
    if (platform === 'electron') return <span className="text-blue-300">Live-stream notifications</span>
    if (platform === 'web') {
      if (webStatus === 'enabled') return <span className="text-green-400">✓ Enabled</span>
      if (webStatus === 'no-permission') return <span className="text-amber-300">Permission not granted</span>
      if (webStatus === 'permission-denied') return <span className="text-red-400">Blocked in browser settings</span>
      if (webStatus === 'no-subscription') return <span className="text-amber-300">Not registered</span>
      return <span className="text-gray-400">Checking…</span>
    }
    return <span className="text-gray-400">—</span>
  })()

  return (
    <div className="border-t border-gray-800 pt-5 mt-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-medium text-white">This device</h3>
        <span className="text-xs">{statusBadge}</span>
      </div>
      <p className="text-gray-400 text-sm mb-4">
        {platformLabel}. Send a test push to confirm this device receives notifications, or reset its registration if pushes have stopped working.
      </p>
      {platform === 'web' && (
        <div className="flex items-center justify-between gap-3 mb-4 rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2.5">
          <div>
            <p className="text-sm text-white">Play a sound for new messages</p>
            <p className="text-xs text-gray-400">Chimes on this device for every new message while Hub is open in this browser — whether you&apos;re looking at Hub or working elsewhere.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={soundOn}
            aria-label="Play a sound for new messages on this device"
            onClick={handleToggleSound}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${soundOn ? 'bg-blue-600' : 'bg-gray-600'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${soundOn ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      )}
      {platform === 'ios-native' && (
        <div className="mb-4 rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2.5">
          <p className="text-sm text-white mb-1">Notification sound</p>
          <p className="text-xs text-gray-400 mb-3">Choose the sound played when you receive a push notification. Takes effect on the next notification you receive.</p>
          <div className="flex flex-wrap gap-2">
            {(['default', 'Glass', 'Ping', 'Tink', 'Pop'] as const).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => handleSoundChange(s)}
                disabled={soundSaving}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors disabled:opacity-50 ${
                  notifSound === s
                    ? 'bg-blue-600 border-blue-600 text-[#fff]'
                    : 'border-gray-700 text-gray-300 hover:border-gray-500'
                }`}
              >
                {s === 'default' ? 'Default' : s}
              </button>
            ))}
          </div>
          {soundSaving && <p className="text-xs text-gray-500 mt-2">Saving…</p>}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleTest}
          disabled={busy !== null}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-[#fff] text-sm font-medium disabled:opacity-50"
        >
          {busy === 'test' ? 'Sending…' : 'Send test notification'}
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={busy !== null || platform === 'electron'}
          className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-600 text-white text-sm font-medium disabled:opacity-40"
          title={platform === 'electron' ? 'Not applicable to the desktop app' : undefined}
        >
          {busy === 'reset' ? 'Resetting…' : 'Reset notifications on this device'}
        </button>
      </div>
      {msg && (
        <p className={`mt-3 text-sm ${msg.kind === 'ok' ? 'text-green-400' : msg.kind === 'err' ? 'text-red-400' : 'text-blue-300'}`}>
          {msg.text}
        </p>
      )}
    </div>
  )
}
