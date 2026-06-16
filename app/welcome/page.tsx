'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Shown to a signed-in account that isn't attached to any company yet. New
// sign-ups (incl. Sign in with Apple) only auto-join a company when their email
// domain matches a registered company's google_domain (see handle_new_user);
// everyone else lands here instead of an empty Hub.
export default function WelcomePage() {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = async () => {
    setSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <h1 className="text-white font-semibold text-2xl mb-3">You&apos;re signed in</h1>
        <p className="text-gray-400 text-sm leading-relaxed mb-8">
          Your account isn&apos;t connected to a workspace yet. If your team uses Lynxedo,
          ask your administrator to add you, then sign in again. Otherwise, get in touch
          at{' '}
          <a href="mailto:hello@lynxedo.com" className="text-blue-400 hover:text-blue-300">
            hello@lynxedo.com
          </a>{' '}
          to get started.
        </p>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="w-full bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white font-medium rounded-lg py-2.5 text-sm transition-colors"
        >
          {signingOut ? 'Signing out...' : 'Sign out'}
        </button>
      </div>
    </div>
  )
}
