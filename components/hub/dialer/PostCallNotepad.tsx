'use client'

// The notepad, after the call has ended.
//
// The in-call notepad lives inside ActiveCall, which unmounts the moment the
// call ends — so the box vanished mid-sentence, which is the exact thing the
// notepad exists to prevent. (The typed words survived in the draft, but there
// was no way to finish or save them.) This keeps a notepad on screen after a
// connected call, from any page, pre-filled with whatever was being typed.
//
// It attaches to the call it belongs to: DialerProvider captures the conference
// room WHILE the call is live and hands it over here. Without that, the server
// falls back to "this user's most recent call in the last 6 hours" — which is
// the wrong call as soon as the next one comes in.
//
// ⚠ Dismissal is deliberately asymmetric, because a card after every single
// call would be clutter for someone taking dozens a day, but a card that
// disappears while you're mid-thought is the original bug:
//   - nothing typed  → it clears itself after a minute, like the wrap-up prompt
//   - anything typed → it stays until you save or close it. No timer can be
//                      right when someone is still writing.

import { useCallback, useEffect, useRef, useState } from 'react'
import CallNotepad from './CallNotepad'

const EMPTY_DISMISS_MS = 60_000

export default function PostCallNotepad({
  number,
  room,
  contactName,
  raised = false,
  onDismiss,
}: {
  number: string | null
  room: string | null
  contactName: string | null
  /** Sit above the wrap-up disposition prompt when that's on screen too. */
  raised?: boolean
  onDismiss: () => void
}) {
  const [hasText, setHasText] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Stable identity: CallNotepad calls this from an effect, so a new function
  // each render would re-fire it every render.
  const handleHasTextChange = useCallback((v: boolean) => setHasText(v), [])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (hasText) return // someone is writing — never time out under them
    timer.current = setTimeout(onDismiss, EMPTY_DISMISS_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [hasText, onDismiss])

  return (
    <div
      className={`fixed left-1/2 -translate-x-1/2 z-[64] w-[min(92vw,30rem)] ${
        raised ? 'bottom-28' : 'bottom-4'
      }`}
    >
      <div className="rounded-xl bg-[var(--t-panel-deep)] text-white border border-white/15 shadow-2xl px-4 py-3">
        <div className="flex items-center justify-between mb-2 gap-2">
          <div className="text-xs text-white/60 min-w-0 truncate">
            Notes{contactName ? ` · ${contactName}` : ''}
            {hasText && <span className="text-white/40"> · unsaved</span>}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="text-white/40 hover:text-white text-sm leading-none px-1 shrink-0"
            aria-label="Close notes"
          >
            ✕
          </button>
        </div>
        {/* compact: this is a floating card over whatever page you're on, not
            the full call screen. */}
        <CallNotepad
          number={number}
          room={room}
          compact
          autoFocus
          onHasTextChange={handleHasTextChange}
        />
      </div>
    </div>
  )
}
