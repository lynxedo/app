'use client'

// Come back to a screen that tells the truth.
//
// Radio's premise is a channel sitting warm in your pocket for an hour, so
// pulling the phone out to a frozen Hub is the one failure it cannot afford.
// This refreshes the server tree when the app comes back after a long spell in
// the background, keeping the user exactly where they were.
//
// ⚠⚠ READ THIS BEFORE WIDENING IT. The Hub used to router.refresh() on EVERY
// focus/visibility change and it was removed on June 29 2026 for two specific
// reasons (see the note in HubShell.tsx): it wiped in-progress input — a
// half-typed new lead, confirmed — and it silently swallowed the "Refresh to
// update" banner after a deploy, because the refresh re-read the new build id so
// UpdateNotifier never had a mismatch left to show. Users said "it refreshes on
// its own and I lose what I'm typing" and "I never see the refresh button."
//
// This is deliberately NOT that. Three gates, each one closing one of those doors:
//
//   1. THIRTY MINUTES, not every focus. Switching apps for a moment does nothing.
//   2. NOT WHILE ANYTHING IS UNSAVED. hasUnsavedWork() is the same counter the
//      beforeunload guard uses, so every editor that already protects a draft
//      protects it from this too, for free.
//   3. NATIVE APP ONLY. The stale-screen problem is a phone in a pocket; the
//      deploy-banner problem is a desktop that stays open for days, and Workspace
//      Tabs keep hidden pages mounted there. Desktop keeps today's behaviour.
//
// router.refresh() re-fetches server components and preserves client state — it
// is not a reload, and it does not change the route.

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { hasUnsavedWork } from '@/hooks/use-unsaved-guard'
import { isNativeApp } from '@/lib/hub-idle'

const STALE_AFTER_MS = 30 * 60 * 1000

export default function HubWarmResume() {
  const router = useRouter()
  const hiddenAt = useRef<number | null>(null)

  useEffect(() => {
    if (!isNativeApp()) return

    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt.current = Date.now()
        return
      }
      const went = hiddenAt.current
      hiddenAt.current = null
      if (went === null) return
      if (Date.now() - went < STALE_AFTER_MS) return
      if (hasUnsavedWork()) return
      router.refresh()
    }

    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [router])

  return null
}
