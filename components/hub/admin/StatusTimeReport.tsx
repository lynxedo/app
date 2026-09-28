'use client'

import { useCallback, useEffect, useState } from 'react'

// Admin → Hub → Status Time. Hours each person's dot spent Green / Yellow / Red
// / Offline over a Central-time date range, from the once-a-minute status log.

type Row = { user_id: string; name: string; available: number; busy: number; dnd: number; offline: number }

const TZ = 'America/Chicago'

function centralDate(d: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

function weekStart(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
  return shiftDate(ymd, -((dow + 6) % 7)) // back to Monday
}

function fmt(seconds: number): string {
  const mins = Math.round(seconds / 60)
  if (mins <= 0) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

const COLS: { key: 'available' | 'busy' | 'dnd' | 'offline'; label: string; dot: string }[] = [
  { key: 'available', label: 'Green / Available', dot: 'bg-green-500' },
  { key: 'busy', label: 'Yellow / Busy', dot: 'bg-yellow-400' },
  { key: 'dnd', label: 'Red / DND', dot: 'bg-red-500' },
  { key: 'offline', label: 'Offline', dot: 'bg-gray-500' },
]

export default function StatusTimeReport() {
  const today = centralDate(new Date())
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [rows, setRows] = useState<Row[]>([])
  const [trackingSince, setTrackingSince] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/hub/status-log?from=${f}&to=${t}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not load status time')
      setRows(json.rows ?? [])
      setTrackingSince(json.tracking_since ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load status time')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(from, to) }, [from, to, load])

  const presets: { label: string; from: string; to: string }[] = [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: shiftDate(today, -1), to: shiftDate(today, -1) },
    { label: 'This week', from: weekStart(today), to: today },
    { label: 'Last 7 days', from: shiftDate(today, -6), to: today },
    { label: 'Last 30 days', from: shiftDate(today, -29), to: today },
  ]

  const since = trackingSince
    ? new Date(trackingSince).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-white mb-1">Status Time</h2>
        <p className="text-sm text-gray-500 mb-5">
          How long each person&apos;s dot was Green, Yellow, Red or Offline. Checked every minute, Central time.
          {since && <> Tracking started {since} — nothing before that was recorded.</>}
        </p>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          {presets.map(p => {
            const active = p.from === from && p.to === to
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => { setFrom(p.from); setTo(p.to) }}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  active ? 'border-brand/60 bg-brand/10 text-white' : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-200'
                }`}
              >
                {p.label}
              </button>
            )
          })}
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <input
              type="date"
              value={from}
              max={to}
              onChange={e => e.target.value && setFrom(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-sm"
            />
            <span>to</span>
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={e => e.target.value && setTo(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-sm"
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-800">
                <th className="py-2 pr-4 font-medium">Person</th>
                {COLS.map(c => (
                  <th key={c.key} className="py-2 px-3 font-medium whitespace-nowrap">
                    <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${c.dot}`} />
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-gray-500">Loading…</td></tr>
              )}
              {!loading && rows.length === 0 && !error && (
                <tr><td colSpan={5} className="py-6 text-center text-gray-500">No status time recorded in this range.</td></tr>
              )}
              {rows.map(r => (
                <tr key={r.user_id} className="border-b border-gray-800/60">
                  <td className="py-2 pr-4 text-white">{r.name}</td>
                  {COLS.map(c => (
                    <td key={c.key} className="py-2 px-3 text-gray-300 tabular-nums whitespace-nowrap">{fmt(r[c.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-500 mt-4">
          Green means the dot was showing Available: an hourly person who was clocked in, or anyone else active in Hub in the last 2 hours.
          Yellow and Red are the Busy and Do Not Disturb statuses people set themselves.
        </p>
      </div>
    </div>
  )
}
