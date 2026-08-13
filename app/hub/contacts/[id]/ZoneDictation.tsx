'use client'

import { useCallback, useRef, useState } from 'react'
import type { IrrigationZone } from '@/lib/irrigation'
import { useAudioRecorder } from './useAudioRecorder'

// Capture card above the zone list: talk through the yard, or type the same
// notes. Both go to the same endpoint — typing is not a lesser fallback, it's
// the path that works with no microphone permission at all (and the one a tech
// with a cracked screen protector in bright sun will actually use).

const inp = 'w-full px-3 py-2.5 rounded-md bg-white/5 border border-white/10 text-white placeholder-white/30'

function mmss(total: number) {
  const m = Math.floor(total / 60), s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function ZoneDictation({ contactId, inspectionId, onZones }: {
  contactId: string
  inspectionId: string
  onZones: (zones: Partial<IrrigationZone>[], transcript: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [typing, setTyping] = useState(false)
  const [note, setNote] = useState('')
  const [heard, setHeard] = useState('')
  const [msg, setMsg] = useState('')
  const [failed, setFailed] = useState(false)
  const lastClip = useRef<Blob | null>(null)

  const send = useCallback(async (body: FormData | string, clip: Blob | null) => {
    setBusy(true); setMsg(''); setFailed(false)
    lastClip.current = clip
    try {
      const res = await fetch(`/api/hub/contacts/${contactId}/irrigation/${inspectionId}/dictate`, {
        method: 'POST',
        ...(typeof body === 'string'
          ? { headers: { 'Content-Type': 'application/json' }, body }
          : { body }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFailed(true)
        setMsg(j.error || 'Could not read those notes')
        return
      }
      setHeard(j.transcript || '')
      const zones: Partial<IrrigationZone>[] = Array.isArray(j.zones) ? j.zones : []
      if (zones.length === 0) {
        setMsg(j.transcript ? 'No zones found in that — try naming the zone number first' : 'Didn’t catch any speech')
        return
      }
      onZones(zones, j.transcript || '')
      setNote('')
    } catch {
      setFailed(true)
      setMsg('Network error — your recording is still here, try again')
    } finally {
      setBusy(false)
    }
  }, [contactId, inspectionId, onZones])

  const handleClip = useCallback((blob: Blob) => {
    const fd = new FormData()
    fd.append('audio', new File([blob], 'zones.webm', { type: blob.type || 'audio/webm' }))
    void send(fd, blob)
  }, [send])

  const rec = useAudioRecorder(handleClip)
  const recording = rec.state === 'recording'

  function retry() {
    if (lastClip.current) { handleClip(lastClip.current); return }
    if (note.trim()) void send(JSON.stringify({ text: note.trim() }), null)
  }

  return (
    <div className="border border-sky-500/30 bg-sky-500/[0.07] rounded-lg p-3 mb-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[13px] font-medium text-sky-200">Add zones by voice</span>
        <button type="button" onClick={() => setTyping(t => !t)}
          className="ml-auto text-[12px] text-white/50 hover:text-white/80 underline underline-offset-2">
          {typing ? 'Use the mic' : 'Type instead'}
        </button>
      </div>

      {!typing && (
        <>
          <button
            type="button"
            onClick={() => (recording ? rec.stop() : void rec.start())}
            disabled={busy}
            className={`w-full min-h-[52px] rounded-md text-[15px] font-medium flex items-center justify-center gap-2 transition disabled:opacity-60 ${
              recording ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-sky-600 hover:bg-sky-500 text-white'
            }`}
          >
            {busy ? 'Reading your notes…'
              : recording ? <>● Stop &amp; fill zones · {mmss(rec.seconds)}</>
              : <>🎙 Start talking</>}
          </button>
          {recording && (
            <button type="button" onClick={rec.cancel}
              className="mt-2 w-full text-[12px] text-white/45 hover:text-white/70">
              Discard recording
            </button>
          )}
          {!recording && !busy && (
            <p className="mt-2 text-[11px] text-white/40 leading-relaxed">
              Say the zone number first, then what you see: “Zone three, front lawn, turf, rotors,
              six heads, full sun — one broken head spraying the driveway.” Keep going for as many
              zones as you like.
            </p>
          )}
          {rec.error && <p className="mt-2 text-[12px] text-amber-400">{rec.error}</p>}
        </>
      )}

      {typing && (
        <>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={4}
            placeholder="Zone 1 front lawn, rotors, 6 heads, full sun. Zone 2 side beds, drip, shade…"
            className={`${inp} resize-none`}
            style={{ fontSize: 16 }}
          />
          <button
            type="button"
            disabled={busy || !note.trim()}
            onClick={() => void send(JSON.stringify({ text: note.trim() }), null)}
            className="mt-2 w-full min-h-[46px] rounded-md bg-sky-600 hover:bg-sky-500 text-white text-[15px] font-medium disabled:opacity-40"
          >
            {busy ? 'Reading your notes…' : 'Fill zones from these notes'}
          </button>
        </>
      )}

      {heard && (
        <div className="mt-3 text-[12px] text-white/55 leading-relaxed border-t border-white/10 pt-2">
          <span className="text-white/35">Heard: </span>{heard}
        </div>
      )}
      {msg && (
        <div className="mt-2 text-[12px] text-amber-400 flex items-center gap-2">
          <span>{msg}</span>
          {failed && (
            <button type="button" onClick={retry} className="underline underline-offset-2 hover:text-amber-300">
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  )
}
