'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// Home-screen acknowledgement gate. Any active ANNOUNCEMENT (not shout-out) a
// worker hasn't acknowledged pops a blocking modal at the two natural
// "I'm starting work" moments, so it reaches BOTH hourly and salaried staff:
//   1. The instant they clock in (the time-clock card fires `lynxedo:clocked-in`).
//   2. The first time they try to leave the Home screen — clicking anything in the
//      surrounding nav/sidebar/bottom-bar, or an in-content link to another page.
// They tap "✓ Got it" per announcement; if it was a navigate-away, we then send
// them where they were headed. Acks are remembered per-person-per-announcement,
// so each message only stops them once (a new announcement re-triggers it).
//
// Not airtight against the browser/phone Back gesture (can't cancel popstate
// cleanly) — but every tap-based way out of Home is covered.

type Pending = {
  id: string
  content: string
  expires_at: string
  created_at: string
}

export default function AnnouncementAckGate() {
  const router = useRouter()
  const [pending, setPending] = useState<Pending[]>([])
  const [open, setOpen] = useState(false)
  const [acking, setAcking] = useState<string | null>(null)
  // Where the user was trying to go when the gate intercepted them (null when the
  // gate was triggered by a clock-in rather than a navigation attempt).
  const [pendingHref, setPendingHref] = useState<string | null>(null)

  // Refs so the one-time capture-phase click listener always sees current state.
  const pendingRef = useRef<Pending[]>([])
  const openRef = useRef(false)
  pendingRef.current = pending
  openRef.current = open

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

  // Fetch on mount for everyone (so the navigate-away guard knows if anything is
  // pending), and refetch the moment a worker clocks in — which also opens the gate.
  useEffect(() => {
    fetchPending()
    const onClockedIn = async () => {
      await fetchPending()
      if (pendingRef.current.length > 0) {
        setPendingHref(null)
        setOpen(true)
      }
    }
    window.addEventListener('lynxedo:clocked-in', onClockedIn)
    return () => window.removeEventListener('lynxedo:clocked-in', onClockedIn)
  }, [fetchPending])

  // Trigger 2 — intercept the first attempt to leave Home. Capture phase so we
  // beat both <Link> and router.push button handlers. A click counts as
  // "leaving" when it lands outside the Home content root (the nav chrome:
  // sidebar, mobile bar, header) OR on an internal link to a different page.
  useEffect(() => {
    function onCapture(e: MouseEvent) {
      if (pendingRef.current.length === 0 || openRef.current) return
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (!target) return

      const homeRoot = document.querySelector('[data-ack-home-root]')
      const anchor = target.closest('a[href]') as HTMLAnchorElement | null
      const isInternalNavLink =
        !!anchor &&
        anchor.origin === window.location.origin &&
        anchor.target !== '_blank' &&
        anchor.pathname !== window.location.pathname
      const outsideHome = homeRoot ? !homeRoot.contains(target) : false

      if (!isInternalNavLink && !outsideHome) return

      e.preventDefault()
      e.stopPropagation()
      setPendingHref(isInternalNavLink && anchor ? anchor.pathname + anchor.search : null)
      setOpen(true)
    }
    document.addEventListener('click', onCapture, true)
    return () => document.removeEventListener('click', onCapture, true)
  }, [])

  async function acknowledge(id: string) {
    if (acking) return
    setAcking(id)
    try {
      const res = await fetch('/api/hub/announcements/acknowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ announcement_id: id }),
      })
      if (res.ok) {
        const next = pendingRef.current.filter((p) => p.id !== id)
        setPending(next)
        if (next.length === 0) {
          // Everything acknowledged — close, and continue the navigation they
          // were attempting (if any).
          setOpen(false)
          const href = pendingHref
          setPendingHref(null)
          if (href) router.push(href)
        }
      }
    } finally {
      setAcking(null)
    }
  }

  if (!open || pending.length === 0) return null

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
          {pending.map((a) => (
            <div key={a.id} className="bg-[var(--t-panel)] border border-white/10 rounded-xl p-4">
              <p className="text-white whitespace-pre-wrap break-words">{a.content}</p>
              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => acknowledge(a.id)}
                  disabled={acking === a.id}
                  className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-50 text-sm text-[#fff] font-medium transition-colors"
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
