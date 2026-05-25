'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type DndWindow = { from: string; to: string }
type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
type DndSchedule = {
  enabled?: boolean
  tz?: string
  days?: Partial<Record<DayKey, DndWindow[]>>
}

const DAY_LABELS: Array<{ key: DayKey; label: string }> = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]

const EMPTY_SCHEDULE: DndSchedule = { enabled: false, tz: 'America/Chicago', days: {} }

export default function DialerPersonalSettings() {
  const supabase = createClient()
  const [loaded, setLoaded] = useState(false)
  const [dndOn, setDndOn] = useState(false)
  const [schedule, setSchedule] = useState<DndSchedule>(EMPTY_SCHEDULE)
  const [greetingUrl, setGreetingUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('user_profiles')
        .select('dialer_dnd_enabled, dialer_dnd_schedule, voicemail_greeting_url')
        .eq('id', user.id)
        .single()
      if (cancelled) return
      setDndOn(Boolean(data?.dialer_dnd_enabled))
      const sched = (data?.dialer_dnd_schedule || {}) as DndSchedule
      setSchedule({
        enabled: sched.enabled ?? false,
        tz: sched.tz || 'America/Chicago',
        days: sched.days || {},
      })
      setGreetingUrl(data?.voicemail_greeting_url ?? null)
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [supabase])

  async function patchProfile(body: Record<string, unknown>) {
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `Save failed (${res.status})`)
      }
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  function toggleDnd(next: boolean) {
    setDndOn(next)
    patchProfile({ dialer_dnd_enabled: next })
  }

  function addWindow(day: DayKey) {
    const next: DndSchedule = {
      ...schedule,
      days: {
        ...(schedule.days || {}),
        [day]: [...(schedule.days?.[day] || []), { from: '18:00', to: '08:00' }],
      },
    }
    setSchedule(next)
    patchProfile({ dialer_dnd_schedule: next })
  }

  function removeWindow(day: DayKey, idx: number) {
    const arr = (schedule.days?.[day] || []).slice()
    arr.splice(idx, 1)
    const nextDays = { ...(schedule.days || {}) }
    if (arr.length === 0) delete nextDays[day]
    else nextDays[day] = arr
    const next: DndSchedule = { ...schedule, days: nextDays }
    setSchedule(next)
    patchProfile({ dialer_dnd_schedule: next })
  }

  function patchWindow(day: DayKey, idx: number, patch: Partial<DndWindow>) {
    const arr = (schedule.days?.[day] || []).slice()
    arr[idx] = { ...arr[idx], ...patch }
    const next: DndSchedule = {
      ...schedule,
      days: { ...(schedule.days || {}), [day]: arr },
    }
    setSchedule(next)
  }

  function commitWindow() {
    patchProfile({ dialer_dnd_schedule: schedule })
  }

  function toggleScheduleEnabled(on: boolean) {
    const next: DndSchedule = { ...schedule, enabled: on }
    setSchedule(next)
    patchProfile({ dialer_dnd_schedule: next })
  }

  async function uploadGreeting(file: File) {
    setUploading(true)
    setErr(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/dialer/user-greeting', { method: 'POST', body: fd })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `Upload failed (${res.status})`)
      }
      const data = await res.json()
      setGreetingUrl(data.url)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function clearGreeting() {
    if (!confirm('Remove your custom voicemail greeting?')) return
    setUploading(true)
    setErr(null)
    try {
      const res = await fetch('/api/dialer/user-greeting', { method: 'DELETE' })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `Clear failed (${res.status})`)
      }
      setGreetingUrl(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  if (!loaded) return null

  return (
    <div className="mt-6 pt-6 border-t border-gray-800 space-y-6">
      {/* DND */}
      <div>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={dndOn}
            onChange={(e) => toggleDnd(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-gray-700 bg-gray-950 text-orange-500 focus:ring-orange-500 focus:ring-offset-0"
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Do not disturb (Dialer)</div>
            <p className="text-xs text-gray-500 mt-1">
              When on, inbound IVR transfers and ring groups skip you. Calls go
              to other group members (or to voicemail if no one's available).
              This is independent of your Hub status dot.
            </p>
          </div>
        </label>
      </div>

      {/* Schedule */}
      <div>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(schedule.enabled)}
            onChange={(e) => toggleScheduleEnabled(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-gray-700 bg-gray-950 text-orange-500 focus:ring-orange-500 focus:ring-offset-0"
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Scheduled DND windows</div>
            <p className="text-xs text-gray-500 mt-1">
              Auto-DND during set hours (e.g. 6 PM to 8 AM). Times are in your
              local zone ({schedule.tz || 'America/Chicago'}). Wrap-overnight
              ranges work (set "from" later than "to").
            </p>
          </div>
        </label>

        {schedule.enabled && (
          <div className="mt-4 space-y-2">
            {DAY_LABELS.map(({ key, label }) => {
              const windows = schedule.days?.[key] || []
              return (
                <div key={key} className="flex items-start gap-3 px-3 py-2 rounded border border-gray-800 bg-gray-950/50">
                  <span className="text-xs text-gray-400 w-10 mt-2 font-mono">{label}</span>
                  <div className="flex-1 space-y-1.5">
                    {windows.length === 0 ? (
                      <span className="text-xs text-gray-500">No windows.</span>
                    ) : (
                      windows.map((w, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-sm">
                          <input
                            type="time"
                            value={w.from}
                            onChange={(e) => patchWindow(key, idx, { from: e.target.value })}
                            onBlur={commitWindow}
                            className="bg-gray-900 border border-gray-700 rounded px-2 py-0.5 text-sm w-28"
                          />
                          <span className="text-xs text-gray-500">to</span>
                          <input
                            type="time"
                            value={w.to}
                            onChange={(e) => patchWindow(key, idx, { to: e.target.value })}
                            onBlur={commitWindow}
                            className="bg-gray-900 border border-gray-700 rounded px-2 py-0.5 text-sm w-28"
                          />
                          <button
                            type="button"
                            onClick={() => removeWindow(key, idx)}
                            className="text-xs text-gray-500 hover:text-red-400 ml-1"
                          >
                            ✕
                          </button>
                        </div>
                      ))
                    )}
                    <button
                      type="button"
                      onClick={() => addWindow(key)}
                      className="text-xs text-gray-400 hover:text-white"
                    >
                      + add window
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Per-user voicemail greeting */}
      <div>
        <div className="text-sm font-medium">My voicemail greeting</div>
        <p className="text-xs text-gray-500 mt-1">
          MP3 or WAV, 2 MB max. Plays when callers reach your personal voicemail
          (after a direct ring or an IVR transfer). Without one, callers hear a
          spoken default that names you.
        </p>
        <div className="mt-3 space-y-2">
          {greetingUrl ? (
            <div className="flex items-center gap-3 flex-wrap">
              <audio src={greetingUrl} controls preload="metadata" className="h-8 max-w-xs" />
              <button
                type="button"
                onClick={clearGreeting}
                disabled={uploading}
                className="px-3 py-1.5 rounded text-xs border border-red-700/40 text-red-300 hover:bg-red-900/30 disabled:opacity-50"
              >
                Remove greeting
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No custom greeting uploaded.</p>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) uploadGreeting(f)
            }}
            disabled={uploading}
            className="text-xs text-gray-300 file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-orange-600 file:text-white file:text-sm hover:file:bg-orange-500 file:cursor-pointer"
          />
          {uploading && <span className="ml-2 text-xs text-gray-400">Uploading…</span>}
        </div>
      </div>

      {err && <p className="text-red-400 text-xs">{err}</p>}
      {savedFlash && <p className="text-green-400 text-xs">Saved.</p>}
      {saving && !savedFlash && !err && <p className="text-gray-500 text-xs">Saving…</p>}
    </div>
  )
}
