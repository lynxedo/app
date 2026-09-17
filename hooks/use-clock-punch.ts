'use client'

// Shared clock-punch logic (Phase 5, TS6). Owns the clock-in/out flow: status,
// the live elapsed tick, and the failed-payroll-entry warning.
//
// LOCATION, TAKE TWO (September 17, 2026). It was removed on June 26 2026 because
// the punch WAITED on a fix: hung iOS permission prompts and denied-permission
// dead-ends, for little operational value. This version cannot repeat that,
// because it never waits. A fix is warmed in the background from the moment this
// hook mounts, and the punch takes whatever is already in hand — if there is
// nothing, it submits without a lat/lng exactly as it has since June. There is no
// GPS state in this hook, nothing to retry, and no "clock in without location"
// button, because there is never a moment where the user is asked to wait.
//
// ⚠ The web app has no say in whether a fix is even possible: until the native
// release, WKWebView does not implement geolocation at all, so on the iPhone app
// this simply always returns null and punches carry no location — the same
// behaviour as today, with no regression. See lib/native-geo.ts.

import { useState, useEffect, useCallback } from 'react'
import { startWarmingLocation, getWarmLocation } from '@/lib/native-geo'
import { startDraining, onPendingChange, onDropped } from '@/lib/offline-queue'
import { sendPunch } from '@/lib/clock-punch-request'

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
  const [pendingPunches, setPendingPunches] = useState(0)

  // Start warming a location fix now, so that by the time somebody actually taps
  // the button we already have one and the punch costs nothing extra.
  useEffect(() => startWarmingLocation(), [])

  // Live tick for the elapsed display.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), tickMs)
    return () => clearInterval(t)
  }, [tickMs])

  // Ask the server what it thinks the state is. Used on mount, and again
  // whenever a held punch turns out to have been refused — after that the screen
  // and the server disagree, and the server is right.
  const refreshStatus = useCallback(async () => {
    try {
      const data = await (await fetch('/api/timesheet/me')).json()
      if (data.employee) {
        setEmployee(data.employee)
        setClockedIn(data.clocked_in)
        setSince(data.since)
      } else {
        setNotLinked(true)
      }
    } catch {
      // Offline. Leave the screen as it is rather than blanking it.
    } finally {
      setLoading(false)
    }
  }, [])

  // Load current status from /me unless seeded with initial data.
  useEffect(() => {
    if (initial) return
    void refreshStatus()
  }, [initial, refreshStatus])

  // Drain anything a dead zone left behind, and keep the count honest on screen.
  useEffect(() => {
    startDraining()
    const offCount = onPendingChange(setPendingPunches)
    const offDrop = onDropped(({ item, message, benign }) => {
      if (item.kind !== 'punch') return
      // ⚠ "Already clocked in" is not a failure. We time out at 8s, so a slow
      // connection can deliver the punch and still look like a dead zone from
      // here — the retry then arrives at a server that already has it. The
      // person got what they asked for; just resync and say nothing.
      if (benign) { void refreshStatus(); return }
      // A held punch the server genuinely refused. Never let this one pass
      // quietly — it is the difference between being paid for a shift and not.
      ;(onWarning ?? defaultWarn)(`${item.label} could not be saved. ${message}`)
      void refreshStatus()
    })
    return () => { offCount(); offDrop() }
  }, [onWarning, refreshStatus])

  const elapsed = since ? now - new Date(since).getTime() : 0

  const submitPunch = useCallback(async (lat: number | null, lng: number | null) => {
    if (!employee) return
    const action: 'in' | 'out' = clockedIn ? 'out' : 'in'
    const outTime = action === 'out' ? new Date().toISOString() : null
    const outHours = action === 'out' ? elapsed / 3600000 : 0
    // ⚠ Stamped HERE, not on the server, and sent with the punch. If this one has
    // to wait in a dead zone, the time that matters is the moment the thumb hit
    // the button — not the moment a truck came back into signal.
    const punchedAt = new Date().toISOString()
    const payload = {
      employee_id: employee.id, action, note: note || null, lat, lng, punched_at: punchedAt,
    }
    setClocking(true)
    const result = await sendPunch(payload)
    setClocking(false)

    if (result.status === 'refused') {
      // The server read it and said no. That is an answer, not a dead zone —
      // queueing it would only make it fail again later, out of sight.
      ;(onWarning ?? defaultWarn)(result.message)
      return
    }
    if (result.status === 'lost') {
      (onWarning ?? defaultWarn)(
        `No signal, and this phone could not hold the punch. Tell a manager you clocked ${action} just now.`
      )
      return
    }
    // 'sent' or 'held'. Held counts: the time is recorded and it will go.
    const data = result.status === 'sent' ? result : null

    setNote('')
    if (action === 'out') {
      setClockedIn(false)
      setSince(null)
      setLastOut({ time: outTime!, hours: outHours })
      // #4 — server warns if the payroll entry failed to save; don't let it pass silently.
      if (data?.warning) (onWarning ?? defaultWarn)(data.warning)
    } else {
      setClockedIn(true)
      setSince(punchedAt)      // the moment they tapped, not the moment it sent
      setLastOut(null)
    }
  }, [employee, clockedIn, elapsed, note, onWarning])

  // Clock in/out. Takes the warm fix if there is one and submits immediately
  // either way — this call never waits on location.
  const handleClock = useCallback(async () => {
    if (!employee) return
    const here = getWarmLocation()
    await submitPunch(here?.lat ?? null, here?.lng ?? null)
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
    /** Punches taken with no signal that have not reached the server yet. */
    pendingPunches,
  }
}

function defaultWarn(message: string) {
  if (typeof window !== 'undefined') window.alert(message)
}
