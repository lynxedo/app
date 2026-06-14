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

// Texas pay week runs Monday–Sunday.
export function payPeriodFor(date: Date): { start: string; end: string } {
  const d = new Date(date)
  const day = d.getDay()
  const daysFromMonday = day === 0 ? 6 : day - 1
  const monday = new Date(d)
  monday.setDate(d.getDate() - daysFromMonday)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return {
    start: monday.toISOString().split('T')[0],
    end: sunday.toISOString().split('T')[0],
  }
}

// Recompute (or clear) the time_entries row for one employee/date from that
// day's punches. Returns what happened so callers can surface it if useful.
//
// Rules:
//  - Pair = earliest 'in' punch + latest 'out' punch on that calendar date.
//  - Both present and out > in → upsert the entry with the computed hours.
//  - Only an 'in' (still clocked in) → no entry yet; remove any stale one.
//  - No valid pair / no punches → delete any existing entry (kills phantoms).
export async function recomputeDayEntry(
  admin: SupabaseClient,
  employeeId: string,
  date: string, // YYYY-MM-DD
): Promise<{ action: 'upserted' | 'deleted' | 'skipped'; totalHours: number; error?: string }> {
  const { data: dayPunches } = await admin
    .from('time_punches')
    .select('punch_type, punched_at')
    .eq('employee_id', employeeId)
    .gte('punched_at', date + 'T00:00:00Z')
    .lte('punched_at', date + 'T23:59:59.999Z')
    .order('punched_at', { ascending: true })

  const ins = (dayPunches ?? []).filter((p: { punch_type: string }) => p.punch_type === 'in')
  const outs = (dayPunches ?? []).filter((p: { punch_type: string }) => p.punch_type === 'out')

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
  const period = payPeriodFor(clockIn)

  const { error } = await admin.from('time_entries').upsert({
    employee_id: employeeId,
    date,
    clock_in: clockIn.toISOString(),
    clock_out: clockOut.toISOString(),
    total_hours: rounded,
    regular_hours: rounded,
    overtime_hours: 0,
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
