'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAudioRecorder } from './useAudioRecorder'

// Final notes & recommendations — the tech's closing word on the inspection.
// 🎙 Talk to type: tap, talk, tap — the words land in the box (added to what's
// there, never replacing it). ✨ Polish cleans up the fumbling for the customer;
// ↩ Undo puts the original back until the tech edits again.

const inp = 'w-full px-3 py-2.5 rounded-md bg-white/5 border border-white/10 text-white placeholder-white/30'

function mmss(total: number) {
  const m = Math.floor(total / 60), s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function FinalNotes({ contactId, inspectionId, value, onChange }: {
  contactId: string
  inspectionId: string
  value: string
  onChange: (v: string) => void
}) {
  const [busy, setBusy] = useState<'' | 'transcribing' | 'polishing'>('')
  const [msg, setMsg] = useState('')
  const [undo, setUndo] = useState<string | null>(null)
  const valueRef = useRef(value)
  useEffect(() => { valueRef.current = value }, [value])
  const lastClip = useRef<Blob | null>(null)
  const [canRetry, setCanRetry] = useState(false)

  const url = `/api/hub/contacts/${contactId}/irrigation/${inspectionId}/notes`

  const handleClip = useCallback(async (blob: Blob) => {
    lastClip.current = blob
    setBusy('transcribing'); setMsg(''); setCanRetry(false)
    try {
      const fd = new FormData()
      fd.append('audio', new File([blob], 'notes.webm', { type: blob.type || 'audio/webm' }))
      const res = await fetch(url, { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setMsg(j.error || 'Could not transcribe that'); setCanRetry(true); return }
      const t = String(j.transcript || '').trim()
      if (!t) { setMsg('Didn’t catch any speech'); return }
      const cur = valueRef.current.trim()
      onChange(cur ? `${cur} ${t}` : t)
      setUndo(null)
      lastClip.current = null
    } catch {
      setMsg('Network error — your recording is still here, try again')
      setCanRetry(true)
    } finally {
      setBusy('')
    }
  }, [url, onChange])

  const rec = useAudioRecorder(blob => { void handleClip(blob) })
  const recording = rec.state === 'recording'

  async function polish() {
    const text = valueRef.current.trim()
    if (!text || busy) return
    setBusy('polishing'); setMsg(''); setCanRetry(false)
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.polished) { setMsg(j.error || 'Could not polish the notes — try again'); return }
      setUndo(valueRef.current)
      onChange(String(j.polished))
    } catch {
      setMsg('Network error — your notes are unchanged')
    } finally {
      setBusy('')
    }
  }

  return (
    <div>
      <div className="flex gap-2 mb-2">
        <button
          type="button"
          onClick={() => (recording ? rec.stop() : void rec.start())}
          disabled={!!busy}
          className={`flex-1 min-h-[48px] rounded-md text-[15px] font-medium flex items-center justify-center gap-2 transition disabled:opacity-60 ${
            recording ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-sky-600 hover:bg-sky-500 text-white'
          }`}
        >
          {busy === 'transcribing' ? 'Writing it down…'
            : recording ? <>● Stop · {mmss(rec.seconds)}</>
            : <>🎙 Talk</>}
        </button>
        <button
          type="button"
          onClick={() => void polish()}
          disabled={!!busy || recording || !value.trim()}
          className="flex-1 min-h-[48px] rounded-md text-[15px] font-medium bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40"
        >
          {busy === 'polishing' ? 'Polishing…' : '✨ Polish'}
        </button>
      </div>
      {recording && (
        <button type="button" onClick={rec.cancel} className="mb-2 w-full text-[12px] text-white/45 hover:text-white/70">
          Discard recording
        </button>
      )}

      <textarea
        value={value}
        onChange={e => { onChange(e.target.value); setUndo(null) }}
        rows={5}
        placeholder="Anything else the customer should know — tap 🎙 Talk and say it, or type it here"
        className={`${inp} resize-y`}
        style={{ fontSize: 16 }}
      />

      {undo !== null && (
        <div className="mt-1.5 flex items-center gap-2 text-[12px] text-violet-300">
          <span>Polished — check it reads right.</span>
          <button type="button" onClick={() => { onChange(undo); setUndo(null) }}
            className="underline underline-offset-2 hover:text-violet-200">
            ↩ Undo
          </button>
        </div>
      )}
      {rec.error && <p className="mt-1.5 text-[12px] text-amber-400">{rec.error}</p>}
      {msg && (
        <div className="mt-1.5 text-[12px] text-amber-400 flex items-center gap-2">
          <span>{msg}</span>
          {canRetry && !busy && (
            <button type="button" onClick={() => { if (lastClip.current) void handleClip(lastClip.current) }}
              className="underline underline-offset-2 hover:text-amber-300">
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  )
}
