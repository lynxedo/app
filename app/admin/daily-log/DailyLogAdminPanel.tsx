'use client'

import { useState } from 'react'
import AdminTabNav from '@/components/AdminTabNav'

type HubUser = { id: string; display_name: string }

export default function DailyLogAdminPanel({
  initialRecipientIds,
  users,
}: {
  initialRecipientIds: string[]
  users: HubUser[]
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialRecipientIds))
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/daily-log-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completion_notify_user_ids: [...selected] }),
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

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-950 text-white">
      <div className="border-b border-gray-800">
        <div className="px-4 md:px-6">
          <AdminTabNav />
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-6">
        <header>
          <h1 className="text-xl font-semibold">Daily Log</h1>
          <p className="text-sm text-white/60 mt-1">
            When a tech marks a route complete, @Guardian DMs the selected users a summary of
            that day&apos;s log — office notes, route sheet, and every update posted.
          </p>
        </header>

        <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Completion notification recipients</h2>
            <span className="text-xs text-white/40">{selected.size} selected</span>
          </div>

          {users.length === 0 ? (
            <p className="text-sm text-white/50">No users in this company yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {users.map((u) => {
                const on = selected.has(u.id)
                return (
                  <label
                    key={u.id}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                      on
                        ? 'bg-[#2E7EB8]/20 border-[#2E7EB8]/40'
                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(u.id)}
                      className="accent-[#2E7EB8]"
                    />
                    <span className="text-sm">{u.display_name}</span>
                  </label>
                )
              })}
            </div>
          )}
        </section>

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-[#2E7EB8] hover:bg-[#2470a8] text-white text-sm font-medium transition-colors disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {savedAt && !saving && (
            <span className="text-xs text-emerald-400">Saved</span>
          )}
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </div>
    </div>
  )
}
