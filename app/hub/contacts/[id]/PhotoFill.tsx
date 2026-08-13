'use client'

import { useCallback, useRef, useState } from 'react'
import type { IrrigationData } from '@/lib/irrigation'
import { PHOTO_SECTIONS, type PhotoSectionKey } from '@/lib/irrigation-fields'

// "Fill from photo" sits with the fields it fills, not in a global toolbar —
// the tech shoots the thing while standing in front of it, and the link between
// this photo and those fields is obvious rather than inferred.

/** Longest edge sent to the server. Plenty to read a model label, and it turns a
 *  4 MB phone photo into ~300 KB — the difference between one second and thirty
 *  on rural LTE. */
const MAX_EDGE = 1600

async function downscale(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 1_200_000) { bitmap.close(); return file }
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) { bitmap.close(); return file }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.85))
    return blob && blob.size > 0 ? blob : file
  } catch {
    // A browser without createImageBitmap still works, just uploads the original.
    return file
  }
}

export default function PhotoFill({ contactId, inspectionId, section, onFields }: {
  contactId: string
  inspectionId: string
  section: PhotoSectionKey
  /** Merges the values in and reports what it actually wrote — fields the tech
   *  had already filled are left alone, so "read 4" and "wrote 4" can differ. */
  onFields: (
    patch: Partial<IrrigationData>, fields: string[], photoKey: string | null, previewUrl: string,
  ) => { written: number; skipped: number }
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [tone, setTone] = useState<'ok' | 'warn'>('ok')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const spec = PHOTO_SECTIONS[section]

  const handle = useCallback(async (file: File | null) => {
    if (!file) return
    setBusy(true); setMsg('')
    try {
      const blob = await downscale(file)
      const fd = new FormData()
      fd.append('section', section)
      fd.append('photo', new File([blob], `${section}.jpg`, { type: blob.type || 'image/jpeg' }))
      const res = await fetch(`/api/hub/contacts/${contactId}/irrigation/${inspectionId}/photo-read`, {
        method: 'POST', body: fd,
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setTone('warn'); setMsg(j.error || 'Could not read that photo'); return }

      const fields: string[] = Array.isArray(j.fields) ? j.fields : []
      const { written, skipped } = onFields(j.patch || {}, fields, j.photoKey ?? null, URL.createObjectURL(blob))
      if (fields.length === 0) {
        setTone('warn')
        setMsg('Nothing readable in that one — try closer, or with the label in frame')
      } else if (written === 0) {
        setTone('ok')
        setMsg('Nothing new — you’d already filled those in')
      } else {
        setTone('ok')
        setMsg(`Filled ${written} field${written === 1 ? '' : 's'} — check the highlighted ones`
          + (skipped > 0 ? ` · ${skipped} left alone (already filled in)` : ''))
      }
    } catch {
      setTone('warn'); setMsg('Network error — try again')
    } finally {
      setBusy(false)
    }
  }, [contactId, inspectionId, section, onFields])

  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="w-full min-h-[44px] rounded-md border border-sky-500/40 bg-sky-500/10 text-sky-200 text-[14px] font-medium flex items-center justify-center gap-2 hover:bg-sky-500/20 disabled:opacity-60"
      >
        {busy ? 'Reading the photo…' : <>📷 Fill from photo</>}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        // Opens the camera straight away on iOS and Android rather than the
        // photo library — the tech is standing in front of the thing.
        capture="environment"
        className="hidden"
        onChange={e => { void handle(e.target.files?.[0] ?? null); e.currentTarget.value = '' }}
      />
      {!busy && !msg && (
        <p className="mt-1.5 text-[11px] text-white/40 leading-relaxed">
          Photograph {spec.shot}. It gets saved with the inspection too.
        </p>
      )}
      {msg && (
        <p className={`mt-1.5 text-[12px] ${tone === 'ok' ? 'text-emerald-300' : 'text-amber-400'}`}>{msg}</p>
      )}
    </div>
  )
}
