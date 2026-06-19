'use client'

import { useCallback, useEffect, useState } from 'react'

// Home-screen acknowledgement gate. Once a worker is clocked in, any active
// ANNOUNCEMENT (not shout-out) they haven't acknowledged pops a blocking modal
// on the Home screen — they must acknowledge each before continuing. Acks are
// remembered per-person-per-announcement (server table), so each message only
// stops them once; a brand-new announcement re-triggers the gate, including on
// a future day's clock-in.

type Pending = {
  id: string
  content: string
  expires_at: string
  created_at: string
}

export default function AnnouncementAckGate({
  clockedInInitial,
}: {
  clockedInInitial: boolean
}) {
  const [pending, setPending] = useState<Pending[]>([])
  const [acking, setAcking] = useState<string | null>(null)

  const fetchPending = useCallback(async () => {
    try {
      const res = await fetch('/api/hub/announcements/acknowledge')
      if (!res.ok) return
      const data = (await res.json()) as { pending?: Pending[] }
      setPending(data.pending ?? [])
    } catch {
      /* non-fatal — never block the Home screen on a fetch error */
    }
  }, [])

  // Fire when clocked in on load, and again the moment the worker clocks in
  // during the session (the time-clock card dispatches this event).
  useEffect(() => {
    if (clockedInInitial) fetchPending()
    const onClockedIn = () => fetchPending()
    window.addEventListener('lynxedo:clocked-in', onClockedIn)
    return () => window.removeEventListener('lynxedo:clocked-in', onClockedIn)
  }, [clockedInInitial, fetchPending])

  async function acknowledge(id: string) {
    if (acking) return
    setAcking(id)
    try {
      const res = await fetch('/api/hub/announcements/acknowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ announcement_id: id }),
      })
      // Remove it locally on success (or on a benign duplicate) so the gate
      // closes once everything's been read.
      if (res.ok) setPending(prev => prev.filter(p => p.id !== id))
    } finally {
      setAcking(null)
    }
  }

  if (pending.length === 0) return null

  const total = pending.length

  return (
    <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Please read these announcements"
      >
        <div className="px-6 pt-5 pb-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-xl">📢</span>
            <h2 className="text-lg font-bold text-white">
              Please read{total > 1 ? ` (${total})` : ''}
            </h2>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Acknowledge {total > 1 ? 'each announcement' : 'this announcement'} to continue. You&apos;ll only see {total > 1 ? 'them' : 'it'} once.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {pending.map(a => (
            <div key={a.id} className="bg-[#0F2D45] border border-white/10 rounded-xl p-4">
              <p className="text-white whitespace-pre-wrap break-words">{a.content}</p>
              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => acknowledge(a.id)}
                  disabled={acking === a.id}
                  className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-50 text-sm text-white font-medium transition-colors"
                >
                  {acking === a.id ? 'Saving…' : '✓ Got it'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
