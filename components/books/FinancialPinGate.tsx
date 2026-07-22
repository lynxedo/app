'use client'

import { useState, useRef, useEffect } from 'react'

interface Props {
  defaultUnlocked: boolean
  children: React.ReactNode
  /** Company display name shown on the PIN screen. Defaults to the current Heroes value. */
  businessName?: string
}

export default function FinancialPinGate({ defaultUnlocked, children, businessName = 'Heroes Lawn Care' }: Props) {
  const [unlocked, setUnlocked] = useState(defaultUnlocked)
  const [visible, setVisible] = useState(!defaultUnlocked)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (visible) inputRef.current?.focus()
  }, [visible])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/verify-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({ pin }),
      })

      if (res.ok) {
        setUnlocked(true)
        // fade out overlay before unmounting
        setTimeout(() => setVisible(false), 400)
      } else {
        setError('Incorrect PIN. Please try again.')
        setPin('')
        inputRef.current?.focus()
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {(unlocked || !visible) && children}

      {visible && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-gray-950/90 backdrop-blur-sm transition-opacity duration-400 ${
            unlocked ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          <div className="w-full max-w-sm mx-4 bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">
            <div className="text-center mb-8">
              <div className="text-3xl font-bold text-white mb-1">{businessName}</div>
              <div className="text-gray-400 text-sm">Financial Access Required</div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <input
                  ref={inputRef}
                  type="password"
                  inputMode="numeric"
                  value={pin}
                  onChange={e => setPin(e.target.value)}
                  placeholder="Enter PIN"
                  disabled={loading}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white text-center text-xl tracking-widest placeholder:text-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                  autoComplete="off"
                />
              </div>

              {error && (
                <p className="text-red-400 text-sm text-center">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || pin.length === 0}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-[#fff] font-semibold py-3 rounded-lg transition-colors"
              >
                {loading ? 'Verifying…' : 'Unlock'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
