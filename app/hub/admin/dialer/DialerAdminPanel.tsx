'use client'

import { useState, useRef } from 'react'

type Settings = {
  inbound_route_user_id: string | null
  ring_timeout_sec: number
  voicemail_recipient_user_ids: string[]
  fallback_voicemail_url: string | null
}

type HubUser = { id: string; display_name: string }

export default function DialerAdminPanel({
  initial,
  hubUsers,
}: {
  initial: Settings
  hubUsers: HubUser[]
}) {
  const [s, setS] = useState<Settings>(initial)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/dialer-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inbound_route_user_id: s.inbound_route_user_id,
          ring_timeout_sec: s.ring_timeout_sec,
          voicemail_recipient_user_ids: s.voicemail_recipient_user_ids,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Save failed (${res.status})`)
      }
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function uploadGreeting(file: File) {
    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/admin/dialer/general-greeting', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Upload failed (${res.status})`)
      }
      const data = await res.json()
      setS((prev) => ({ ...prev, fallback_voicemail_url: data.url }))
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function clearGreeting() {
    if (!confirm('Remove the custom greeting? Callers will hear the spoken default.')) return
    setUploading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/dialer/general-greeting', { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Clear failed (${res.status})`)
      }
      setS((prev) => ({ ...prev, fallback_voicemail_url: null }))
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  function toggleId(field: 'voicemail_recipient_user_ids', id: string) {
    setS((prev) => {
      const set = new Set(prev[field])
      if (set.has(id)) set.delete(id)
      else set.add(id)
      return { ...prev, [field]: [...set] }
    })
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Dialer</h1>
        <p className="text-sm text-white/60 mt-1">
          Inbound call routing, ring timeout, and voicemail notifications.
        </p>
      </header>

      <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
        <header>
          <h2 className="font-semibold">Inbound routing</h2>
          <p className="text-xs text-white/50 mt-1">
            Where calls to the Dialer number ring first. If no one is set, every
            call goes straight to voicemail.
          </p>
        </header>

        <div>
          <label className="block text-sm font-medium mb-1">Ring this person</label>
          <select
            value={s.inbound_route_user_id ?? ''}
            onChange={(e) =>
              setS((prev) => ({ ...prev, inbound_route_user_id: e.target.value || null }))
            }
            className="bg-gray-900 border border-white/15 rounded px-2 py-1.5 text-sm w-full max-w-xs"
          >
            <option value="">— No one (always voicemail) —</option>
            {hubUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.display_name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Ring for</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={s.ring_timeout_sec}
              min={5}
              max={120}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (Number.isFinite(v)) {
                  setS((prev) => ({ ...prev, ring_timeout_sec: v }))
                }
              }}
              className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm w-20"
            />
            <span className="text-sm text-white/60">seconds before voicemail</span>
          </div>
          <p className="text-xs text-white/40 mt-1">5–120 seconds. Default 20.</p>
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
        <header>
          <h2 className="font-semibold">Voicemail greeting</h2>
          <p className="text-xs text-white/50 mt-1">
            Plays before the beep. MP3 or WAV, 2 MB max. Without a custom
            greeting we use a spoken default.
          </p>
        </header>

        {s.fallback_voicemail_url ? (
          <div className="flex items-center gap-3 flex-wrap">
            <audio
              src={s.fallback_voicemail_url}
              controls
              preload="metadata"
              className="h-8 max-w-xs"
            />
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
          <p className="text-sm text-white/50">No custom greeting uploaded.</p>
        )}

        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) uploadGreeting(file)
            }}
            disabled={uploading}
            className="text-xs text-white/70 file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-[#2E7EB8] file:text-white file:text-sm hover:file:bg-[#3a8dc9] file:cursor-pointer"
          />
          {uploading && <span className="ml-2 text-xs text-white/50">Uploading…</span>}
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
        <header>
          <h2 className="font-semibold">Notify on new voicemail</h2>
          <p className="text-xs text-white/50 mt-1">
            These users get a push notification (and any DND/notification
            preferences they have) whenever a voicemail lands.
          </p>
        </header>

        <RecipientGrid
          empty="No users in this company yet."
          items={hubUsers.map((u) => ({ id: u.id, label: u.display_name }))}
          selected={s.voicemail_recipient_user_ids}
          onToggle={(id) => toggleId('voicemail_recipient_user_ids', id)}
        />
      </section>

      {error && (
        <div className="rounded-md border border-red-700 bg-red-900/30 text-red-200 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded bg-[#2E7EB8] hover:bg-[#3a8dc9] disabled:opacity-50 text-sm font-medium"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {savedAt && !error && (
          <span className="text-xs text-emerald-300">Saved ✓</span>
        )}
      </div>
    </div>
  )
}

function RecipientGrid({
  empty,
  items,
  selected,
  onToggle,
}: {
  empty: string
  items: { id: string; label: string }[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  const selectedSet = new Set(selected)
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium">Recipients</span>
        <span className="text-xs text-white/40">{selectedSet.size} selected</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-white/50">{empty}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {items.map((it) => {
            const on = selectedSet.has(it.id)
            return (
              <label
                key={it.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                  on
                    ? 'bg-[#2E7EB8]/20 border-[#2E7EB8]/40'
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onToggle(it.id)}
                  className="accent-[#2E7EB8]"
                />
                <span className="text-sm">{it.label}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
