'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback`,
      },
    })

    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-white tracking-tight">Lynxedo</h1>
          <p className="text-gray-400 mt-2 text-sm">Route optimization for field service teams</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
          {sent ? (
            <div className="text-center">
              <div className="text-4xl mb-4">📬</div>
              <h2 className="text-white font-semibold text-lg mb-2">Check your email</h2>
              <p className="text-gray-400 text-sm">
                We sent a magic link to <span className="text-white">{email}</span>.
                Click it to sign in.
              </p>
              <button
                onClick={() => setSent(false)}
                className="mt-6 text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-white font-semibold text-lg mb-6">Sign in</h2>
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Email address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-2.5 text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                  />
                </div>

                {error && (
                  <p className="text-red-400 text-sm">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium rounded-lg py-2.5 text-sm transition-colors"
                >
                  {loading ? 'Sending...' : 'Send magic link'}
                </button>
              </form>
              <p className="text-gray-500 text-xs text-center mt-4">
                No password needed — we'll email you a sign-in link.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
