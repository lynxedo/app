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

type EditRequest = {
  id: string
  time_entry_id: string
  status: 'pending' | 'approved' | 'rejected'
  new_clock_in: string | null
  new_clock_out: string | null
  reason: string
  admin_note: string | null
  created_at: string
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

// Convert ISO timestamp → local datetime-local input value (YYYY-MM-DDTHH:MM)
function toLocalInput(ts: string): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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
  const [gpsErrorType, setGpsErrorType] = useState<'denied' | 'unavailable'>('unavailable')
  const [note, setNote] = useState('')
  const [showNote, setShowNote] = useState(false)
  const [weekTotal, setWeekTotal] = useState(0)
  const [weekOT, setWeekOT] = useState(0)
  const [lastOut, setLastOut] = useState<{ time: string; hours: number } | null>(null)

  // Edit request state
  const [editRequests, setEditRequests] = useState<EditRequest[]>([])
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ clock_in: '', clock_out: '', reason: '' })
  const [submittingEdit, setSubmittingEdit] = useState(false)
  const [editError, setEditError] = useState('')

  const currentWeekStart = getCurrentWeekStart()
  const isCurrentWeek = weekStart.toISOString().split('T')[0] === currentWeekStart.toISOString().split('T')[0]

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
      fetch('/api/timesheet/punch-edits'),
    ]
    if (isCurrentWeek) fetches.unshift(fetch(`/api/timesheet/punch?employee_id=${employee.id}`))

    const results = await Promise.all(fetches)
    const statusIdx = isCurrentWeek ? 0 : -1
    const entriesIdx = isCurrentWeek ? 1 : 0
    const editIdx = isCurrentWeek ? 2 : 1

    const entriesData = await results[entriesIdx].json()
    const editData = await results[editIdx].json()

    if (isCurrentWeek && statusIdx >= 0) {
      const statusData = await results[statusIdx].json()
      setClockedIn(statusData.clocked_in)
      setSince(statusData.since)
    } else {
      setClockedIn(false)
      setSince(null)
    }

    const weekEntries: TimeEntry[] = entriesData.entries ?? []
    setEntries(weekEntries)
    setEditRequests(editData.requests ?? [])

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

    if (action === 'out') {
      await submitPunch(null, null)
      return
    }

    setGpsStatus('requesting')
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, {
          timeout: 20000,
          maximumAge: 60000,
          enableHighAccuracy: false,
        })
      )
      await submitPunch(pos.coords.latitude, pos.coords.longitude)
    } catch (err) {
      const geoErr = err as GeolocationPositionError
      // Code 1 = PERMISSION_DENIED; anything else = timeout or unavailable
      setGpsErrorType(geoErr?.code === 1 ? 'denied' : 'unavailable')
      setGpsStatus('warning')
    }
  }

  function openEdit(entry: TimeEntry) {
    setEditingEntryId(entry.id)
    setEditForm({
      clock_in: toLocalInput(entry.clock_in),
      clock_out: entry.clock_out ? toLocalInput(entry.clock_out) : '',
      reason: '',
    })
    setEditError('')
  }

  async function submitEdit(entryId: string) {
    if (!editForm.reason.trim()) {
      setEditError('A reason is required.')
      return
    }
    setSubmittingEdit(true)
    setEditError('')
    const res = await fetch('/api/timesheet/punch-edits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        time_entry_id: entryId,
        new_clock_in: editForm.clock_in ? new Date(editForm.clock_in).toISOString() : null,
        new_clock_out: editForm.clock_out ? new Date(editForm.clock_out).toISOString() : null,
        reason: editForm.reason.trim(),
      }),
    })
    const data = await res.json()
    setSubmittingEdit(false)
    if (!res.ok) {
      setEditError(data.error ?? 'Failed to submit edit request.')
      return
    }
    setEditingEntryId(null)
    loadData()
  }

  const elapsed = since ? now - new Date(since).getTime() : 0
  const pendingForEntry = (entryId: string) => editRequests.find(r => r.time_entry_id === entryId && r.status === 'pending')

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <header className="border-b border-gray-800 px-4 py-4 flex items-center justify-between">
        <Link href="/hub" className="text-gray-500 hover:text-white transition-colors text-sm">← Hub</Link>
        <span className="font-semibold">Timesheet</span>
        {isAdmin && (
          <Link href="/hub/admin/timesheet" className="text-sm text-gray-400 hover:text-white transition-colors">
            Admin →
          </Link>
        )}
        {!isAdmin && <div className="w-16" />}
      </header>

      <main className="flex-1 flex flex-col items-center px-4 py-8 max-w-sm mx-auto w-full">

        {!employee ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
            <div className="text-5xl">🕐</div>
            <h2 className="text-xl font-bold">Account Not Linked</h2>
            <p className="text-gray-400 text-sm leading-relaxed">
              Your Lynxedo account isn&apos;t linked to an employee record yet.
              Ask your admin to link your account.
            </p>
            <p className="text-xs text-gray-600">{userEmail}</p>
            {isAdmin && (
              <Link href="/hub/admin/timesheet" className="mt-4 bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-medium transition-colors">
                Go to Admin View
              </Link>
            )}
          </div>
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading…</div>
        ) : (
          <>
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

                {showNote && gpsStatus !== 'warning' && (
                  <textarea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder={clockedIn ? 'End of shift note…' : 'Start of shift note…'}
                    rows={2}
                    className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 mb-4 resize-none"
                  />
                )}

                {gpsStatus === 'warning' ? (
                  <div className="w-full rounded-2xl border-2 border-red-500/60 bg-red-500/10 p-5 space-y-4">
                    <div className="text-center space-y-1">
                      <div className="text-2xl">📵</div>
                      <div className="font-bold text-red-400 text-base">
                        {gpsErrorType === 'denied' ? 'Location Access Denied' : 'Location Unavailable'}
                      </div>
                      <div className="text-sm text-red-300/80 leading-snug">
                        {gpsErrorType === 'denied'
                          ? <>Your browser has blocked location access for this site.<br />Check site permissions in your browser settings.</>
                          : <>Could not get your location — GPS may be taking too long.<br />You can try again or clock in without location.</>
                        }
                      </div>
                      <div className="text-xs text-red-300/60 mt-1">
                        Your manager will see that no GPS was recorded.
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
              <div className="w-full mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-600 mb-3">
                  {isCurrentWeek ? 'This Week' : 'Daily Breakdown'}
                </h3>
                <div className="space-y-2">
                  {entries.map(entry => {
                    const pending = pendingForEntry(entry.id)
                    const isEditing = editingEntryId === entry.id
                    const canEdit = !!entry.clock_out && !pending && !clockedIn

                    return (
                      <div key={entry.id} className={`bg-gray-900 border rounded-xl overflow-hidden transition-colors ${
                        pending ? 'border-amber-500/30' : 'border-gray-800'
                      }`}>
                        {/* Entry row */}
                        <div className="px-4 py-3 flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium">{formatDate(entry.date)}</div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              {formatTime(entry.clock_in)} – {entry.clock_out
                                ? formatTime(entry.clock_out)
                                : <span className="text-green-400">ongoing</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-right">
                              <div className="text-sm font-bold tabular-nums">
                                {entry.total_hours?.toFixed(2) ?? '—'}h
                              </div>
                              {(entry.overtime_hours ?? 0) > 0 && (
                                <div className="text-xs text-amber-400">{entry.overtime_hours?.toFixed(2)}h OT</div>
                              )}
                            </div>
                            {pending ? (
                              <span className="text-xs bg-amber-500/15 text-amber-400 border border-amber-500/25 px-2 py-1 rounded-lg whitespace-nowrap">
                                ⏳ Pending
                              </span>
                            ) : canEdit ? (
                              <button
                                onClick={() => isEditing ? setEditingEntryId(null) : openEdit(entry)}
                                className="text-xs text-gray-500 hover:text-white border border-gray-700 hover:border-gray-500 px-2 py-1 rounded-lg transition-colors"
                              >
                                {isEditing ? '✕' : '✎ Edit'}
                              </button>
                            ) : null}
                          </div>
                        </div>

                        {/* Pending request info */}
                        {pending && (
                          <div className="px-4 pb-3 border-t border-amber-500/15 pt-2">
                            <p className="text-xs text-amber-400/80">
                              Requested: {pending.new_clock_in ? formatTime(pending.new_clock_in) : formatTime(entry.clock_in)}
                              {' – '}
                              {pending.new_clock_out ? formatTime(pending.new_clock_out) : (entry.clock_out ? formatTime(entry.clock_out) : '—')}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">&ldquo;{pending.reason}&rdquo;</p>
                          </div>
                        )}

                        {/* Inline edit form */}
                        {isEditing && (
                          <div className="px-4 pb-4 border-t border-gray-700 pt-3 space-y-3">
                            <p className="text-xs text-gray-400">Request a time correction — your manager will review it.</p>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-xs text-gray-500 block mb-1">Clock In</label>
                                <input
                                  type="datetime-local"
                                  value={editForm.clock_in}
                                  onChange={e => setEditForm(f => ({ ...f, clock_in: e.target.value }))}
                                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-gray-500 block mb-1">Clock Out</label>
                                <input
                                  type="datetime-local"
                                  value={editForm.clock_out}
                                  onChange={e => setEditForm(f => ({ ...f, clock_out: e.target.value }))}
                                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 block mb-1">Reason <span className="text-red-400">*</span></label>
                              <textarea
                                value={editForm.reason}
                                onChange={e => setEditForm(f => ({ ...f, reason: e.target.value }))}
                                placeholder="e.g. Forgot to clock out yesterday"
                                rows={2}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                              />
                            </div>
                            {editError && <p className="text-xs text-red-400">{editError}</p>}
                            <div className="flex gap-2">
                              <button
                                onClick={() => submitEdit(entry.id)}
                                disabled={submittingEdit || !editForm.reason.trim()}
                                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
                              >
                                {submittingEdit ? 'Submitting…' : 'Submit Request'}
                              </button>
                              <button
                                onClick={() => setEditingEntryId(null)}
                                className="px-4 py-2 rounded-lg border border-gray-700 text-sm text-gray-400 hover:text-white transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
