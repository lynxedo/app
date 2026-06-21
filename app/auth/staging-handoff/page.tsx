'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Accepts a prod session and creates a staging session from it.
// Only usable on staging.lynxedo.com — bails out on any other host.
//
// After setSession() we do a FULL-PAGE navigation (window.location) rather than
// Next's client router. The /hub server component authenticates from cookies;
// inside the iOS WKWebView a soft client navigation does not reliably attach the
// just-written auth cookies to the RSC request, so it would bounce to /login.
// A full document load guarantees the new cookies are sent.
function Handoff() {
  const params = useSearchParams()
  const [error, setError] = useState('')

  useEffect(() => {
    const host = typeof window !== 'undefined' ? window.location.hostname : ''
    if (!host.startsWith('staging.')) {
      window.location.replace('https://staging.lynxedo.com/hub')
      return
    }

    const at = params.get('at')
    const rt = params.get('rt')
    if (!at || !rt) {
      setError('No session was passed from production. Try the switch button again.')
      return
    }

    createClient()
      .auth.setSession({ access_token: at, refresh_token: rt })
      .then(({ error }) => {
        if (error) {
          setError(`Could not sign in to staging: ${error.message}`)
          return
        }
        window.location.replace('/hub')
      })
      .catch((e) => setError(`Could not sign in to staging: ${e?.message ?? e}`))
  }, [params])

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-4 px-6 text-center">
      {error ? (
        <>
          <p className="text-red-400 text-sm max-w-sm">{error}</p>
          <a href="https://lynxedo.com/hub" className="text-blue-400 text-sm underline">Back to Production</a>
        </>
      ) : (
        <p className="text-gray-400 text-sm">Switching to staging…</p>
      )}
    </div>
  )
}

export default function StagingHandoffPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-gray-400 text-sm">Switching to staging…</p></div>}>
      <Handoff />
    </Suspense>
  )
}
