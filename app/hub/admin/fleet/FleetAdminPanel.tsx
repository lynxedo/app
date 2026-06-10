'use client'

import { useState } from 'react'

type Settings = {
  alert_speeding: boolean
  alert_after_hours: boolean
  alert_low_fuel: boolean
  alert_offline: boolean
  speed_threshold_mph: number
  fuel_threshold_pct: number
  offline_timeout_min: number
  work_hours_start: string
  work_hours_end: string
  work_tz: string
  alert_recipient_user_ids: string[]
  alert_recipient_room_ids: string[]
}

type HubUser = { id: string; display_name: string }
type Room = { id: string; name: string }

export default function FleetAdminPanel({
  initial,
  hubUsers,
  rooms,
}: {
  initial: Settings
  hubUsers: HubUser[]
  rooms: Room[]
}) {
  const [s, setS] = useState<Settings>(initial)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/fleet-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...s,
          work_hours_start: `${s.work_hours_start}:00`,
          work_hours_end: `${s.work_hours_end}:00`,
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

  function toggle<K extends keyof Settings>(key: K) {
    setS((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function setNum<K extends keyof Settings>(key: K, raw: string) {
    const v = parseInt(raw, 10)
    setS((prev) => ({ ...prev, [key]: (Number.isFinite(v) ? v : prev[key]) as Settings[K] }))
  }

  function toggleId(field: 'alert_recipient_user_ids' | 'alert_recipient_room_ids', id: string) {
    setS((prev) => {
      const set = new Set(prev[field])
      if (set.has(id)) set.delete(id)
      else set.add(id)
      return { ...prev, [field]: [...set] }
    })
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-950 text-white">
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-6">
        <header>
          <h1 className="text-xl font-semibold">Fleet Tracker</h1>
          <p className="text-sm text-white/60 mt-1">
            Configure which alerts fire and the thresholds they use. Alerts are evaluated
            every 5 minutes by a server-side cron and DMed to recipients.
          </p>
        </header>

        <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
          <h2 className="font-semibold">Alerts</h2>
          <ToggleRow label="Speeding alerts" on={s.alert_speeding} onToggle={() => toggle('alert_speeding')} />
          <ToggleRow label="After-hours movement alerts" on={s.alert_after_hours} onToggle={() => toggle('alert_after_hours')} />
          <ToggleRow label="Low fuel alerts" on={s.alert_low_fuel} onToggle={() => toggle('alert_low_fuel')} />
          <ToggleRow label="Vehicle offline alerts" on={s.alert_offline} onToggle={() => toggle('alert_offline')} />
        </section>

        <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
          <h2 className="font-semibold">Thresholds</h2>

          <NumberField
            label="Speed limit"
            value={s.speed_threshold_mph}
            suffix="mph"
            min={1}
            max={120}
            onChange={(v) => setNum('speed_threshold_mph', v)}
          />
          <NumberField
            label="Low fuel warning"
            value={s.fuel_threshold_pct}
            suffix="%"
            min={1}
            max={99}
            onChange={(v) => setNum('fuel_threshold_pct', v)}
          />
          <NumberField
            label="Offline after"
            value={s.offline_timeout_min}
            suffix="minutes"
            min={5}
            max={240}
            onChange={(v) => setNum('offline_timeout_min', v)}
          />

          <div>
            <label className="block text-sm font-medium mb-1">Work hours</label>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={s.work_hours_start}
                onChange={(e) => setS((p) => ({ ...p, work_hours_start: e.target.value }))}
                className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm"
              />
              <span className="text-white/60">to</span>
              <input
                type="time"
                value={s.work_hours_end}
                onChange={(e) => setS((p) => ({ ...p, work_hours_end: e.target.value }))}
                className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm"
              />
              <span className="text-xs text-white/40 ml-1">{s.work_tz}</span>
            </div>
            <p className="text-xs text-white/40 mt-1">
              Offline alerts only fire during work hours to avoid parked-overnight noise.
            </p>
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-4">
          <header>
            <h2 className="font-semibold">Notify</h2>
            <p className="text-xs text-white/50 mt-1">
              Pick where each alert should go. @Guardian DMs the selected users and posts in
              the selected rooms. You can pick any combination.
            </p>
          </header>

          <RecipientGrid
            title="DM these users"
            empty="No users in this company yet."
            items={hubUsers.map((u) => ({ id: u.id, label: u.display_name }))}
            selected={s.alert_recipient_user_ids}
            onToggle={(id) => toggleId('alert_recipient_user_ids', id)}
          />

          <RecipientGrid
            title="Post in these rooms"
            empty="No active rooms to choose from."
            items={rooms.map((r) => ({ id: r.id, label: `#${r.name}` }))}
            selected={s.alert_recipient_room_ids}
            onToggle={(id) => toggleId('alert_recipient_room_ids', id)}
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
    </div>
  )
}

function ToggleRow({
  label,
  on,
  onToggle,
}: {
  label: string
  on: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      <button
        onClick={onToggle}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${on ? 'bg-[#2E7EB8]' : 'bg-gray-700'}`}
        aria-pressed={on}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`}
        />
      </button>
    </div>
  )
}

function RecipientGrid({
  title,
  empty,
  items,
  selected,
  onToggle,
}: {
  title: string
  empty: string
  items: { id: string; label: string }[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  const selectedSet = new Set(selected)
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium">{title}</span>
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

function NumberField({
  label,
  value,
  suffix,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  suffix: string
  min: number
  max: number
  onChange: (raw: string) => void
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value)}
          className="bg-gray-900 border border-white/15 rounded px-2 py-1 text-sm w-24"
        />
        <span className="text-sm text-white/60">{suffix}</span>
      </div>
    </div>
  )
}
