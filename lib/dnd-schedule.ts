// Client-safe DND schedule evaluation. Pure (Intl only) so it can be imported
// from client components (the chime / Electron notifiers) as well as the server.
//
// NT7 (Phase 3): this module is now the single source of truth for DND schedule
// evaluation. lib/twilio-voice.ts (which pulls in node:crypto + Twilio env and
// can't be imported client-side) re-exports isInDndSchedule / userIsDndNow /
// DndSchedule / DndWindow from here, so its callers keep working unchanged.

export type DndWindow = { from: string; to: string }
export type DndSchedule = {
  enabled?: boolean
  tz?: string
  days?: Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', DndWindow[]>>
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

function parseHm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return null
  const h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

// True if `now` falls inside any window for the local day in `schedule.tz`.
export function isInDndSchedule(schedule: DndSchedule | null | undefined, now: Date = new Date()): boolean {
  if (!schedule || !schedule.enabled || !schedule.days) return false
  const tz = schedule.tz || 'America/Chicago'

  let dayKey: (typeof DAY_KEYS)[number]
  let nowMin: number
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const parts = fmt.formatToParts(now)
    const wd = parts.find((p) => p.type === 'weekday')?.value || ''
    const hourStr = parts.find((p) => p.type === 'hour')?.value || '0'
    const minStr = parts.find((p) => p.type === 'minute')?.value || '0'
    const map: Record<string, (typeof DAY_KEYS)[number]> = {
      Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat',
    }
    dayKey = map[wd] || 'mon'
    nowMin = (parseInt(hourStr, 10) % 24) * 60 + parseInt(minStr, 10)
  } catch {
    return false
  }

  function dayInWindow(windows: DndWindow[] | undefined, atMin: number): boolean {
    if (!windows) return false
    for (const w of windows) {
      const from = parseHm(w.from)
      const to = parseHm(w.to)
      if (from === null || to === null || from === to) continue
      if (from < to) { if (atMin >= from && atMin < to) return true }
      else { if (atMin >= from || atMin < to) return true }
    }
    return false
  }

  if (dayInWindow(schedule.days[dayKey], nowMin)) return true

  // A window on the PREVIOUS day that wraps past midnight keeps us in DND now.
  const yesterdayKey = DAY_KEYS[(DAY_KEYS.indexOf(dayKey) + 6) % 7]
  for (const w of schedule.days[yesterdayKey] ?? []) {
    const from = parseHm(w.from)
    const to = parseHm(w.to)
    if (from === null || to === null) continue
    if (from > to && nowMin < to) return true
  }
  return false
}

// Combined helper: a user is DND-now if their manual toggle is on OR they're
// inside their scheduled DND window. Used by the dialer call-routing paths.
export function userIsDndNow(opts: {
  manualEnabled: boolean
  schedule: DndSchedule | null | undefined
  now?: Date
}): boolean {
  if (opts.manualEnabled) return true
  return isInDndSchedule(opts.schedule, opts.now)
}

// A message chime/banner should be silenced if Master DND (kills everything) OR
// Hub DND (messages only) is active — manual toggle or scheduled window.
export function isHubMessagingDndNow(p: {
  master_dnd_enabled?: boolean | null
  master_dnd_schedule?: DndSchedule | null
  hub_dnd_enabled?: boolean | null
  hub_dnd_schedule?: DndSchedule | null
}, now: Date = new Date()): boolean {
  if (p.master_dnd_enabled) return true
  if (isInDndSchedule(p.master_dnd_schedule, now)) return true
  if (p.hub_dnd_enabled) return true
  if (isInDndSchedule(p.hub_dnd_schedule, now)) return true
  return false
}
