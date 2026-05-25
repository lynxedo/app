'use client'

import { useState } from 'react'
import AdminTabNav from '@/components/AdminTabNav'

type HubUser = { id: string; display_name: string }
type Room = { id: string; name: string }

export default function DailyLogAdminPanel({
  initialRecipientIds,
  initialRoomIds,
  users,
  rooms,
}: {
  initialRecipientIds: string[]
  initialRoomIds: string[]
  users: HubUser[]
  rooms: Room[]
}) {
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set(initialRecipientIds))
  const [selectedRooms, setSelectedRooms] = useState<Set<string>>(new Set(initialRoomIds))
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  function toggleUser(id: string) {
    setSelectedUsers((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleRoom(id: string) {
    setSelectedRooms((prev) => {
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
        body: JSON.stringify({
          completion_notify_user_ids: [...selectedUsers],
          completion_notify_room_ids: [...selectedRooms],
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
            When a tech marks a route complete, @Guardian sends a summary of that day&apos;s
            log — office notes, route sheet, and every update posted. Pick any combination of
            DMs and room posts.
          </p>
        </header>

        <PickerSection
          title="DM these users"
          subtitle="@Guardian DMs each selected user a one-on-one summary."
          empty="No users in this company yet."
          items={users.map((u) => ({ id: u.id, label: u.display_name }))}
          selected={selectedUsers}
          onToggle={toggleUser}
        />

        <PickerSection
          title="Post in these rooms"
          subtitle="@Guardian posts the summary in each selected room (auto-joins if needed)."
          empty="No active rooms to choose from."
          items={rooms.map((r) => ({ id: r.id, label: `#${r.name}` }))}
          selected={selectedRooms}
          onToggle={toggleRoom}
        />

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

function PickerSection({
  title,
  subtitle,
  empty,
  items,
  selected,
  onToggle,
}: {
  title: string
  subtitle: string
  empty: string
  items: { id: string; label: string }[]
  selected: Set<string>
  onToggle: (id: string) => void
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-xs text-white/50 mt-0.5">{subtitle}</p>
        </div>
        <span className="text-xs text-white/40">{selected.size} selected</span>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-white/50">{empty}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {items.map((it) => {
            const on = selected.has(it.id)
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
    </section>
  )
}
