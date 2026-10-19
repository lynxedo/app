// Centralized time-entry recompute. Punches (time_punches) are the source of
// truth; time_entries is a derived per-day rollup. Any write path that mutates
// punches for a given (employee, date) MUST call recomputeDayEntry afterward so
// the entry never goes stale (the bug where deleting a punch left a phantom
// entry behind).
//
// OT policy: weekly (>40h), NOT daily. Every entry stores all shift hours as
// regular; overtime_hours is always 0 at the entry level. weekSummary() in the
// admin UI computes weekly OT across the week's entries. (Heroes' pay policy.)

import type { SupabaseClient } from '@supabase/supabase-js'
import { centralDayRangeUtc } from '@/lib/timezone'

// Texas pay week runs Monday–Sunday. Takes a Central calendar date (YYYY-MM-DD) and
// returns that week's Monday/Sunday. Pure calendar math on the date string (UTC base)
// so the server's own timezone never shifts the week boundary (TS4).
export function payPeriodFor(centralDate: string): { start: string; end: string } {
  const [y, m, d] = centralDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const day = dt.getUTCDay()
  const daysFromMonday = day === 0 ? 6 : day - 1
  const monday = new Date(dt)
  monday.setUTCDate(dt.getUTCDate() - daysFromMonday)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  return {
    start: monday.toISOString().split('T')[0],
    end: sunday.toISOString().split('T')[0],
  }
}

type DayPunch = { id?: string; punch_type: string; punched_at: string }

// Split shifts — walk a day's punches in time order and pair each 'in' with the
// next 'out'. Each pair is a worked slice; the gaps between slices are unpaid
// breaks. A second 'in' before any 'out' leaves the first one unmatched (the
// two-Clock-Ins mistake), and an 'out' with no 'in' before it is unmatched too.
// A trailing 'in' (still clocked in, or a forgotten clock-out) is returned
// separately so callers can tell "on the clock now" from a mistake.
export function pairDayPunches<P extends DayPunch>(punches: P[]): {
  slices: { in: P; out: P }[]
  unmatched: P[]
  trailingIn: P | null
} {
  const sorted = [...punches].sort((a, b) => a.punched_at.localeCompare(b.punched_at))
  const slices: { in: P; out: P }[] = []
  const unmatched: P[] = []
  let pendingIn: P | null = null
  for (const p of sorted) {
    if (p.punch_type === 'in') {
      if (pendingIn) unmatched.push(pendingIn)
      pendingIn = p
    } else if (pendingIn) {
      slices.push({ in: pendingIn, out: p })
      pendingIn = null
    } else {
      unmatched.push(p)
    }
  }
  return { slices, unmatched, trailingIn: pendingIn }
}

// The first Central date a company counts break gaps as unpaid (null = never —
// the old first-in-to-last-out rule). Heroes switched on 2026-10-19; days before
// that keep the hours they were paid on.
async function unpaidBreaksFrom(admin: SupabaseClient, companyId: string | undefined): Promise<string | null> {
  if (!companyId) return null
  const { data } = await admin
    .from('timesheet_settings')
    .select('unpaid_breaks_from')
    .eq('company_id', companyId)
    .maybeSingle()
  return (data as { unpaid_breaks_from?: string | null } | null)?.unpaid_breaks_from ?? null
}

// Recompute (or clear) the time_entries row for one employee/date from that
// day's punches. Returns what happened so callers can surface it if useful.
//
// Rules (split-shift days — on/after the company's unpaid_breaks_from):
//  - Hours = the sum of every in→out slice; the gaps are break_hours (unpaid).
//  - clock_in / clock_out = the first slice's in and the last slice's out.
//  - No complete slice yet → no entry; remove any stale one.
// Rules (older days, or a company that never switched):
//  - Pair = earliest 'in' punch + latest 'out' punch on that calendar date.
//  - Both present and out > in → upsert the entry with the computed hours.
//  - Only an 'in' (still clocked in) → no entry yet; remove any stale one.
//  - No valid pair / no punches → delete any existing entry (kills phantoms).
export async function recomputeDayEntry(
  admin: SupabaseClient,
  employeeId: string,
  date: string, // YYYY-MM-DD
): Promise<{ action: 'upserted' | 'deleted' | 'skipped'; totalHours: number; error?: string }> {
  // Bucket by the Central calendar day, not UTC — otherwise evening punches that
  // cross UTC midnight land in the wrong day's window (TS4).
  const { startIso, endIso } = centralDayRangeUtc(date)
  const { data: dayPunches } = await admin
    .from('time_punches')
    .select('punch_type, punched_at, company_id')
    .eq('employee_id', employeeId)
    .gte('punched_at', startIso)
    .lt('punched_at', endIso)
    .order('punched_at', { ascending: true })

  const ins = (dayPunches ?? []).filter((p: { punch_type: string }) => p.punch_type === 'in')
  const outs = (dayPunches ?? []).filter((p: { punch_type: string }) => p.punch_type === 'out')

  const companyId = (ins[0] as { company_id?: string } | undefined)?.company_id
  const period = payPeriodFor(date)
  const breaksFrom = await unpaidBreaksFrom(admin, companyId)

  if (breaksFrom && date >= breaksFrom) {
    const { slices } = pairDayPunches(dayPunches ?? [])
    if (slices.length === 0) {
      const { error } = await admin.from('time_entries').delete().eq('employee_id', employeeId).eq('date', date)
      return { action: 'deleted', totalHours: 0, error: error?.message }
    }
    const workedMs = slices.reduce((s, sl) => s + (new Date(sl.out.punched_at).getTime() - new Date(sl.in.punched_at).getTime()), 0)
    const firstIn = new Date(slices[0].in.punched_at)
    const lastOut = new Date(slices[slices.length - 1].out.punched_at)
    const worked = Math.round((workedMs / 3600000) * 100) / 100
    const breaks = Math.max(0, Math.round(((lastOut.getTime() - firstIn.getTime() - workedMs) / 3600000) * 100) / 100)
    const { error } = await admin.from('time_entries').upsert({
      employee_id: employeeId,
      company_id: companyId,
      date,
      clock_in: firstIn.toISOString(),
      clock_out: lastOut.toISOString(),
      total_hours: worked,
      regular_hours: worked,
      overtime_hours: 0,
      break_hours: breaks,
      pay_period_start: period.start,
      pay_period_end: period.end,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'employee_id,date' })
    return { action: 'upserted', totalHours: worked, error: error?.message }
  }

  const inPunch = ins[0] // earliest in
  const outPunch = outs.length > 0 ? outs[outs.length - 1] : null // latest out

  // No complete pair → there should be no entry for this day. Remove a stale one.
  if (!inPunch || !outPunch) {
    const { error } = await admin.from('time_entries').delete().eq('employee_id', employeeId).eq('date', date)
    return { action: 'deleted', totalHours: 0, error: error?.message }
  }

  const clockIn = new Date(inPunch.punched_at)
  const clockOut = new Date(outPunch.punched_at)

  // Inverted pair (out <= in, e.g. an AM/PM typo) is not a real shift — never
  // persist a misleading 0-hour entry. Drop any stale row; the day shows blank
  // until the times are corrected. Source-level guard for every write path.
  if (clockOut.getTime() <= clockIn.getTime()) {
    const { error } = await admin.from('time_entries').delete().eq('employee_id', employeeId).eq('date', date)
    return { action: 'deleted', totalHours: 0, error: error?.message }
  }

  const totalHours = (clockOut.getTime() - clockIn.getTime()) / 3600000
  const rounded = Math.round(totalHours * 100) / 100

  const { error } = await admin.from('time_entries').upsert({
    employee_id: employeeId,
    // Inherited from the punch this entry is derived from, rather than the column
    // default (one tenant's id, being removed). The punch is the right source: the
    // rollup belongs to whoever the punch belonged to.
    company_id: companyId,
    date,
    clock_in: clockIn.toISOString(),
    clock_out: clockOut.toISOString(),
    total_hours: rounded,
    regular_hours: rounded,
    overtime_hours: 0,
    break_hours: 0,
    pay_period_start: period.start,
    pay_period_end: period.end,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'employee_id,date' })

  return { action: 'upserted', totalHours: rounded, error: error?.message }
}

// Shared punch-time validation. Returns a blocking error string (save must be
// refused) or null. Warnings (odd-but-allowed times) are handled client-side so
// the admin can confirm and proceed.
export function validatePunchPair(clockInIso: string, clockOutIso: string | null): string | null {
  const inT = new Date(clockInIso).getTime()
  if (isNaN(inT)) return 'Clock-in time is invalid.'
  if (clockOutIso) {
    const outT = new Date(clockOutIso).getTime()
    if (isNaN(outT)) return 'Clock-out time is invalid.'
    if (outT <= inT) return 'Clock-out must be after clock-in.'
    const hours = (outT - inT) / 3600000
    if (hours > 24) return 'A single shift cannot exceed 24 hours.'
  }
  return null
}
