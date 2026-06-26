'use client'

// Shared clock-punch logic (Phase 5, TS6). Owns the clock-in/out flow: status,
// the live elapsed tick, and the failed-payroll-entry warning.
//
// LOCATION REMOVED (June 26, 2026): clocking in/out no longer requests GPS. The
// location ping caused too many issues in the field (hung iOS permission prompts,
// denied-permission dead-ends) for little operational value, so punches now always
// submit without a lat/lng, and the GPS request/warning flow + the gpsStatus/
// gpsErrorType/retry/clockWithoutLocation/dismissWarning surface were removed.

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

export function useClockPunch(opts: UseClockPunchOptions = {}) {
  const { initial, tickMs = 1000, onWarning } = opts

  const [employee, setEmployee] = useState<ClockEmployee | null>(initial?.employee ?? null)
  const [loading, setLoading] = useState(!initial)
  const [notLinked, setNotLinked] = useState(false)
  const [clockedIn, setClockedIn] = useState(initial?.clocked_in ?? false)
  const [since, setSince] = useState<string | null>(initial?.since ?? null)
  const [now, setNow] = useState(() => Date.now())
  const [clocking, setClocking] = useState(false)
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

  // Clock in/out. No GPS request — punches always submit without a location.
  const handleClock = useCallback(async () => {
    if (!employee) return
    await submitPunch(null, null)
  }, [employee, submitPunch])

  return {
    employee,
    loading,
    notLinked,
    clockedIn,
    since,
    elapsed,
    clocking,
    note,
    setNote,
    lastOut,
    handleClock,
  }
}

function defaultWarn(message: string) {
  if (typeof window !== 'undefined') window.alert(message)
}
