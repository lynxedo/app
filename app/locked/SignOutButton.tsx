'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function SignOutButton() {
  const [busy, setBusy] = useState(false)

  async function handleSignOut() {
    setBusy(true)
    try {
      await createClient().auth.signOut()
    } catch {
      // fall through — the login page clears any stale session
    }
    window.location.href = '/login'
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={busy}
      className="w-full bg-gray-800 hover:bg-gray-700 disabled:opacity-60 border border-gray-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
