'use client'

import { useEffect, useState } from 'react'

type Snap = { id: string; captured_at: string; label: string | null }

// Full-width sub-header bar that lets a user roll a scoreboard back to a stored
// weekly snapshot ("how it looked last week"). Renders nothing until at least one
// snapshot exists, so boards look unchanged until the first Friday capture lands.
//   value = null  → live (current) data
//   value = <id>  → that stored snapshot
export default function SnapshotControls({
  slug, value, onChange,
}: {
  slug: string
  value: string | null
  onChange: (id: string | null) => void
}) {
  const [snaps, setSnaps] = useState<Snap[]>([])

  useEffect(() => {
    let alive = true
    fetch(`/api/hub/scoreboards?board=${slug}&snapshots=1`)
      .then(r => (r.ok ? r.json() : { snapshots: [] }))
      .then(d => { if (alive) setSnaps((d.snapshots ?? []) as Snap[]) })
      .catch(() => {})
    return () => { alive = false }
  }, [slug])

  if (snaps.length === 0) return null

  const fmt = (s: Snap) =>
    s.label ||
    new Date(s.captured_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' })

  const viewing = value ? snaps.find(s => s.id === value) ?? null : null

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-2 text-[12px] ${
        viewing ? 'border-amber-400/30 bg-amber-500/10' : 'border-sky-400/10 bg-[var(--t-panel)]/40'
      }`}
    >
      <span className={`font-medium ${viewing ? 'text-amber-300' : 'text-gray-400'}`}>
        {viewing ? `📸 Snapshot — ${fmt(viewing)}` : '📍 Live (current)'}
      </span>

      <label className="flex items-center gap-1.5 text-gray-500">
        <span className="hidden sm:inline">View:</span>
        <select
          value={value ?? ''}
          onChange={e => onChange(e.target.value || null)}
          className="rounded-md border border-sky-400/20 bg-[var(--t-well)] px-2 py-1 text-gray-200 focus:border-sky-400/50 focus:outline-none"
        >
          <option value="">Live (current)</option>
          {snaps.map(s => (
            <option key={s.id} value={s.id}>Week of {fmt(s)}</option>
          ))}
        </select>
      </label>

      {viewing && (
        <button
          onClick={() => onChange(null)}
          className="rounded-md border border-amber-400/30 px-2 py-1 font-medium text-amber-300 hover:bg-amber-500/15"
        >
          ← Back to live
        </button>
      )}
    </div>
  )
}
