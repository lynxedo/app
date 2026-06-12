'use client'

import { useState, useRef } from 'react'

export type ManagerUser = {
  id: string
  display_name: string
  // Admins / Txt-admins are always managers and can't be toggled off here.
  always: boolean
}

// Admin panel for choosing which Txt2 users are "Texting Managers". Managers
// can see the unassigned Queue + the Responder tab and send Broadcasts.
// Everyone else with Txt2 access still works the shared inbox (Mine / All /
// Archived, reassign, notes, AI, archive, group messages).
//
// Writes the per-user `can_assign_txt_threads` grant via /api/admin/txt/managers.
export default function TxtManagersPanel({
  initialManagerIds,
  users,
}: {
  initialManagerIds: string[]
  users: ManagerUser[]
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialManagerIds))
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
      const res = await fetch('/api/admin/txt/managers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manager_user_ids: [...valuesRef.current.selected] }),
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
        <h2 className="text-sm font-semibold text-white">Texting Managers</h2>
        <p className="text-xs text-gray-400 mt-1">
          Managers can see the unassigned <strong>Queue</strong> and the{' '}
          <strong>Responder</strong> tab, and send <strong>Broadcasts</strong>.
          Everyone with Txt2 access already works the shared inbox (Mine / All /
          Archived, start conversations, reassign, notes, AI, archive, and group
          messages) — managers just get those three extra powers.
        </p>
      </div>

      <div className="space-y-1">
        {users.map((u) => (
          <label
            key={u.id}
            className={`flex items-center gap-3 py-2 px-3 rounded-md ${
              u.always ? 'opacity-60' : 'cursor-pointer hover:bg-white/5'
            }`}
          >
            <input
              type="checkbox"
              checked={u.always || selected.has(u.id)}
              disabled={u.always}
              onChange={() => toggle(u.id)}
              className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0 disabled:opacity-50"
            />
            <span className="text-sm text-white">{u.display_name}</span>
            {u.always && (
              <span className="text-[10px] uppercase tracking-wide text-gray-500">
                admin · always
              </span>
            )}
          </label>
        ))}
        {users.length === 0 && (
          <p className="text-xs text-gray-500 py-2">
            No Txt2 users yet. Grant &quot;Txt2 (new texting)&quot; in Admin → People first.
          </p>
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
      </div>
    </div>
  )
}
