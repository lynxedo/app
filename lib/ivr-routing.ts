// Client-safe IVR types and routing logic.
//
// Extracted from lib/twilio-voice.ts (which is server-only due to Twilio/crypto
// imports) so client components can import the picker and types directly without
// pulling in server-only modules. lib/twilio-voice.ts re-exports everything here
// so existing server-side callers are unaffected.

import type { DndSchedule } from './dnd-schedule'

// ---------------------------------------------------------------------------
// IVR data-model types
// ---------------------------------------------------------------------------

export type IvrPrompt =
  | { kind: 'tts'; text: string }
  | { kind: 'audio'; audio_url: string }

export type IvrAction =
  | { kind: 'submenu'; target_node_id: string }
  | { kind: 'voicemail' }
  | { kind: 'transfer_user'; user_id: string; identity: string; timeout_sec?: number }
  | { kind: 'transfer_pstn'; number: string; timeout_sec?: number }
  | { kind: 'hangup' }
  | { kind: 'say'; prompt: IvrPrompt }
  | { kind: 'repeat'; max_repeats?: number; then?: IvrAction }
  // Session 60:
  | { kind: 'extension'; extension: string }
  | { kind: 'ring_group'; ring_group_id: string }

export type IvrNode = {
  id: string
  label?: string
  prompt: IvrPrompt
  keypresses: Partial<Record<'0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '*' | '#', IvrAction>>
  no_input?: IvrAction
  invalid_input?: IvrAction
  gather_timeout_sec?: number
}

export type IvrTree = {
  root_node_id: string
  nodes: Record<string, IvrNode>
}

export type IvrConfig = {
  trees: {
    default?: IvrTree
    after_hours?: IvrTree
    holiday?: IvrTree
  }
}

export type IvrTreeName = 'default' | 'after_hours' | 'holiday'

// ---------------------------------------------------------------------------
// Business-hours / holiday types
//
// business_hours jsonb shape (same as DndSchedule so we can reuse parsing):
//   { enabled: bool, tz: 'America/Chicago', days: { mon: [{from:'08:00', to:'18:00'}], ... } }
//
// holidays jsonb shape (array):
//   [ { kind: 'date', date: 'YYYY-MM-DD', label?: string },
//     { kind: 'recurring', month: 1-12, day: 1-31, label?: string } ]
// ---------------------------------------------------------------------------

export type BusinessHoursSchedule = DndSchedule

export type HolidayEntry =
  | { kind: 'date'; date: string; label?: string }
  | { kind: 'recurring'; month: number; day: number; label?: string }

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'

function parseHm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return null
  const h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

// ---------------------------------------------------------------------------
// Exported routing functions
// ---------------------------------------------------------------------------

// True if `now` is inside any scheduled window for today's local day.
// Mirrors isInDndSchedule but doesn't consider yesterday's wrap-overnight
// windows — business hours don't realistically span midnight.
export function isWithinBusinessHours(
  schedule: BusinessHoursSchedule | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!schedule || !schedule.enabled || !schedule.days) return false
  const tz = schedule.tz || 'America/Chicago'

  let dayKey: DayKey
  let nowMin: number
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const parts = fmt.formatToParts(now)
    const wd = parts.find((p) => p.type === 'weekday')?.value || ''
    const hourStr = parts.find((p) => p.type === 'hour')?.value || '0'
    const minStr = parts.find((p) => p.type === 'minute')?.value || '0'
    const map: Record<string, DayKey> = {
      Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat',
    }
    dayKey = map[wd] || 'mon'
    const h = parseInt(hourStr, 10) % 24
    const m = parseInt(minStr, 10)
    nowMin = h * 60 + m
  } catch {
    return false
  }

  const windows = schedule.days[dayKey]
  if (!windows) return false
  for (const w of windows) {
    const from = parseHm(w.from)
    const to = parseHm(w.to)
    if (from === null || to === null) continue
    if (from === to) continue
    if (from < to) {
      if (nowMin >= from && nowMin < to) return true
    } else {
      // Wrap-overnight (unusual for business hours but support it).
      if (nowMin >= from || nowMin < to) return true
    }
  }
  return false
}

// True if today's local date (in `tz`) matches any entry in `holidays`.
export function isHolidayToday(
  holidays: HolidayEntry[] | null | undefined,
  tz: string = 'America/Chicago',
  now: Date = new Date(),
): boolean {
  if (!Array.isArray(holidays) || holidays.length === 0) return false

  let ymd: string
  let month: number
  let day: number
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const parts = fmt.formatToParts(now)
    const y = parts.find((p) => p.type === 'year')?.value || ''
    const mo = parts.find((p) => p.type === 'month')?.value || ''
    const d = parts.find((p) => p.type === 'day')?.value || ''
    if (!y || !mo || !d) return false
    ymd = `${y}-${mo}-${d}`
    month = parseInt(mo, 10)
    day = parseInt(d, 10)
  } catch {
    return false
  }

  for (const h of holidays) {
    if (!h || typeof h !== 'object') continue
    if (h.kind === 'date' && typeof h.date === 'string' && h.date === ymd) return true
    if (h.kind === 'recurring' && h.month === month && h.day === day) return true
  }
  return false
}

// Decide which IVR tree to run for a given call right now.
// Returns 'holiday' | 'after_hours' | 'default'. The caller is responsible
// for falling back to 'default' if the picked tree is misconfigured.
// Picker order: holiday > after_hours > default.
export function pickIvrTree(opts: {
  config: IvrConfig
  businessHours?: BusinessHoursSchedule | null
  holidays?: HolidayEntry[] | null
  now?: Date
}): IvrTreeName {
  const now = opts.now ?? new Date()
  const tz = opts.businessHours?.tz || 'America/Chicago'

  const hasHoliday = !!opts.config.trees?.holiday?.root_node_id
  if (hasHoliday && isHolidayToday(opts.holidays, tz, now)) return 'holiday'

  const hasAfterHours = !!opts.config.trees?.after_hours?.root_node_id
  if (hasAfterHours && opts.businessHours?.enabled && !isWithinBusinessHours(opts.businessHours, now)) {
    return 'after_hours'
  }

  return 'default'
}
