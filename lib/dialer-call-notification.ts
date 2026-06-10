// Desktop Dialer Control — Session 5. Answer-from-notification (PWA/desktop).
//
// On an incoming call (detected in the live page JS context), fire a LOCAL
// service-worker notification with Answer / Decline action buttons so the user
// can take the call while the Hub window is unfocused / minimized behind other
// apps. This is a local notification (not a server push) — simpler and reliable,
// because the call is already detected client-side. The SW (public/hub-sw.js)
// routes the action button back to this page via postMessage.
//
// Capability-gated: needs a service worker + granted Notification permission, and
// is skipped on native (CallKit / the Android full-screen notification own the
// incoming ring there). Unsupported → no-op, never throws.

import { nativeVoiceAvailable } from '@/lib/native-voice'

export const DIALER_NOTIFICATION_TAG = 'dialer-incoming'
export const DIALER_ACTION_ANSWER = 'dialer-answer'
export const DIALER_ACTION_DECLINE = 'dialer-decline'

export function callNotificationSupported(): boolean {
  if (typeof window === 'undefined') return false
  if (nativeVoiceAvailable()) return false // CallKit / Android notif own this
  if (!('serviceWorker' in navigator)) return false
  if (!('Notification' in window)) return false
  return Notification.permission === 'granted'
}

async function getReg(): Promise<ServiceWorkerRegistration | null> {
  try {
    const existing = await navigator.serviceWorker.getRegistration('/hub')
    if (existing) return existing
    return await navigator.serviceWorker.ready
  } catch {
    return null
  }
}

export async function showIncomingCallNotification(opts: {
  title: string
  body?: string
}): Promise<void> {
  if (!callNotificationSupported()) return
  const reg = await getReg()
  if (!reg) return
  try {
    await reg.showNotification(opts.title, {
      body: opts.body || 'Incoming call',
      tag: DIALER_NOTIFICATION_TAG, // one notification, replaced not stacked
      renotify: true,
      requireInteraction: true, // stays until answered/declined/handled
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      data: { kind: DIALER_NOTIFICATION_TAG, url: '/hub/dialer' },
      // Action buttons are honored on desktop Chrome/Edge; browsers that ignore
      // them still show the notification (caller name) — degrading to "focus Hub".
      actions: [
        { action: DIALER_ACTION_ANSWER, title: 'Answer' },
        { action: DIALER_ACTION_DECLINE, title: 'Decline' },
      ],
    } as NotificationOptions)
  } catch {
    /* showNotification can reject if permission flips mid-call — ignore */
  }
}

export async function closeIncomingCallNotification(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const reg = await getReg()
  if (!reg) return
  try {
    const notes = await reg.getNotifications({ tag: DIALER_NOTIFICATION_TAG })
    notes.forEach((n) => n.close())
  } catch {
    /* ignore */
  }
}
