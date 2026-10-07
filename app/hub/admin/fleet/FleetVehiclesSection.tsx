'use client'

import { useEffect, useMemo, useState } from 'react'

// Admin → Fleet → "Who drives which truck" (Fleet stops PRD session 1).
// Each change saves on its own — no Save button (toggles autosave).

type Device = { id: string; name: string }
type Person = { id: string; display_name: string }
type Row = { device_id: string; user_id: string | null; effective_date: string | null }

export default function FleetVehiclesSection() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [devicesError, setDevicesError] = useState<string | null>(null)
  const [today, setToday] = useState('')
  const [devices, setDevices] = useState<Device[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/admin/fleet-vehicles', { cache: 'no-store' })
        const body = await res.json().catch(() => null)
        if (!res.ok) throw new Error(body?.error ?? `Load failed (${res.status})`)
        if (cancelled) return
        setToday(body.today ?? '')
        setDevices(body.devices ?? [])
        setDevicesError(body.devices_error ?? null)
        setPeople(body.people ?? [])
        setRows(body.assignments ?? [])
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const standing = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows) if (r.effective_date === null && r.user_id) m.set(r.device_id, r.user_id)
    return m
  }, [rows])

  // Today's change per truck: a person id, or null = nobody today.
  const todayRows = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const r of rows) if (r.effective_date === today) m.set(r.device_id, r.user_id)
    return m
  }, [rows, today])

  const nameOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of people) m.set(p.id, p.display_name)
    return m
  }, [people])

  async function save(deviceId: string, scope: 'standing' | 'today', userId: string | null) {
    const key = `${deviceId}:${scope}`
    setSavingKey(key)
    setSavedKey(null)
    setError(null)
    try {
      const res = await fetch('/api/admin/fleet-vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId, scope, user_id: userId }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? `Save failed (${res.status})`)
      setRows(body.assignments ?? [])
      setSavedKey(key)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
      <header>
        <h2 className="font-semibold">Who drives which truck</h2>
        <p className="text-xs text-white/50 mt-1">
          Links each truck to the tech who drives it, so the Fleet map can label the truck with their
          name and show their Work Order stops. Set the usual driver once; use <em>Today</em> for the odd
          day someone takes a different truck — it goes back to normal tomorrow. Changes save as you pick.
        </p>
      </header>

      {loading && <p className="text-sm text-white/50">Loading trucks…</p>}
      {devicesError && (
        <p className="text-sm text-red-300">Couldn&apos;t load trucks from OneStepGPS: {devicesError}</p>
      )}
      {!loading && !devicesError && devices.length === 0 && (
        <p className="text-sm text-white/50">No trucks reporting from OneStepGPS.</p>
      )}

      {devices.length > 0 && (
        <div className="space-y-2">
          <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr] gap-2 text-[11px] uppercase tracking-wider text-white/40 px-1">
            <span>Truck</span>
            <span>Usually driven by</span>
            <span>Today</span>
          </div>
          {devices.map((d) => {
            const usualId = standing.get(d.id) ?? ''
            const hasToday = todayRows.has(d.id)
            const todayVal = hasToday ? (todayRows.get(d.id) ?? 'nobody') : 'usual'
            const usualName = usualId ? nameOf.get(usualId) ?? 'someone' : 'nobody'
            return (
              <div
                key={d.id}
                className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr] gap-2 items-center rounded-md bg-gray-900/60 border border-white/10 px-2 py-2"
              >
                <div className="text-sm font-medium truncate">{d.name}</div>
                <label className="flex items-center gap-2">
                  <span className="sm:hidden text-xs text-white/50 w-16 shrink-0">Usually</span>
                  <select
                    value={usualId}
                    disabled={savingKey !== null}
                    onChange={(e) => save(d.id, 'standing', e.target.value || null)}
                    className="flex-1 min-w-0 bg-gray-900 border border-white/15 rounded px-2 py-1 text-base sm:text-sm"
                  >
                    <option value="">Nobody</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name}
                      </option>
                    ))}
                  </select>
                  <SaveMark state={savingKey === `${d.id}:standing` ? 'saving' : savedKey === `${d.id}:standing` ? 'saved' : null} />
                </label>
                <label className="flex items-center gap-2">
                  <span className="sm:hidden text-xs text-white/50 w-16 shrink-0">Today</span>
                  <select
                    value={todayVal}
                    disabled={savingKey !== null}
                    onChange={(e) => {
                      const v = e.target.value
                      save(d.id, 'today', v === 'usual' ? 'usual' : v === 'nobody' ? null : v)
                    }}
                    className={`flex-1 min-w-0 bg-gray-900 border rounded px-2 py-1 text-base sm:text-sm ${
                      hasToday ? 'border-amber-400/60 text-amber-200' : 'border-white/15'
                    }`}
                  >
                    <option value="usual">Usual ({usualName})</option>
                    <option value="nobody">Nobody today</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name} — today only
                      </option>
                    ))}
                  </select>
                  <SaveMark state={savingKey === `${d.id}:today` ? 'saving' : savedKey === `${d.id}:today` ? 'saved' : null} />
                </label>
              </div>
            )
          })}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-700 bg-red-900/30 text-red-200 px-3 py-2 text-sm">{error}</div>
      )}
    </section>
  )
}

function SaveMark({ state }: { state: 'saving' | 'saved' | null }) {
  return (
    <span className="w-4 text-xs shrink-0" aria-live="polite">
      {state === 'saving' ? <span className="text-white/40">…</span> : state === 'saved' ? <span className="text-emerald-300">✓</span> : null}
    </span>
  )
}
