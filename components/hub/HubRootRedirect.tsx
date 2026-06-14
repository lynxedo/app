'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { HUB_IDLE_THRESHOLD_MS, HUB_LAST_ACTIVE_KEY, HUB_LAST_ROUTE_KEY } from '@/lib/hub-idle'

// Renders nothing — its only job is to pick where to send the user when they
// land on the bare /hub URL (cold app open, manifest start_url, etc).
//
// Decision tree:
//   1. ?source=push → never redirect away; the parent /hub page handled it.
//   2. Recent active session (under 14h) AND we have a saved last route →
//      restore to that last route.
//   3. Stale session (over 14h) → /hub/home (matches HubIdleTracker reset).
//   4. Otherwise → fallback (server-rendered general room id).
export default function HubRootRedirect({ fallback }: { fallback: string }) {
  const router = useRouter()

  useEffect(() => {
    try {
      const fromPush = new URLSearchParams(window.location.search).get('source') === 'push'
      if (fromPush) {
        router.replace(fallback)
        return
      }

      const lastActiveRaw = window.localStorage.getItem(HUB_LAST_ACTIVE_KEY)
      const lastActive = lastActiveRaw ? Number(lastActiveRaw) : 0
      const elapsed = Date.now() - lastActive
      const lastRoute = window.localStorage.getItem(HUB_LAST_ROUTE_KEY)

      if (lastActive > 0 && elapsed > HUB_IDLE_THRESHOLD_MS) {
        router.replace('/hub/home')
        return
      }

      if (lastRoute && lastRoute.startsWith('/hub/') && lastRoute !== '/hub') {
        router.replace(lastRoute)
        return
      }

      router.replace(fallback)
    } catch {
      router.replace(fallback)
    }
  }, [router, fallback])

  return (
    <div className="flex-1 flex items-center justify-center text-gray-500">
      <div className="w-6 h-6 border-2 border-gray-700 border-t-gray-400 rounded-full animate-spin" />
    </div>
  )
}
