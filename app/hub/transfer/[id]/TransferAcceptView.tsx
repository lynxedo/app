'use client'

import { useState } from 'react'

type View = 'pending' | 'connecting' | 'taken' | 'gone' | 'error'

function initialView(status: string): View {
  if (status === 'pending') return 'pending'
  if (status === 'accepted' || status === 'connected') return 'taken'
  return 'gone' // timed_out / gone / unknown
}

export default function TransferAcceptView({
  attemptId,
  initialStatus,
  caller,
}: {
  attemptId: string
  initialStatus: string
  caller: string
}) {
  const [view, setView] = useState<View>(initialView(initialStatus))
  const [busy, setBusy] = useState(false)

  async function take() {
    setBusy(true)
    try {
      const res = await fetch('/api/voice/transfer/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId }),
      })
      const body = await res.json().catch(() => null)
      if (body?.ok) setView('connecting')
      else if (body?.taken) setView('taken')
      else setView('error')
    } catch {
      setView('error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="w-full max-w-sm border border-white/10 rounded-xl p-6 text-center space-y-4">
        <div className="text-4xl" aria-hidden>📞</div>
        <h1 className="text-lg font-semibold text-white">Caller on hold</h1>
        <p className="text-sm text-white/60">{caller} is waiting to speak with someone.</p>

        {view === 'pending' && (
          <button
            onClick={take}
            disabled={busy}
            className="w-full px-4 py-3 rounded-lg bg-brand hover:bg-brand-light disabled:opacity-50 text-sm font-semibold text-white"
          >
            {busy ? 'Connecting…' : 'Take the call'}
          </button>
        )}
        {view === 'connecting' && (
          <p className="text-sm text-emerald-300">
            Connecting — your Dialer will ring in a moment. Answer it to talk to the caller.
          </p>
        )}
        {view === 'taken' && (
          <p className="text-sm text-amber-300/90">This call was already taken by someone else.</p>
        )}
        {view === 'gone' && (
          <p className="text-sm text-white/50">
            This call is no longer waiting — the caller left a message or hung up.
          </p>
        )}
        {view === 'error' && (
          <p className="text-sm text-red-400">Something went wrong — the caller may have already been handled.</p>
        )}
      </div>
    </div>
  )
}
