'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Accepts a prod session and creates a staging session from it.
// Only usable on staging.lynxedo.com — navigates away immediately on any other host.
export default function StagingHandoffPage() {
  const router = useRouter()
  const params = useSearchParams()

  useEffect(() => {
    const host = typeof window !== 'undefined' ? window.location.hostname : ''
    if (!host.startsWith('staging.')) {
      router.replace('/hub')
      return
    }

    const at = params.get('at')
    const rt = params.get('rt')
    if (!at || !rt) {
      router.replace('/login')
      return
    }

    createClient()
      .auth.setSession({ access_token: at, refresh_token: rt })
      .then(({ error }) => {
        router.replace(error ? '/login' : '/hub')
      })
  }, [router, params])

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-gray-400 text-sm">Switching to staging…</p>
    </div>
  )
}
