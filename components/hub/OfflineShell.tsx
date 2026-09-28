'use client'

// Registers the Hub service worker so the app can open with no signal.
//
// ⚠⚠ WHY THIS IS ITS OWN COMPONENT AND NOT PART OF PushInit: it used to be part
// of PushInit, and that is exactly how the phone apps ended up with no offline
// support at all. PushInit branches on transport FIRST —
//
//     if (window.AndroidFcm) { initAndroidFcm(); return }
//     if (window.Capacitor?.isNativePlatform()) { initIosApns(); return }
//     ...register('/hub-sw.js')      // ← web only ever got here
//
// — so both native apps returned before the worker was ever registered. The
// offline punch queue and the route-sheet cache were both built and working,
// and both unreachable, because the PAGE holding them could not load offline.
// A cold start with no signal showed the webview's own "webpage not available".
//
// Offline is not a push concern. Registration belongs somewhere that does not
// care which notification transport the platform happens to use.

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function OfflineShell() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let cancelled = false

    void navigator.serviceWorker.register('/hub-sw.js', { scope: '/hub' }).catch(err => {
      // Not fatal — it only costs offline support, so the app must carry on.
      console.error('[OfflineShell] service worker registration failed:', err)
    })

    // ⚠ Signing out has to take the saved screens with it. They are copies of
    // SIGNED-IN pages — a name, today's stops, hours — so without this the next
    // person to open the app with no signal would be shown the last person's
    // route sheet. Listening for the auth event rather than editing the six
    // places that call signOut(): a sign-out path added later is covered too.
    const supabase = createClient()
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled || event !== 'SIGNED_OUT') return
      navigator.serviceWorker.controller?.postMessage({ type: 'clear-offline-pages' })
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  return null
}
