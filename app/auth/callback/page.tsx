'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { purgeAllAuthCookies } from '@/lib/auth-cookie-cleanup'
import type { EmailOtpType } from '@supabase/supabase-js'

// Every auth step is bounded and every failure path resets + retries. The Supabase
// client can hang indefinitely against a wedged cookie state (a dead session after a
// refresh-token-reuse revocation), which used to strand users on this spinner forever —
// surviving app and even phone restarts, since the WebView cookie jar persists.
const STEP_TIMEOUT_MS = 10000
const WATCHDOG_MS = 20000

// Resolves null on timeout OR rejection so callers treat both as a plain failure.
function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value) },
      () => { clearTimeout(timer); resolve(null) },
    )
  })
}

export default function AuthCallbackPage() {
  const [slow, setSlow] = useState(false)
  const navigatedRef = useRef(false)

  useEffect(() => {
    const supabase = createClient()

    // Full navigations (not router.push): success re-enters through the middleware
    // with fresh cookies, and failure tears down the wedged in-memory Supabase
    // client. replace() keeps this page out of Back history.
    function go(dest: string) {
      navigatedRef.current = true
      window.location.replace(dest)
    }

    // Sign-in failed against stored auth state that's likely dead — wipe the sb-*
    // cookies (both host-only and domain-wide variants) so the NEXT attempt starts
    // clean instead of failing the same way forever.
    function bail() {
      purgeAllAuthCookies()
      go('/login?error=auth_stuck')
    }

    // Server-validated landing resolution: null when there is no genuinely live
    // session (getUser round-trips to Supabase; a dead cookie session fails here).
    async function validatedLanding(): Promise<string | null> {
      const userRes = await withTimeout(supabase.auth.getUser(), STEP_TIMEOUT_MS)
      const user = userRes?.data.user
      if (!user) return null
      const profileRes = await withTimeout(
        supabase.from('user_profiles').select('landing_page').eq('id', user.id).single(),
        STEP_TIMEOUT_MS,
      )
      return profileRes?.data?.landing_page === 'dashboard' ? '/dashboard' : '/hub/home'
    }

    async function handleAuth() {
      const url = new URL(window.location.href)

      // Android native app: the OAuth used an https redirect (to avoid
      // Google's device-level account picker). Now bounce to the custom
      // scheme so the Android intent filter routes back into the app's
      // WebView, where the PKCE code verifier lives.
      if (url.searchParams.get('app') === 'android') {
        const params = new URLSearchParams(url.searchParams)
        params.delete('app')
        navigatedRef.current = true
        window.location.href = `com.lynxedo.hub://auth/callback?${params.toString()}`
        return
      }

      const code = url.searchParams.get('code')
      const token_hash = url.searchParams.get('token_hash')
      const type = url.searchParams.get('type') as EmailOtpType | null
      // Same-site paths only (matches /login's ?next= rule) — never an external URL.
      const nextParam = url.searchParams.get('next')
      const explicitNext =
        nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : null

      // Invite / email OTP flow — token_hash + type
      if (token_hash && type) {
        const res = await withTimeout(supabase.auth.verifyOtp({ token_hash, type }), STEP_TIMEOUT_MS)
        if (res && !res.error) {
          go(explicitNext || (await validatedLanding()) || '/hub/home')
          return
        }
      }

      // PKCE flow — code exchange (browser client can handle invite codes without a verifier)
      if (code) {
        const res = await withTimeout(supabase.auth.exchangeCodeForSession(code), STEP_TIMEOUT_MS)
        if (res && !res.error) {
          go(explicitNext || (await validatedLanding()) || '/hub/home')
          return
        }
      }

      // No exchange succeeded — but a live session may still exist (implicit-flow hash
      // tokens auto-processed by the client, or an expired link tapped while already
      // signed in). Only trust it after server validation, never a stale local cookie.
      const landing = await validatedLanding()
      if (landing) {
        go(explicitNext || landing)
        return
      }

      // Arrived with credentials that all failed → the stored auth state is suspect;
      // reset it. Arrived with nothing → plain failed-login bounce.
      if (code || token_hash) { bail(); return }
      go('/login?error=auth_failed')
    }

    // Watchdog: whatever happens — a hung promise, an error the flow didn't
    // anticipate — never leave the user staring at a spinner. Reset and retry.
    const watchdog = setTimeout(() => {
      if (!navigatedRef.current) {
        setSlow(true)
        bail()
      }
    }, WATCHDOG_MS)

    handleAuth().catch(() => { if (!navigatedRef.current) bail() })

    return () => clearTimeout(watchdog)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-4 px-6">
      <p className="text-gray-400 text-sm">
        {slow ? 'Sign-in is taking longer than expected…' : 'Signing you in...'}
      </p>
      {slow && (
        <button
          onClick={() => { purgeAllAuthCookies(); window.location.replace('/login?error=auth_stuck') }}
          className="text-sm text-blue-400 underline underline-offset-2"
        >
          Tap here to start over
        </button>
      )}
    </div>
  )
}
