'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

type Employee = {
  id: string
  first_name: string
  last_name: string
  preferred_name: string | null
  job_title: string
  pay_type: string
}

type TimeEntry = {
  id: string
  date: string
  clock_in: string
  clock_out: string | null
  total_hours: number | null
  regular_hours: number | null
  overtime_hours: number | null
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function formatDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatDuration(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function getCurrentWeekStart(): Date {
  const d = new Date()
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  monday.setHours(0, 0, 0, 0)
  return monday
}

function getWeekBounds(weekStart: Date): { start: string; end: string } {
  const sunday = new Date(weekStart)
  sunday.setDate(weekStart.getDate() + 6)
  return {
    start: weekStart.toISOString().split('T')[0],
    end: sunday.toISOString().split('T')[0],
  }
}

function formatWeekRange(start: Date): string {
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const s = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const e = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${s} – ${e}`
}

export default function TimesheetPage({
  employee,
  isAdmin,
  userEmail,
}: {
  employee: Employee | null
  isAdmin: boolean
  userEmail: string
}) {
  const [weekStart, setWeekStart] = useState(() => getCurrentWeekStart())
  const [clockedIn, setClockedIn] = useState(false)
  const [since, setSince] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [clocking, setClocking] = useState(false)
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'requesting' | 'warning'>('idle')
  const [note, setNote] = useState('')
  const [showNote, setShowNote] = useState(false)
  const [weekTotal, setWeekTotal] = useState(0)
  const [weekOT, setWeekOT] = useState(0)
  const [lastOut, setLastOut] = useState<{ time: string; hours: number } | null>(null)

  const currentWeekStart = getCurrentWeekStart()
  const isCurrentWeek = weekStart.toISOString().split('T')[0] === currentWeekStart.toISOString().split('T')[0]

  // Tick every second while clocked in
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const loadData = useCallback(async () => {
    if (!employee) { setLoading(false); return }
    setLoading(true)
    const week = getWeekBounds(weekStart)
    const fetches: Promise<Response>[] = [
      fetch(`/api/timesheet/entries?employee_id=${employee.id}&start=${week.start}&end=${week.end}`),
    ]
    if (isCurrentWeek) fetches.unshift(fetch(`/api/timesheet/punch?employee_id=${employee.id}`))

    const results = await Promise.all(fetches)
    const entriesData = await results[isCurrentWeek ? 1 : 0].json()

    if (isCurrentWeek) {
      const statusData = await results[0].json()
      setClockedIn(statusData.clocked_in)
      setSince(statusData.since)
    } else {
      setClockedIn(false)
      setSince(null)
    }

    const weekEntries: TimeEntry[] = entriesData.entries ?? []
    setEntries(weekEntries)

    const total = weekEntries.reduce((s, e) => s + (e.total_hours ?? 0), 0)
    const ot = weekEntries.reduce((s, e) => s + (e.overtime_hours ?? 0), 0)
    setWeekTotal(Math.round(total * 100) / 100)
    setWeekOT(Math.round(ot * 100) / 100)
    setLoading(false)
  }, [employee, weekStart, isCurrentWeek])

  useEffect(() => { loadData() }, [loadData])

  async function submitPunch(lat: number | null, lng: number | null) {
    if (!employee) return
    const action = clockedIn ? 'out' : 'in'
    const clockOutTime = action === 'out' ? new Date().toISOString() : null
    const clockOutHours = action === 'out' ? elapsed / 3600000 : 0
    setClocking(true)
    setGpsStatus('idle')
    await fetch('/api/timesheet/punch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: employee.id, action, note: note || null, lat, lng }),
    })
    setNote('')
    setShowNote(false)
    setClocking(false)
    if (clockOutTime) setLastOut({ time: clockOutTime, hours: clockOutHours })
    else setLastOut(null)
    loadData()
  }

  async function handleClock() {
    if (!employee || !isCurrentWeek) return
    const action = clockedIn ? 'out' : 'in'

    // Clock-out: no GPS needed
    if (action === 'out') {
      await submitPunch(null, null)
      return
    }

    // Clock-in: request GPS first
    setGpsStatus('requesting')
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 })
      )
      await submitPunch(pos.coords.latitude, pos.coords.longitude)
    } catch {
      // GPS denied or unavailable — show warning, don't submit yet
      setGpsStatus('warning')
    }
  }

  const elapsed = since ? now - new Date(since).getTime() : 0

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-4 py-4 flex items-center justify-between">
        <Link href="/dashboard" className="text-gray-500 hover:text-white transition-colors text-sm">← Home</Link>
        <span className="font-semibold">Timesheet</span>
        {isAdmin && (
          <Link href="/admin/timesheet" className="text-sm text-gray-400 hover:text-white transition-colors">
            Admin →
          </Link>
        )}
        {!isAdmin && <div className="w-16" />}
      </header>

      <main className="flex-1 flex flex-col items-center px-4 py-8 max-w-sm mx-auto w-full">

        {!employee ? (
          // No employee record linked
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
            <div className="text-5xl">🕐</div>
            <h2 className="text-xl font-bold">Account Not Linked</h2>
            <p className="text-gray-400 text-sm leading-relaxed">
              Your Lynxedo account isn't linked to an employee record yet.
              Ask your admin to link your account.
            </p>
            <p className="text-xs text-gray-600">{userEmail}</p>
            {isAdmin && (
              <Link href="/admin/timesheet" className="mt-4 bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-medium transition-colors">
                Go to Admin View
              </Link>
            )}
          </div>
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading…</div>
        ) : (
          <>
            {/* Employee name */}
            <div className="text-center mb-6">
              <div className="font-bold text-xl">{employee.preferred_name || employee.first_name}</div>
              <div className="text-gray-500 text-sm">{employee.job_title}</div>
            </div>

            {/* Clock timer — only on current week */}
            {isCurrentWeek && (
              <>
                <div className={`w-full rounded-3xl border-2 p-8 text-center mb-6 transition-colors ${
                  clockedIn ? 'bg-green-500/5 border-green-500/30' : lastOut ? 'bg-gray-900 border-gray-700' : 'bg-gray-900 border-gray-800'
                }`}>
                  {clockedIn && since ? (
                    <>
                      <div className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Shift in progress</div>
                      <div className="text-5xl font-bold tabular-nums tracking-tight text-green-400 my-3">
                        {formatDuration(elapsed)}
                      </div>
                      <div className="text-sm text-gray-500">Since {formatTime(since)}</div>
                    </>
                  ) : lastOut ? (
                    <>
                      <div className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Shift complete</div>
                      <div className="text-3xl font-bold tabular-nums text-white my-3">
                        {lastOut.hours.toFixed(2)}h
                      </div>
                      <div className="text-sm text-gray-400">Clocked out at {formatTime(lastOut.time)}</div>
                    </>
                  ) : (
                    <>
                      <div className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Not clocked in</div>
                      <div className="text-3xl my-4 text-gray-700">—</div>
                    </>
                  )}
                </div>

                {/* Note field */}
                {showNote && gpsStatus !== 'warning' && (
                  <textarea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder={clockedIn ? 'End of shift note…' : 'Start of shift note…'}
                    rows={2}
                    className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 mb-4 resize-none"
                  />
                )}

                {/* GPS warning state */}
                {gpsStatus === 'warning' ? (
                  <div className="w-full rounded-2xl border-2 border-red-500/60 bg-red-500/10 p-5 space-y-4">
                    <div className="text-center space-y-1">
                      <div className="text-2xl">📵</div>
                      <div className="font-bold text-red-400 text-base">Location Access Denied</div>
                      <div className="text-sm text-red-300/80 leading-snug">
                        Your clock-in will have <span className="font-semibold">no GPS record</span>.<br />
                        Your manager will be able to see this.
                      </div>
                    </div>
                    <button
                      onClick={handleClock}
                      className="w-full py-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium transition-colors"
                    >
                      🔄 Try Again
                    </button>
                    <button
                      onClick={() => submitPunch(null, null)}
                      disabled={clocking}
                      className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                    >
                      {clocking ? '…' : 'Clock In Without Location'}
                    </button>
                    <button
                      onClick={() => setGpsStatus('idle')}
                      className="w-full text-xs text-gray-600 hover:text-gray-400 transition-colors pt-1"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Clock button */}
                    <button
                      onClick={handleClock}
                      disabled={clocking || gpsStatus === 'requesting'}
                      className={`w-full py-5 rounded-2xl text-lg font-bold transition-all disabled:opacity-70 ${
                        clockedIn
                          ? 'bg-red-500 hover:bg-red-400 active:bg-red-600 text-white shadow-lg shadow-red-500/25'
                          : 'bg-green-500 hover:bg-green-400 active:bg-green-600 text-white shadow-lg shadow-green-500/25'
                      }`}
                    >
                      {clocking ? '…' : gpsStatus === 'requesting' ? '📍 Getting location…' : clockedIn ? 'Clock Out' : 'Clock In'}
                    </button>

                    <button
                      onClick={() => setShowNote(v => !v)}
                      className="mt-2 text-xs text-gray-600 hover:text-gray-400 transition-colors"
                    >
                      {showNote ? 'Hide note' : '+ Add note'}
                    </button>
                  </>
                )}
              </>
            )}

            {/* Week nav */}
            <div className="w-full flex items-center justify-between mt-8 mb-4">
              <button
                onClick={() => { setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n }) }}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors text-sm"
              >‹</button>
              <div className="text-center">
                <div className="text-sm font-medium">{formatWeekRange(weekStart)}</div>
                {isCurrentWeek && <div className="text-xs text-blue-400">Current Week</div>}
              </div>
              <button
                onClick={() => { setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n }) }}
                disabled={isCurrentWeek}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm"
              >›</button>
            </div>

            {/* Week summary tiles */}
            <div className="w-full grid grid-cols-2 gap-3">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold">{weekTotal.toFixed(1)}</div>
                <div className="text-xs text-gray-500 mt-1">Hours this week</div>
              </div>
              <div className={`border rounded-xl p-4 text-center ${weekOT > 0 ? 'bg-amber-500/5 border-amber-500/25' : 'bg-gray-900 border-gray-800'}`}>
                <div className={`text-2xl font-bold ${weekOT > 0 ? 'text-amber-400' : ''}`}>{weekOT.toFixed(1)}</div>
                <div className="text-xs text-gray-500 mt-1">Overtime</div>
              </div>
            </div>

            {/* Daily entries */}
            {entries.length > 0 && (
              <div className="w-full mt-2">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-600 mb-3">
                  {isCurrentWeek ? 'This Week' : 'Daily Breakdown'}
                </h3>
                <div className="space-y-2">
                  {entries.map(entry => (
                    <div key={entry.id} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">{formatDate(entry.date)}</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {formatTime(entry.clock_in)} – {entry.clock_out ? formatTime(entry.clock_out) : <span className="text-green-400">ongoing</span>}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold tabular-nums">
                          {entry.total_hours?.toFixed(2) ?? '—'}h
                        </div>
                        {(entry.overtime_hours ?? 0) > 0 && (
                          <div className="text-xs text-amber-400">{entry.overtime_hours?.toFixed(2)}h OT</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
