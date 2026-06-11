'use client'

import { useState, useRef } from 'react'

type HubUser = { id: string; display_name: string }

// Admin panel for configuring who receives push notifications when a
// customer replies to a Guardian / Responder auto-text message.
// Guardian never auto-responds — a human picks up the conversation.
export default function ResponderNotifyPanel({
  initialNotifyIds,
  users,
}: {
  initialNotifyIds: string[]
  users: HubUser[]
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialNotifyIds))
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const valuesRef = useRef({ selected })
  valuesRef.current = { selected }
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function save() {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/txt/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responder_notify_user_ids: [...valuesRef.current.selected] }),
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

  function scheduleSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(save, 500)
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    scheduleSave()
  }

  const savedRecently = savedAt !== null && Date.now() - savedAt < 2500

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-white">Responder reply notifications</h2>
        <p className="text-xs text-gray-400 mt-1">
          When a customer replies to a Guardian auto-text, these team members are
          notified so a human can take over the conversation. Guardian never
          auto-responds to customer replies.
        </p>
      </div>

      <div className="space-y-1">
        {users.map((u) => (
          <label key={u.id} className="flex items-center gap-3 py-2 px-3 rounded-md cursor-pointer hover:bg-white/5">
            <input
              type="checkbox"
              checked={selected.has(u.id)}
              onChange={() => toggle(u.id)}
              className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0"
            />
            <span className="text-sm text-white">{u.display_name}</span>
          </label>
        ))}
        {users.length === 0 && (
          <p className="text-xs text-gray-500 py-2">No team members found.</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {savedRecently && <span className="text-xs text-emerald-400">Saved ✓</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
        {selected.size === 0 && (
          <span className="text-xs text-gray-500">
            If no one is selected, all Txt managers will be notified (default).
          </span>
        )}
      </div>
    </div>
  )
}
