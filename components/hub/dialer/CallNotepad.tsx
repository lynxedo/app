'use client'

// The dialer notepad — for typing while you're on the call.
//
// This replaces a 2-row box hidden behind a chip. Three things were wrong with
// that and all three lost work:
//
//  1. Nothing was saved until you pressed Save, so a call ending (or the panel
//     closing, or a tab switch) threw away whatever was half-typed. Notes get
//     written DURING a call, which is exactly when the call is most likely to
//     end. The draft now autosaves to this browser and is restored on the next
//     render, so the only way to lose it is to clear it yourself.
//  2. Saving OVERWROTE the previous note. The server appends now, and this shows
//     the running list.
//  3. Nothing ever displayed the notes again. They're now shown here and in the
//     Call Log detail.
//
// The draft key is the phone number, not the call: a note half-typed as a call
// drops should still be there when you call that person straight back, which is
// the actual scramble this is for.

import { useCallback, useEffect, useRef, useState } from 'react'

const DRAFT_PREFIX = 'dialer:note-draft:'

function draftKey(number: string | null): string | null {
  const digits = (number || '').replace(/\D/g, '')
  return digits ? `${DRAFT_PREFIX}${digits}` : null
}

function readDraft(key: string | null): string {
  if (!key || typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(key) || ''
  } catch {
    return '' // private mode / storage disabled — the notepad still works, just without the safety net
  }
}

function writeDraft(key: string | null, value: string) {
  if (!key || typeof window === 'undefined') return
  try {
    if (value.trim()) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export default function CallNotepad({
  number,
  room,
  jobberClientId,
  compact = false,
}: {
  number: string | null
  /** Live conference room, so the note lands on THIS call and not merely the most recent one. */
  room: string | null
  jobberClientId?: string | null
  compact?: boolean
}) {
  const key = draftKey(number)
  const [note, setNote] = useState(() => readDraft(key))
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // Restore the draft when the number changes (a new call on the same mounted
  // panel), so switching calls doesn't carry the last one's text over.
  useEffect(() => {
    setNote(readDraft(key))
    setSaved('')
  }, [key])

  // Autosave. Cheap enough to run per keystroke, and being synchronous means a
  // call that ends mid-word has already persisted the word.
  useEffect(() => {
    writeDraft(key, note)
  }, [key, note])

  // What's already on this call.
  useEffect(() => {
    let cancelled = false
    const qs = room ? `?room=${encodeURIComponent(room)}` : ''
    fetch(`/api/dialer/calls/note${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && typeof d.notes === 'string') setSaved(d.notes)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [room])

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500)
  }

  const save = useCallback(async () => {
    const text = note.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/dialer/calls/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: text,
          room: room || undefined,
          toJobber: !!jobberClientId,
          jobberClientId: jobberClientId || undefined,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        // Deliberately keep the text and the draft on failure — the whole point
        // is that typed words don't evaporate.
        flash('Could not save — your note is still here')
        return
      }
      if (!alive.current) return
      if (typeof body?.notes === 'string') setSaved(body.notes)
      setNote('')
      writeDraft(key, '')
      if (!body?.callId) {
        // No call row to attach to (e.g. a note typed long after the call).
        // Say so rather than implying it was filed against the call.
        flash('Saved, but no call to attach it to')
      } else {
        flash(body?.jobberPosted ? 'Note saved + added to Jobber' : 'Note saved')
      }
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [note, busy, room, jobberClientId, key])

  return (
    <div className="space-y-1.5">
      {saved && (
        <div
          // Capped and scrollable. ActiveCall has no scroll container of its
          // own, so anything unbounded here pushes Hang up below the fold on a
          // short screen — the one control that must never be hard to reach.
          className={`rounded-md bg-black/20 border border-white/10 px-2.5 py-1.5 text-[11px] text-white/70 whitespace-pre-wrap overflow-y-auto ${
            compact ? 'max-h-14' : 'max-h-24'
          }`}
        >
          {saved}
        </div>
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        // 4 rows, not more: double the old box, but ActiveCall doesn't scroll,
        // so height here comes straight out of the call controls' space.
        rows={compact ? 3 : 4}
        placeholder="Notes for this call…"
        // 16px stops iOS zooming the whole panel on focus mid-call.
        style={{ fontSize: 16 }}
        className="w-full rounded-md bg-white/5 border border-white/10 px-2.5 py-1.5 text-white placeholder-white/30 resize-none focus:outline-none focus:ring-1 focus:ring-sky-500"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-white/40 min-w-0 truncate">
          {note.trim()
            ? 'Draft kept on this device'
            : jobberClientId
              ? 'Saves to the call + the Jobber client'
              : 'Saves to the call record'}
        </span>
        <button
          type="button"
          onClick={save}
          disabled={busy || !note.trim()}
          className="px-3 py-1 rounded-md text-xs bg-emerald-600 hover:bg-emerald-500 text-[#fff] disabled:opacity-50 shrink-0"
        >
          {busy ? 'Saving…' : 'Save note'}
        </button>
      </div>
      {toast && <div className="text-[11px] text-emerald-300">{toast}</div>}
    </div>
  )
}
