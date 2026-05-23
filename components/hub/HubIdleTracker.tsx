'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'

// If the user hasn't touched Hub in this long, the next open drops them on /hub/home
// instead of resuming where they were. Tuned to fire on the overnight gap but not on
// a long lunch or meeting. Pure navigation reset — Supabase session is untouched.
const IDLE_THRESHOLD_MS = 14 * 60 * 60 * 1000 // 14 hours
const STORAGE_KEY = 'hub_last_active_at'
const ROUTE_KEY = 'hub_last_route'

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
      const raw = window.localStorage.getItem(STORAGE_KEY)
      const prev = raw ? Number(raw) : 0
      const elapsed = Date.now() - prev
      const fromPush = new URLSearchParams(window.location.search).get('source') === 'push'
      const alreadyOnHome = pathname === '/hub/home'

      if (prev > 0 && elapsed > IDLE_THRESHOLD_MS && !fromPush && !alreadyOnHome) {
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
      window.localStorage.setItem(STORAGE_KEY, String(Date.now()))
      if (!isLandingRoute(pathname)) {
        window.localStorage.setItem(ROUTE_KEY, pathname)
      }
    } catch {
      // localStorage unavailable — ignore
    }
  }, [pathname])

  return null
}
