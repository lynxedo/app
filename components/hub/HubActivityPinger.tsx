'use client'

import { useEffect, useRef } from 'react'
import { useDialerContext } from './dialer/DialerProvider'
import { HUB_ACTIVITY_EVENT, HUB_ACTIVITY_PING_MS } from '@/lib/hub-idle'

// Keeps a person's dot green while they are actually using Hub (the 15-minute
// rule — see lib/hub-idle.ts). Real interaction only: pointerdown, keydown,
// wheel, touchstart. NOT scroll or mousemove — chat auto-scrolls when a message
// arrives, and a resting mouse jiggles, neither of which means anyone is there.
// Throttled to one POST a minute. While on a call it pings every minute on its
// own, since a long call has no clicks.
//
// Mounted in HubShell inside OnCallPresenceProvider so it can read the lifted
// dialer device. Renders nothing.
export default function HubActivityPinger() {
  const device = useDialerContext()
  const onCall = !!device && (device.state === 'in-call' || device.state === 'placing')
  const lastPingRef = useRef(0)

  useEffect(() => {
    const ping = (force = false) => {
      const now = Date.now()
      if (!force && now - lastPingRef.current < HUB_ACTIVITY_PING_MS) return
      lastPingRef.current = now
      fetch('/api/hub/active', { method: 'POST', keepalive: true }).catch(() => undefined)
      window.dispatchEvent(new Event(HUB_ACTIVITY_EVENT))
    }
    const onInteract = () => ping()
    const opts = { capture: true, passive: true } as const
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    for (const e of events) window.addEventListener(e, onInteract, opts)

    let callTimer: ReturnType<typeof setInterval> | undefined
    if (onCall) {
      ping(true)
      callTimer = setInterval(() => ping(true), HUB_ACTIVITY_PING_MS)
    }
    return () => {
      for (const e of events) window.removeEventListener(e, onInteract, opts)
      if (callTimer) clearInterval(callTimer)
    }
  }, [onCall])

  return null
}
