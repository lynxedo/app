'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Employee = {
  id: string
  first_name: string
  last_name: string
  preferred_name: string | null
  job_title: string
}

export type HomeTimeClockInitial = {
  employee: Employee
  clocked_in: boolean
  since: string | null
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function formatDuration(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function HomeTimeClockCard({ initial }: { initial: HomeTimeClockInitial }) {
  const [employee] = useState<Employee>(initial.employee)
  const [clockedIn, setClockedIn] = useState(initial.clocked_in)
  const [since, setSince] = useState<string | null>(initial.since)
  const [now, setNow] = useState(Date.now())
  const [clocking, setClocking] = useState(false)
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'requesting' | 'warning'>('idle')
  const [lastOut, setLastOut] = useState<{ time: string; hours: number } | null>(null)

  // Tick once a minute — Home card shows hours-and-minutes, not seconds
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  const elapsed = since ? now - new Date(since).getTime() : 0

  async function submitPunch(lat: number | null, lng: number | null) {
    const action = clockedIn ? 'out' : 'in'
    const outTime = action === 'out' ? new Date().toISOString() : null
    const outHours = action === 'out' ? elapsed / 3600000 : 0
    setClocking(true)
    setGpsStatus('idle')
    await fetch('/api/timesheet/punch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: employee.id, action, lat, lng }),
    })
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
    if (clockedIn) { await submitPunch(null, null); return }
    setGpsStatus('requesting')
    try {
      // Browser's `timeout` option only starts measuring *after* the OS permission
      // prompt resolves — if the prompt hangs (iOS PWA / Capacitor quirks) the
      // promise sits forever. Race against a hard 12s deadline so the UI can
      // always recover into the warning panel.
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

  // GPS denied — replace the card with a focused warning + recovery actions
  if (gpsStatus === 'warning') {
    return (
      <section className="mb-8">
        <div className="rounded-2xl border-2 border-red-500/60 bg-red-500/10 p-5 space-y-3 text-center">
          <div className="text-2xl">📵</div>
          <div className="font-bold text-red-400">Location Access Denied</div>
          <p className="text-sm text-red-300/80">Your clock-in will have no GPS record. Your manager will see this.</p>
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button
              onClick={handleClock}
              className="flex-1 py-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium transition-colors"
            >
              🔄 Try Again
            </button>
            <button
              onClick={() => submitPunch(null, null)}
              disabled={clocking}
              className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {clocking ? '…' : 'Clock In Without Location'}
            </button>
          </div>
          <button
            onClick={() => setGpsStatus('idle')}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors pt-1"
          >
            Cancel
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="mb-8">
      <div className={`rounded-2xl border p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 transition-colors ${
        clockedIn
          ? 'bg-green-500/5 border-green-500/30'
          : lastOut
            ? 'bg-gray-900 border-gray-700'
            : 'bg-gray-900 border-gray-800'
      }`}>
        <div className="min-w-0">
          {clockedIn && since ? (
            <>
              <div className="text-xs font-semibold uppercase tracking-widest text-green-400/70">Clocked in</div>
              <div className="mt-1 text-white">
                <span className="text-2xl font-bold tabular-nums">{formatTime(since)}</span>
                <span className="text-gray-500 mx-2">·</span>
                <span className="text-lg tabular-nums text-gray-200">{formatDuration(elapsed)}</span>
              </div>
            </>
          ) : lastOut ? (
            <>
              <div className="text-xs font-semibold uppercase tracking-widest text-gray-500">Shift complete</div>
              <div className="mt-1 text-white">
                <span className="text-2xl font-bold tabular-nums">{lastOut.hours.toFixed(2)}h</span>
                <span className="text-gray-500 mx-2">·</span>
                <span className="text-sm text-gray-400">Out at {formatTime(lastOut.time)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="text-xs font-semibold uppercase tracking-widest text-gray-500">Time clock</div>
              <div className="mt-1 text-lg text-gray-400">Not clocked in</div>
            </>
          )}
          <Link
            href="/timesheet"
            className="inline-block mt-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            View full timesheet →
          </Link>
        </div>
        <button
          onClick={handleClock}
          disabled={clocking || gpsStatus === 'requesting'}
          className={`w-full sm:w-auto px-8 py-4 rounded-2xl text-base font-bold transition-all disabled:opacity-70 ${
            clockedIn
              ? 'bg-red-500 hover:bg-red-400 active:bg-red-600 text-white shadow-lg shadow-red-500/25'
              : 'bg-green-500 hover:bg-green-400 active:bg-green-600 text-white shadow-lg shadow-green-500/25'
          }`}
        >
          {clocking ? '…' : gpsStatus === 'requesting' ? '📍 Getting location…' : clockedIn ? 'Clock Out' : 'Clock In'}
        </button>
      </div>
    </section>
  )
}
