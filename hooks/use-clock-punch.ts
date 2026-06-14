'use client'

// Shared clock-punch logic (Phase 5, TS6). The clock-in/out flow (status, the live
// elapsed tick, the GPS request + hard-timeout race + denied/unavailable warning, and
// the failed-payroll-entry warning) was copy-pasted across three surfaces and drifted:
// the two Hub surfaces requested GPS even on desktop (pointless — no GPS chip) and
// lacked the typed denied/unavailable distinction. This hook is the single source of
// truth, capturing the best-of-all behavior:
//   • GPS is requested ONLY on clock-in, and ONLY on mobile.
//   • A hard deadline races the OS prompt (which can hang in iOS PWA / Capacitor).
//   • A failed payroll entry surfaces the server's warning.
//
// (The legacy /timesheet page predates this hook and already implements the same
// behavior inline; it can be migrated onto this hook in a later pass.)

import { useState, useEffect, useCallback } from 'react'

export type ClockEmployee = {
  id: string
  first_name: string
  last_name: string
  preferred_name: string | null
  job_title: string
}

type ClockInitial = {
  employee: ClockEmployee
  clocked_in: boolean
  since: string | null
}

type UseClockPunchOptions = {
  /** Seed status from server-rendered data (skips the /me fetch). */
  initial?: ClockInitial
  /** Live-tick interval in ms (1000 for a seconds clock, 60000 for minutes). */
  tickMs?: number
  /** Called with the server's warning when a clock-out fails to save a payroll entry. */
  onWarning?: (message: string) => void
}

// GPS request bounds. The browser `timeout` only starts after the OS permission
// prompt resolves, so we race a hard deadline just above it to always recover.
const GPS_INNER_TIMEOUT = 20000
const GPS_HARD_DEADLINE = 24000

export function useClockPunch(opts: UseClockPunchOptions = {}) {
  const { initial, tickMs = 1000, onWarning } = opts

  const [employee, setEmployee] = useState<ClockEmployee | null>(initial?.employee ?? null)
  const [loading, setLoading] = useState(!initial)
  const [notLinked, setNotLinked] = useState(false)
  const [clockedIn, setClockedIn] = useState(initial?.clocked_in ?? false)
  const [since, setSince] = useState<string | null>(initial?.since ?? null)
  const [now, setNow] = useState(() => Date.now())
  const [clocking, setClocking] = useState(false)
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'requesting' | 'warning'>('idle')
  const [gpsErrorType, setGpsErrorType] = useState<'denied' | 'unavailable'>('unavailable')
  const [note, setNote] = useState('')
  const [lastOut, setLastOut] = useState<{ time: string; hours: number } | null>(null)

  // Live tick for the elapsed display.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), tickMs)
    return () => clearInterval(t)
  }, [tickMs])

  // Load current status from /me unless seeded with initial data.
  useEffect(() => {
    if (initial) return
    let cancelled = false
    fetch('/api/timesheet/me')
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data.employee) {
          setEmployee(data.employee)
          setClockedIn(data.clocked_in)
          setSince(data.since)
        } else {
          setNotLinked(true)
        }
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [initial])

  const elapsed = since ? now - new Date(since).getTime() : 0

  const submitPunch = useCallback(async (lat: number | null, lng: number | null) => {
    if (!employee) return
    const action = clockedIn ? 'out' : 'in'
    const outTime = action === 'out' ? new Date().toISOString() : null
    const outHours = action === 'out' ? elapsed / 3600000 : 0
    setClocking(true)
    setGpsStatus('idle')
    let data: { warning?: string } | null = null
    try {
      const res = await fetch('/api/timesheet/punch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employee.id, action, note: note || null, lat, lng }),
      })
      data = await res.json().catch(() => null)
    } finally {
      setClocking(false)
    }
    setNote('')
    if (action === 'out') {
      setClockedIn(false)
      setSince(null)
      setLastOut({ time: outTime!, hours: outHours })
      // #4 — server warns if the payroll entry failed to save; don't let it pass silently.
      if (data?.warning) (onWarning ?? defaultWarn)(data.warning)
    } else {
      setClockedIn(true)
      setSince(new Date().toISOString())
      setLastOut(null)
    }
  }, [employee, clockedIn, elapsed, note, onWarning])

  const handleClock = useCallback(async () => {
    if (!employee) return
    const action = clockedIn ? 'out' : 'in'

    // Clock-out never needs GPS.
    if (action === 'out') {
      await submitPunch(null, null)
      return
    }

    // GPS is only useful on mobile — desktop browsers have no GPS chip and rely on
    // a WiFi-triangulation API that's usually blocked. Skip the flow entirely there.
    const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    if (!isMobile) {
      await submitPunch(null, null)
      return
    }

    setGpsStatus('requesting')
    try {
      const pos = await Promise.race<GeolocationPosition>([
        new Promise<GeolocationPosition>((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, {
            timeout: GPS_INNER_TIMEOUT,
            maximumAge: 60000,
            enableHighAccuracy: false,
          }),
        ),
        new Promise<GeolocationPosition>((_, rej) =>
          setTimeout(() => rej(new Error('hard-timeout')), GPS_HARD_DEADLINE),
        ),
      ])
      await submitPunch(pos.coords.latitude, pos.coords.longitude)
    } catch (err) {
      const geoErr = err as GeolocationPositionError
      // Code 1 = PERMISSION_DENIED; anything else (incl. the hard-timeout) = unavailable.
      setGpsErrorType(geoErr?.code === 1 ? 'denied' : 'unavailable')
      setGpsStatus('warning')
    }
  }, [employee, clockedIn, submitPunch])

  return {
    employee,
    loading,
    notLinked,
    clockedIn,
    since,
    elapsed,
    clocking,
    gpsStatus,
    gpsErrorType,
    note,
    setNote,
    lastOut,
    handleClock,
    /** Clock in/out without a GPS reading (warning-panel fallback). */
    clockWithoutLocation: () => submitPunch(null, null),
    /** Retry the GPS flow after a warning. */
    retry: handleClock,
    /** Dismiss the GPS warning panel. */
    dismissWarning: () => setGpsStatus('idle'),
  }
}

function defaultWarn(message: string) {
  if (typeof window !== 'undefined') window.alert(message)
}
