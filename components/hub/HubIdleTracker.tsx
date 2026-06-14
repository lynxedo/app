'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { HUB_IDLE_THRESHOLD_MS, HUB_LAST_ACTIVE_KEY, HUB_LAST_ROUTE_KEY } from '@/lib/hub-idle'

// Routes we never save as "last route" because they are themselves landing /
// redirect pages — saving them would defeat the restore on the next cold load.
function isLandingRoute(path: string) {
  return path === '/hub' || path === '/hub/home'
}

export default function HubIdleTracker() {
  const router = useRouter()
  const pathname = usePathname()
  const didInitialCheck = useRef(false)

  // On cold load: decide whether to bounce to /hub/home before doing anything else.
  // Push-notification deep links append ?source=push (set by the native iOS/Android
  // notification-tap handler) — if present, never redirect; take the user to the
  // message they tapped on.
  useEffect(() => {
    if (didInitialCheck.current) return
    didInitialCheck.current = true

    try {
      const raw = window.localStorage.getItem(HUB_LAST_ACTIVE_KEY)
      const prev = raw ? Number(raw) : 0
      const elapsed = Date.now() - prev
      const fromPush = new URLSearchParams(window.location.search).get('source') === 'push'
      const alreadyOnHome = pathname === '/hub/home'

      if (prev > 0 && elapsed > HUB_IDLE_THRESHOLD_MS && !fromPush && !alreadyOnHome) {
        router.replace('/hub/home')
      }
    } catch {
      // localStorage unavailable (private mode, etc.) — silently skip the reset
    }
  }, [pathname, router])

  // Refresh the activity stamp + last-route on every route change inside Hub.
  // Landing pages are intentionally NOT saved as last route so the next cold
  // load can restore to the user's actual previous destination.
  useEffect(() => {
    try {
      window.localStorage.setItem(HUB_LAST_ACTIVE_KEY, String(Date.now()))
      if (!isLandingRoute(pathname)) {
        window.localStorage.setItem(HUB_LAST_ROUTE_KEY, pathname)
      }
    } catch {
      // localStorage unavailable — ignore
    }
  }, [pathname])

  return null
}
