'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { EmailOtpType } from '@supabase/supabase-js'

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()

    async function handleAuth() {
      const url = new URL(window.location.href)
      const code = url.searchParams.get('code')
      const token_hash = url.searchParams.get('token_hash')
      const type = url.searchParams.get('type') as EmailOtpType | null

      // Invite / email OTP flow — token_hash + type
      if (token_hash && type) {
        const { error } = await supabase.auth.verifyOtp({ token_hash, type })
        if (!error) { router.push('/dashboard'); return }
      }

      // PKCE flow — code exchange (browser client can handle invite codes without a verifier)
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) { router.push('/dashboard'); return }
      }

      // Implicit flow — hash fragment tokens are auto-processed by the Supabase browser client
      const { data: { session } } = await supabase.auth.getSession()
      if (session) { router.push('/dashboard'); return }

      router.push('/login?error=auth_failed')
    }

    handleAuth()
  }, [router])

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-gray-400 text-sm">Signing you in...</p>
    </div>
  )
}
