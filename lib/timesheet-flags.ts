// Time Records flags — computed fresh from a pay week's punches + entries against
// the company's flag rules, then matched to the admin's clearances.
//
// Built in (always on, no setting):
//  - auto_clock_out  — the nightly safety net closed a forgotten shift.
//  - unmatched_punch — a Clock In with no Clock Out after it (or the reverse),
//                      e.g. two Ins saved in a row.
// Admin rules (Time Records → Settings → Flag rules):
//  - clock_in_before / clock_in_after   — checked on the day's FIRST clock-in
//    (so coming back from lunch never trips a "clock-in after" rule).
//  - clock_out_before / clock_out_after — checked on the day's LAST clock-out.
//  - day_hours_over — the day's paid hours.
//  - week_ot_over   — the week's overtime (hours past the weekly OT threshold).
//
// Every flag key embeds the offending value. Clearing stores that key, so an edit
// that still breaks the rule makes a new key and the flag comes back; an edit that
// fixes it simply stops producing the flag.

import type { SupabaseClient } from '@supabase/supabase-js'
import { centralDate, centralDayRangeUtc, CENTRAL_TZ } from '@/lib/timezone'
import { pairDayPunches } from '@/lib/timesheet-recompute'
import { addDaysToDate } from '@/lib/timesheet-lock'

export type FlagRuleKind =
  | 'clock_in_before' | 'clock_in_after' | 'clock_out_before' | 'clock_out_after'
  | 'day_hours_over' | 'week_ot_over'

export type FlagRule = {
  id: string
  kind: FlagRuleKind
  time_value: string | null // 'HH:MM:SS' Central
  hours_value: number | null
  is_active: boolean
}

export type TimesheetFlag = {
  key: string
  employee_id: string
  date: string | null // null = a whole-week flag
  kind: 'auto_clock_out' | 'unmatched_punch' | FlagRuleKind
  label: string
  detail: string
  cleared: { at: string; by: string | null; note: string | null } | null
}

export type WeekFlagReport = {
  flags: TimesheetFlag[]
  openShifts: { employee_id: string; punched_at: string }[]
  pendingEditRequests: number
  pendingPto: number
  approval: { approved_at: string; approved_by: string | null } | null
}

type Punch = { id: string; employee_id: string; punch_type: 'in' | 'out'; punched_at: string; is_auto_clock_out: boolean }

const RULE_LABEL: Record<FlagRuleKind, string> = {
  clock_in_before: 'Clock-in before',
  clock_in_after: 'Clock-in after',
  clock_out_before: 'Clock-out before',
  clock_out_after: 'Clock-out after',
  day_hours_over: 'Day over',
  week_ot_over: 'Week overtime over',
}

/** Minutes past Central midnight for an instant. */
function centralMinutes(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL_TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(iso))
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0)
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0)
  return h * 60 + m
}

function timeValueMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

/** 'HH:MM[:SS]' → '6:30 PM'. */
export function formatRuleTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m || 0).padStart(2, '0')} ${suffix}`
}

function punchTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: CENTRAL_TZ, hour: 'numeric', minute: '2-digit' })
}

export function ruleLabel(rule: Pick<FlagRule, 'kind' | 'time_value' | 'hours_value'>): string {
  if (rule.kind === 'day_hours_over' || rule.kind === 'week_ot_over') {
    return `${RULE_LABEL[rule.kind]} ${Number(rule.hours_value)} hours`
  }
  return `${RULE_LABEL[rule.kind]} ${formatRuleTime(rule.time_value ?? '00:00')}`
}

export async function computeWeekFlags(
  admin: SupabaseClient,
  companyId: string,
  weekStart: string, // YYYY-MM-DD, the first day of the pay week
): Promise<WeekFlagReport> {
  const weekEnd = addDaysToDate(weekStart, 6)
  const startIso = centralDayRangeUtc(weekStart).startIso
  const endIso = centralDayRangeUtc(weekEnd).endIso

  // Punches — paged, so a big crew never silently truncates at the 1000-row cap.
  const punches: Punch[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from('time_punches')
      .select('id, employee_id, punch_type, punched_at, is_auto_clock_out')
      .eq('company_id', companyId)
      .gte('punched_at', startIso)
      .lt('punched_at', endIso)
      .order('punched_at', { ascending: true })
      .range(from, from + 999)
    punches.push(...((data ?? []) as Punch[]))
    if (!data || data.length < 1000) break
  }

  const [entriesRes, rulesRes, reviewsRes, settingsRes, approvalRes, editsRes, ptoRes] = await Promise.all([
    admin.from('time_entries').select('employee_id, date, total_hours')
      .eq('company_id', companyId).gte('date', weekStart).lte('date', weekEnd),
    admin.from('timesheet_flag_rules').select('id, kind, time_value, hours_value, is_active')
      .eq('company_id', companyId).is('deleted_at', null).eq('is_active', true),
    admin.from('timesheet_flag_reviews').select('flag_key, note, cleared_at, cleared_by')
      .eq('company_id', companyId).eq('week_start', weekStart),
    admin.from('timesheet_settings').select('overtime_threshold_weekly')
      .eq('company_id', companyId).maybeSingle(),
    admin.from('timesheet_week_approvals').select('approved_at, approved_by')
      .eq('company_id', companyId).eq('week_start', weekStart).is('revoked_at', null).maybeSingle(),
    admin.from('time_punch_edit_requests').select('id, time_entries!inner(date)')
      .eq('company_id', companyId).eq('status', 'pending')
      .gte('time_entries.date', weekStart).lte('time_entries.date', weekEnd),
    admin.from('pto_requests').select('id')
      .eq('company_id', companyId).eq('status', 'pending')
      .gte('request_date', weekStart).lte('request_date', weekEnd),
  ])

  const entries = (entriesRes.data ?? []) as { employee_id: string; date: string; total_hours: number | null }[]
  const rules = (rulesRes.data ?? []) as FlagRule[]
  const reviews = (reviewsRes.data ?? []) as { flag_key: string; note: string | null; cleared_at: string; cleared_by: string | null }[]
  const otThreshold = settingsRes.data?.overtime_threshold_weekly != null ? Number(settingsRes.data.overtime_threshold_weekly) : 40

  // Names for "cleared by" / "approved by".
  const userIds = [...new Set([
    ...reviews.map(r => r.cleared_by),
    approvalRes.data?.approved_by ?? null,
  ].filter((v): v is string => !!v))]
  const names = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: profs } = await admin.from('user_profiles').select('id, full_name').in('id', userIds)
    for (const p of (profs ?? []) as { id: string; full_name: string | null }[]) names.set(p.id, p.full_name ?? 'Admin')
  }
  const reviewByKey = new Map(reviews.map(r => [r.flag_key, r]))

  const flags: TimesheetFlag[] = []
  const add = (f: Omit<TimesheetFlag, 'cleared'>) => {
    const r = reviewByKey.get(f.key)
    flags.push({ ...f, cleared: r ? { at: r.cleared_at, by: r.cleared_by ? names.get(r.cleared_by) ?? 'Admin' : null, note: r.note } : null })
  }

  // Group punches by employee → Central day.
  const byEmpDay = new Map<string, Map<string, Punch[]>>()
  for (const p of punches) {
    const day = centralDate(p.punched_at)
    if (!byEmpDay.has(p.employee_id)) byEmpDay.set(p.employee_id, new Map())
    const days = byEmpDay.get(p.employee_id)!
    if (!days.has(day)) days.set(day, [])
    days.get(day)!.push(p)
  }

  const openShifts: WeekFlagReport['openShifts'] = []
  const clockRules = rules.filter(r => r.kind.startsWith('clock_') && r.time_value)

  for (const [employeeId, days] of byEmpDay) {
    const dayKeys = [...days.keys()].sort()
    for (const day of dayKeys) {
      const dayPunches = days.get(day)!
      const { unmatched, trailingIn } = pairDayPunches(dayPunches)

      for (const p of dayPunches) {
        if (p.is_auto_clock_out) {
          add({
            key: `auto:${p.id}:${p.punched_at}`, employee_id: employeeId, date: day, kind: 'auto_clock_out',
            label: 'Auto clock-out',
            detail: `They never clocked out, so the system clocked them out at ${punchTime(p.punched_at)}. Check the real end time.`,
          })
        }
      }

      const strays = [...unmatched]
      if (trailingIn) {
        // Still on the clock right now is not a mistake — unless they have a later
        // punch (it's an old In that never got its Out).
        const { data: later } = await admin.from('time_punches').select('id')
          .eq('employee_id', employeeId).gt('punched_at', trailingIn.punched_at).limit(1)
        if ((later ?? []).length === 0) openShifts.push({ employee_id: employeeId, punched_at: trailingIn.punched_at })
        else strays.push(trailingIn)
      }
      for (const p of strays) {
        add({
          key: `unmatched:${p.id}:${p.punch_type}:${p.punched_at}`, employee_id: employeeId, date: day, kind: 'unmatched_punch',
          label: p.punch_type === 'in' ? 'Missing clock-out' : 'Missing clock-in',
          detail: p.punch_type === 'in'
            ? `Clock In at ${punchTime(p.punched_at)} has no Clock Out after it, so it isn't counted.`
            : `Clock Out at ${punchTime(p.punched_at)} has no Clock In before it, so it isn't counted.`,
        })
      }

      const firstIn = dayPunches.find(p => p.punch_type === 'in')
      const lastOut = [...dayPunches].reverse().find(p => p.punch_type === 'out' && !p.is_auto_clock_out)
      for (const rule of clockRules) {
        const limit = timeValueMinutes(rule.time_value!)
        const target = rule.kind.startsWith('clock_in') ? firstIn : lastOut
        if (!target) continue
        const at = centralMinutes(target.punched_at)
        const hit = rule.kind.endsWith('_before') ? at < limit : at > limit
        if (!hit) continue
        add({
          key: `rule:${rule.id}:${target.id}:${target.punched_at}`, employee_id: employeeId, date: day, kind: rule.kind,
          label: ruleLabel(rule),
          detail: `${target.punch_type === 'in' ? 'Clocked in' : 'Clocked out'} at ${punchTime(target.punched_at)}.`,
        })
      }
    }
  }

  // Hours rules — from the derived entries (the hours payroll actually uses).
  const dayRules = rules.filter(r => r.kind === 'day_hours_over' && r.hours_value != null)
  const weekRules = rules.filter(r => r.kind === 'week_ot_over' && r.hours_value != null)
  const weekTotals = new Map<string, number>()
  for (const e of entries) {
    const hrs = Number(e.total_hours ?? 0)
    weekTotals.set(e.employee_id, (weekTotals.get(e.employee_id) ?? 0) + hrs)
    for (const rule of dayRules) {
      if (hrs > Number(rule.hours_value)) {
        add({
          key: `rule:${rule.id}:${e.employee_id}:${e.date}:${hrs.toFixed(2)}`, employee_id: e.employee_id, date: e.date, kind: rule.kind,
          label: ruleLabel(rule), detail: `Worked ${hrs.toFixed(2)} hours.`,
        })
      }
    }
  }
  for (const [employeeId, total] of weekTotals) {
    const ot = Math.max(0, total - otThreshold)
    for (const rule of weekRules) {
      if (ot > Number(rule.hours_value)) {
        add({
          key: `rule:${rule.id}:${employeeId}:week:${weekStart}:${ot.toFixed(2)}`, employee_id: employeeId, date: null, kind: rule.kind,
          label: ruleLabel(rule), detail: `${ot.toFixed(2)} hours of overtime this week (${total.toFixed(2)} total).`,
        })
      }
    }
  }

  flags.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.label.localeCompare(b.label))

  return {
    flags,
    openShifts,
    pendingEditRequests: (editsRes.data ?? []).length,
    pendingPto: (ptoRes.data ?? []).length,
    approval: approvalRes.data
      ? { approved_at: approvalRes.data.approved_at, approved_by: approvalRes.data.approved_by ? names.get(approvalRes.data.approved_by) ?? 'Admin' : null }
      : null,
  }
}
