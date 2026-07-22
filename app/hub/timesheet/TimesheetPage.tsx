'use client'

// Employee-facing timesheet view (restored June 26, 2026). The standalone
// pre-Hub /timesheet page was retired in the NAV-GlobalNavFate refactor, which
// left non-admin employees with no way to view their own hours — clicking
// "View full timesheet" funnelled them through /hub/timesheet, which had been
// repurposed as an admin-only redirect, so they bounced straight back to the Hub.
// This lives at /hub/timesheet again (inside the Hub shell) and is gated by
// can_access_timesheet. Admins still reach the admin panel via the Admin → link.
//
// Location capture removed (June 26, 2026): clocking in/out no longer requests
// GPS — see hooks/use-clock-punch.ts for the rationale.

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { formatDurationMs } from '@/lib/format'

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

type PtoRequest = {
  id: string
  request_date: string
  hours: number
  type: 'paid' | 'unpaid'
  note: string | null
  status: 'pending' | 'approved' | 'rejected'
  admin_note: string | null
  created_at: string
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function formatDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
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
  const [now, setNow] = useState(() => Date.now())
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [clocking, setClocking] = useState(false)
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

  // PTO state
  const [ptoRequests, setPtoRequests] = useState<PtoRequest[]>([])
  const [showPtoForm, setShowPtoForm] = useState(false)
  const [ptoForm, setPtoForm] = useState({ request_date: '', hours: '', type: 'paid' as 'paid' | 'unpaid', note: '' })
  const [ptoSubmitting, setPtoSubmitting] = useState(false)
  const [ptoError, setPtoError] = useState('')

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
      fetch('/api/timesheet/pto-requests'),
    ]
    if (isCurrentWeek) fetches.unshift(fetch(`/api/timesheet/punch?employee_id=${employee.id}`))

    const results = await Promise.all(fetches)
    const statusIdx = isCurrentWeek ? 0 : -1
    const entriesIdx = isCurrentWeek ? 1 : 0
    const editIdx = isCurrentWeek ? 2 : 1
    const ptoIdx = isCurrentWeek ? 3 : 2

    const entriesData = await results[entriesIdx].json()
    const editData = await results[editIdx].json()
    const ptoData = await results[ptoIdx].json()

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
    setPtoRequests(ptoData.requests ?? [])

    const total = weekEntries.reduce((s, e) => s + (e.total_hours ?? 0), 0)
    const ot = weekEntries.reduce((s, e) => s + (e.overtime_hours ?? 0), 0)
    setWeekTotal(Math.round(total * 100) / 100)
    setWeekOT(Math.round(ot * 100) / 100)
    setLoading(false)
  }, [employee, weekStart, isCurrentWeek])

  useEffect(() => { loadData() }, [loadData])

  // Clock in/out — no GPS request (location capture was removed).
  async function handleClock() {
    if (!employee || !isCurrentWeek) return
    const action = clockedIn ? 'out' : 'in'
    const clockOutTime = action === 'out' ? new Date().toISOString() : null
    const clockOutHours = action === 'out' ? elapsed / 3600000 : 0
    setClocking(true)
    const res = await fetch('/api/timesheet/punch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: employee.id, action, note: note || null, lat: null, lng: null }),
    })
    const data = await res.json().catch(() => null)
    setNote('')
    setShowNote(false)
    setClocking(false)
    if (clockOutTime) setLastOut({ time: clockOutTime, hours: clockOutHours })
    else setLastOut(null)
    // #4 — server warns if the payroll entry failed to save.
    if (data?.warning) alert(data.warning)
    loadData()
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

  async function submitPto() {
    if (!employee) return
    if (!ptoForm.request_date) { setPtoError('Date is required.'); return }
    if (!ptoForm.hours || Number(ptoForm.hours) <= 0) { setPtoError('Hours must be greater than 0.'); return }
    setPtoSubmitting(true)
    setPtoError('')
    const res = await fetch('/api/timesheet/pto-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_date: ptoForm.request_date,
        hours: Number(ptoForm.hours),
        type: ptoForm.type,
        note: ptoForm.note.trim() || null,
      }),
    })
    const data = await res.json()
    setPtoSubmitting(false)
    if (!res.ok) { setPtoError(data.error ?? 'Failed to submit request.'); return }
    setPtoForm({ request_date: '', hours: '', type: 'paid', note: '' })
    setShowPtoForm(false)
    loadData()
  }

  const elapsed = since ? now - new Date(since).getTime() : 0
  const pendingForEntry = (entryId: string) => editRequests.find(r => r.time_entry_id === entryId && r.status === 'pending')

  return (
    <div className="h-full overflow-y-auto bg-gray-950 text-white">
      <main className="flex flex-col items-center px-4 py-6 max-w-sm mx-auto w-full">

        {isAdmin && (
          <div className="w-full flex justify-end mb-2">
            <Link href="/hub/admin/timesheet" className="text-xs text-gray-400 hover:text-white transition-colors border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg">
              Admin view →
            </Link>
          </div>
        )}

        {!employee ? (
          <div className="flex flex-col items-center justify-center text-center gap-4 py-16">
            <div className="text-5xl">🕐</div>
            <h2 className="text-xl font-bold">Account Not Linked</h2>
            <p className="text-gray-400 text-sm leading-relaxed">
              Your Lynxedo account isn&apos;t linked to an employee record yet.
              Ask your admin to link your account.
            </p>
            <p className="text-xs text-gray-600">{userEmail}</p>
            {isAdmin && (
              <Link href="/hub/admin/timesheet" className="mt-4 bg-blue-600 hover:bg-blue-500 text-[#fff] px-6 py-3 rounded-xl font-medium transition-colors">
                Go to Admin View
              </Link>
            )}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center text-gray-500 text-sm py-16">Loading…</div>
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
                        {formatDurationMs(elapsed)}
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

                {showNote && (
                  <textarea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder={clockedIn ? 'End of shift note…' : 'Start of shift note…'}
                    rows={2}
                    className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 mb-4 resize-none"
                  />
                )}

                <button
                  onClick={handleClock}
                  disabled={clocking}
                  className={`w-full py-5 rounded-2xl text-lg font-bold transition-all disabled:opacity-70 ${
                    clockedIn
                      ? 'bg-red-500 hover:bg-red-400 active:bg-red-600 text-[#fff] shadow-lg shadow-red-500/25'
                      : 'bg-green-500 hover:bg-green-400 active:bg-green-600 text-[#fff] shadow-lg shadow-green-500/25'
                  }`}
                >
                  {clocking ? '…' : clockedIn ? 'Clock Out' : 'Clock In'}
                </button>
                <button
                  onClick={() => setShowNote(v => !v)}
                  className="mt-2 text-xs text-gray-600 hover:text-gray-400 transition-colors"
                >
                  {showNote ? 'Hide note' : '+ Add note'}
                </button>
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

            {/* PTO Requests section */}
            <div className="w-full mt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-600">PTO Requests</h3>
                {!showPtoForm && (
                  <button
                    onClick={() => { setShowPtoForm(true); setPtoError('') }}
                    className="text-xs text-gray-500 hover:text-white border border-gray-700 hover:border-gray-500 px-2 py-1 rounded-lg transition-colors"
                  >+ Request PTO</button>
                )}
              </div>

              {/* PTO submit form */}
              {showPtoForm && (
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 mb-3 space-y-3">
                  <p className="text-xs text-gray-400">Submit a PTO request — your manager will review it.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Date <span className="text-red-400">*</span></label>
                      <input
                        type="date"
                        value={ptoForm.request_date}
                        onChange={e => setPtoForm(f => ({ ...f, request_date: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Hours <span className="text-red-400">*</span></label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        max="24"
                        value={ptoForm.hours}
                        onChange={e => setPtoForm(f => ({ ...f, hours: e.target.value }))}
                        placeholder="8"
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Type</label>
                    <div className="flex gap-2">
                      {(['paid', 'unpaid'] as const).map(t => (
                        <button
                          key={t}
                          onClick={() => setPtoForm(f => ({ ...f, type: t }))}
                          className={`flex-1 py-1.5 rounded-lg text-sm transition-colors border ${ptoForm.type === t ? 'bg-blue-600 border-blue-500 text-[#fff]' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}
                        >{t.charAt(0).toUpperCase() + t.slice(1)}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Note</label>
                    <textarea
                      value={ptoForm.note}
                      onChange={e => setPtoForm(f => ({ ...f, note: e.target.value }))}
                      placeholder="Optional — reason for the request"
                      rows={2}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                    />
                  </div>
                  {ptoError && <p className="text-xs text-red-400">{ptoError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={submitPto}
                      disabled={ptoSubmitting}
                      className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-[#fff] text-sm font-medium py-2 rounded-lg transition-colors"
                    >{ptoSubmitting ? 'Submitting…' : 'Submit Request'}</button>
                    <button
                      onClick={() => { setShowPtoForm(false); setPtoError('') }}
                      className="px-4 py-2 rounded-lg border border-gray-700 text-sm text-gray-400 hover:text-white transition-colors"
                    >Cancel</button>
                  </div>
                </div>
              )}

              {/* PTO request history */}
              {ptoRequests.length === 0 && !showPtoForm ? (
                <p className="text-xs text-gray-600 text-center py-2">No PTO requests yet.</p>
              ) : (
                <div className="space-y-2">
                  {ptoRequests.map(req => (
                    <div key={req.id} className={`bg-gray-900 border rounded-xl px-4 py-3 ${req.status === 'pending' ? 'border-amber-500/30' : req.status === 'approved' ? 'border-emerald-500/25' : 'border-gray-800'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium">{formatDate(req.request_date)}</div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {req.hours}h · {req.type}
                            {req.note && <span> · &ldquo;{req.note}&rdquo;</span>}
                          </div>
                          {req.status === 'rejected' && req.admin_note && (
                            <div className="text-xs text-red-400 mt-1">Rejected: {req.admin_note}</div>
                          )}
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                          req.status === 'pending' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/25' :
                          req.status === 'approved' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25' :
                          'bg-gray-800 text-gray-500 border border-gray-700'
                        }`}>
                          {req.status === 'pending' ? '⏳ Pending' : req.status === 'approved' ? '✓ Approved' : 'Rejected'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
                                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-[#fff] text-sm font-medium py-2 rounded-lg transition-colors"
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
