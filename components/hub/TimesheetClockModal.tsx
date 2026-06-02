'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

type Employee = {
  id: string
  first_name: string
  last_name: string
  preferred_name: string | null
  job_title: string
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function formatDuration(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function TimesheetClockModal({ onClose }: { onClose: () => void }) {
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)
  const [notLinked, setNotLinked] = useState(false)
  const [clockedIn, setClockedIn] = useState(false)
  const [since, setSince] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [clocking, setClocking] = useState(false)
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'requesting' | 'warning'>('idle')
  const [note, setNote] = useState('')
  const [showNote, setShowNote] = useState(false)
  const [lastOut, setLastOut] = useState<{ time: string; hours: number } | null>(null)

  // Tick every second while clocked in
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Load employee + current status
  useEffect(() => {
    fetch('/api/timesheet/me')
      .then(r => r.json())
      .then(data => {
        if (data.employee) {
          setEmployee(data.employee)
          setClockedIn(data.clocked_in)
          setSince(data.since)
        } else {
          setNotLinked(true)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const elapsed = since ? now - new Date(since).getTime() : 0

  async function submitPunch(lat: number | null, lng: number | null) {
    if (!employee) return
    const action = clockedIn ? 'out' : 'in'
    const outTime = action === 'out' ? new Date().toISOString() : null
    const outHours = action === 'out' ? elapsed / 3600000 : 0
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
    if (action === 'out') {
      setClockedIn(false)
      setSince(null)
      setLastOut({ time: outTime!, hours: outHours })
    } else {
      setClockedIn(true)
      setSince(new Date().toISOString())
      setLastOut(null)
    }
  }

  async function handleClock() {
    if (!employee) return
    if (clockedIn) { await submitPunch(null, null); return }
    setGpsStatus('requesting')
    try {
      // The browser's `timeout` option only starts measuring *after* the OS
      // permission prompt resolves — if the prompt hangs (iOS PWA / Capacitor
      // quirks) the promise sits forever and the user is stuck on "Getting
      // location…" with no way to clock in. Race against a hard 12s deadline so
      // the UI always recovers into the warning panel (which offers
      // "Clock In Without Location").
      const pos = await Promise.race<GeolocationPosition>([
        new Promise<GeolocationPosition>((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000, maximumAge: 60000 })
        ),
        new Promise<GeolocationPosition>((_, rej) =>
          setTimeout(() => rej(new Error('hard-timeout')), 12000)
        ),
      ])
      await submitPunch(pos.coords.latitude, pos.coords.longitude)
    } catch {
      setGpsStatus('warning')
    }
  }

  const displayName = employee
    ? (employee.preferred_name || employee.first_name)
    : ''

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60">
      <div className="bg-gray-950 border border-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 flex-none">
          <div>
            <div className="font-semibold text-white">Time Clock</div>
            {employee && <div className="text-xs text-gray-500 mt-0.5">{displayName} · {employee.job_title}</div>}
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors text-lg leading-none p-1"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-6 flex flex-col items-center gap-5">
          {loading ? (
            <p className="text-gray-500 text-sm py-4">Loading…</p>
          ) : notLinked ? (
            <div className="text-center space-y-3 py-4">
              <div className="text-4xl">🕐</div>
              <p className="text-white font-medium">Account not linked</p>
              <p className="text-gray-400 text-sm">Ask your admin to link your account to an employee record.</p>
            </div>
          ) : (
            <>
              {/* Status card */}
              <div className={`w-full rounded-2xl border-2 p-6 text-center transition-colors ${
                clockedIn ? 'bg-green-500/5 border-green-500/30' : lastOut ? 'bg-gray-900 border-gray-700' : 'bg-gray-900 border-gray-800'
              }`}>
                {clockedIn && since ? (
                  <>
                    <div className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Shift in progress</div>
                    <div className="text-4xl font-bold tabular-nums tracking-tight text-green-400 my-2">
                      {formatDuration(elapsed)}
                    </div>
                    <div className="text-sm text-gray-500">Since {formatTime(since)}</div>
                  </>
                ) : lastOut ? (
                  <>
                    <div className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Shift complete</div>
                    <div className="text-3xl font-bold tabular-nums text-white my-2">
                      {lastOut.hours.toFixed(2)}h
                    </div>
                    <div className="text-sm text-gray-400">Clocked out at {formatTime(lastOut.time)}</div>
                  </>
                ) : (
                  <>
                    <div className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Not clocked in</div>
                    <div className="text-3xl my-3 text-gray-700">—</div>
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
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                />
              )}

              {/* GPS warning */}
              {gpsStatus === 'warning' ? (
                <div className="w-full rounded-2xl border-2 border-red-500/60 bg-red-500/10 p-5 space-y-3 text-center">
                  <div className="text-2xl">📵</div>
                  <div className="font-bold text-red-400">Location Access Denied</div>
                  <p className="text-sm text-red-300/80">Your clock-in will have no GPS record. Your manager will see this.</p>
                  <button onClick={handleClock} className="w-full py-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium transition-colors">
                    🔄 Try Again
                  </button>
                  <button onClick={() => submitPunch(null, null)} disabled={clocking} className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors">
                    {clocking ? '…' : 'Clock In Without Location'}
                  </button>
                  <button onClick={() => setGpsStatus('idle')} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <button
                    onClick={handleClock}
                    disabled={clocking || gpsStatus === 'requesting'}
                    className={`w-full py-4 rounded-2xl text-base font-bold transition-all disabled:opacity-70 ${
                      clockedIn
                        ? 'bg-red-500 hover:bg-red-400 active:bg-red-600 text-white shadow-lg shadow-red-500/25'
                        : 'bg-green-500 hover:bg-green-400 active:bg-green-600 text-white shadow-lg shadow-green-500/25'
                    }`}
                  >
                    {clocking ? '…' : gpsStatus === 'requesting' ? '📍 Getting location…' : clockedIn ? 'Clock Out' : 'Clock In'}
                  </button>
                  <button
                    onClick={() => setShowNote(v => !v)}
                    className="text-xs text-gray-600 hover:text-gray-400 transition-colors -mt-2"
                  >
                    {showNote ? 'Hide note' : '+ Add note'}
                  </button>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-1 flex-none border-t border-gray-800/50">
          <Link
            href="/timesheet"
            onClick={onClose}
            className="block text-center text-xs text-gray-600 hover:text-gray-400 transition-colors py-1"
          >
            View full timesheet →
          </Link>
        </div>
      </div>
    </div>
  )
}
