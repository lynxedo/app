// Dispatch — shared types + pure helpers (Reference/PRDs/DISPATCH_ROUTING_PRD.md).
// No server imports: used by the API routes AND the Dispatch view.
//
// Jobber stays the schedule of record. Hub keeps only what Jobber can't hold:
// locked time frames (= PROMISED stops), the unsent draft, per-tech start/end
// overrides and these settings.

import { COMPANY_TZ, tzOffset } from '@/lib/tz'

// ── Settings (company_routing_settings.dispatch_settings) ───────────────────

export type ColorRuleType = 'line_item' | 'assigned' | 'title' | 'promised'

export interface ColorRule {
  id: string
  type: ColorRuleType
  /** line_item / title: case-insensitive "contains"; assigned: a Jobber user id; promised: unused. */
  match: string
  label: string
  color: string // #rrggbb
}

/** A filter chip. Matches a stop's LINE ITEMS (never its title) — other tenants
 *  title jobs differently (Ben, Oct 19 2026). `kind` chips match the stop type. */
export interface FilterGroup {
  id: string
  label: string
  match: string                // line-item name contains (case-insensitive); ignored when kind is set
  kind?: 'assessment' | 'task'
}

export interface DispatchSettings {
  /** Earliest the first stop's arrival window may start, "HH:MM" local. */
  arrival_first: string
  /** Latest a stop's arrival window may start, "HH:MM" local. */
  arrival_last: string
  /** Jobber's day-before reminder send time, "HH:MM" local. */
  reminder_cutoff: string
  /** Timeline span shown in the lanes. */
  view_start: string
  view_end: string
  /** Jobber user ids shown as lanes by default (each person can change theirs). */
  default_team: string[]
  color_rules: ColorRule[]
  filter_groups: FilterGroup[]
  /** Days Find a slot may use: 0 = Sunday … 6 = Saturday. */
  work_days: number[]
  /** Opt-in: read "AM" / "PM" / "1-4PM" / "after 1PM" / "10AM" in a visit title as a
   *  SUGGESTED promised window. The one place title text is read; never a filter. */
  title_windows: boolean
  /** Hub day-before reminders (Phase 3) — built OFF; Ben switches on when Jobber's go off. */
  reminders: ReminderSettings
}

// ── Day-before reminders ────────────────────────────────────────────────────

export interface ReminderTemplate {
  id: string
  name: string
  /** Line item name contains (case-insensitive); '' = any visit. */
  match: string
  /** Timed (has an arrival window) or anytime visits. */
  applies_to: 'timed' | 'anytime'
  sms: boolean
  email: boolean
  sms_body: string
  email_subject: string
  email_body: string
}

export interface ReminderSettings {
  /** Master switch. While false nothing is ever sent (preview + test still work). */
  enabled: boolean
  /** Local "HH:MM" on the day before. */
  send_time: string
  /** Hub user who owns the text threads (gets the replies). The text itself is unsigned. */
  owner_user_id: string | null
  /** email_sending_identities.id; null = the company default sender. */
  email_identity_id: string | null
  /** Length of the arrival window for a timed (not promised) visit, minutes. */
  timed_window_minutes: number
  templates: ReminderTemplate[]
}

export const REMINDER_PLACEHOLDERS = ['{first_name}', '{name}', '{company}', '{day}', '{date}', '{start}', '{end}', '{address}', '{service}'] as const

export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: false,
  send_time: '14:00',
  owner_user_id: null,
  email_identity_id: null,
  timed_window_minutes: 120,
  templates: [],
}

const clampInt = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d

export function normalizeReminders(raw: unknown): ReminderSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v : '').slice(0, max)
  return {
    enabled: r.enabled === true,
    send_time: typeof r.send_time === 'string' && HHMM.test(r.send_time) ? r.send_time : DEFAULT_REMINDERS.send_time,
    owner_user_id: typeof r.owner_user_id === 'string' && r.owner_user_id ? r.owner_user_id : null,
    email_identity_id: typeof r.email_identity_id === 'string' && r.email_identity_id ? r.email_identity_id : null,
    timed_window_minutes: clampInt(r.timed_window_minutes, 30, 480, DEFAULT_REMINDERS.timed_window_minutes),
    templates: (Array.isArray(r.templates) ? r.templates : [])
      .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object' && typeof (t as { id?: unknown }).id === 'string')
      .map(t => ({
        id: t.id as string,
        name: str(t.name, 60),
        match: str(t.match, 80),
        applies_to: t.applies_to === 'anytime' ? 'anytime' as const : 'timed' as const,
        sms: t.sms === true,
        email: t.email === true,
        sms_body: str(t.sms_body, 640),
        email_subject: str(t.email_subject, 160),
        email_body: str(t.email_body, 4000),
      }))
      .slice(0, 20),
  }
}

/** First template (in order) whose line-item match and visit type fit. */
export function pickReminderTemplate(templates: ReminderTemplate[], lineItemNames: string[], timed: boolean): ReminderTemplate | null {
  const items = lineItemNames.map(n => n.toLowerCase())
  for (const t of templates) {
    if ((t.applies_to === 'timed') !== timed) continue
    const m = t.match.trim().toLowerCase()
    if (!m || items.some(n => n.includes(m))) return t
  }
  return null
}

export function renderReminder(text: string, v: Record<string, string>): string {
  return text.replace(/\{(first_name|name|company|day|date|start|end|address|service)\}/g, (_, k: string) => v[k] ?? '')
}

export const DEFAULT_DISPATCH_SETTINGS: DispatchSettings = {
  arrival_first: '08:00',
  arrival_last: '14:00',
  reminder_cutoff: '14:00',
  view_start: '07:00',
  view_end: '17:00',
  default_team: [],
  color_rules: [],
  filter_groups: [],
  work_days: [1, 2, 3, 4, 5],
  title_windows: false,
  reminders: DEFAULT_REMINDERS,
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const HEX = /^#[0-9a-fA-F]{6}$/

/** Merge stored jsonb over the defaults, dropping anything malformed. */
export function normalizeDispatchSettings(raw: unknown): DispatchSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const hhmm = (k: keyof DispatchSettings) =>
    typeof r[k] === 'string' && HHMM.test(r[k] as string) ? (r[k] as string) : (DEFAULT_DISPATCH_SETTINGS[k] as string)
  const rules = Array.isArray(r.color_rules) ? r.color_rules : []
  const groups = Array.isArray(r.filter_groups) ? r.filter_groups : []
  return {
    arrival_first: hhmm('arrival_first'),
    arrival_last: hhmm('arrival_last'),
    reminder_cutoff: hhmm('reminder_cutoff'),
    view_start: hhmm('view_start'),
    view_end: hhmm('view_end'),
    default_team: Array.isArray(r.default_team) ? (r.default_team as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    color_rules: rules
      .filter((x): x is ColorRule => !!x && typeof x === 'object'
        && typeof (x as ColorRule).id === 'string'
        && ['line_item', 'assigned', 'title', 'promised'].includes((x as ColorRule).type)
        && typeof (x as ColorRule).color === 'string' && HEX.test((x as ColorRule).color))
      .map(x => ({ id: x.id, type: x.type, match: String(x.match ?? ''), label: String(x.label ?? ''), color: x.color }))
      .slice(0, 30),
    filter_groups: groups
      .filter((x): x is FilterGroup => !!x && typeof x === 'object' && typeof (x as FilterGroup).id === 'string')
      .map(x => ({
        id: x.id, label: String(x.label ?? '').slice(0, 40), match: String(x.match ?? ''),
        ...(x.kind === 'assessment' || x.kind === 'task' ? { kind: x.kind } : {}),
      }))
      .slice(0, 12),
    work_days: Array.isArray(r.work_days)
      ? [...new Set((r.work_days as unknown[]).filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort()
      : DEFAULT_DISPATCH_SETTINGS.work_days,
    title_windows: r.title_windows === true,
    reminders: normalizeReminders(r.reminders),
  }
}

/**
 * Suggested promised window from a visit title (opt-in per tenant, Heroes-style
 * shorthand). Returns minutes since midnight, or null. Only ever a suggestion —
 * the office still clicks Lock.
 *   "1-4PM" / "1-4 pm" / "10-12" → that range (bare hours under 7 read as pm)
 *   "after 1PM"                  → 1 pm to the end of the arrival day
 *   "AM" → arrival start – 12 pm;  "PM" → 12 pm – arrival end
 *   "10AM" / "2:30PM"            → a one-hour window from that time
 */
export function parseTitleWindow(title: string, s: Pick<DispatchSettings, 'arrival_first' | 'arrival_last'>): { start: number; end: number; label: string } | null {
  const t = ` ${title.toUpperCase().replace(/\s+/g, ' ')} `
  const first = hhmmToMinutes(s.arrival_first)
  const lastStart = hhmmToMinutes(s.arrival_last)
  const dayEnd = Math.max(lastStart + 60, 17 * 60)
  const hour = (h: number, mer: string | undefined, fallbackPm: boolean) => {
    let x = h % 12
    if (mer === 'PM' || (!mer && h === 12) || (!mer && fallbackPm && h < 7)) x += 12
    return x * 60
  }
  let m = t.match(/AFTER (\d{1,2})(?::(\d{2}))? ?(AM|PM)?/)
  if (m) {
    const st = hour(Number(m[1]), m[3], true) + Number(m[2] ?? 0)
    return { start: st, end: dayEnd, label: m[0].trim() }
  }
  m = t.match(/[ /](\d{1,2})(?::(\d{2}))? ?(AM|PM)? ?[-–] ?(\d{1,2})(?::(\d{2}))? ?(AM|PM)?[ ,.)]/)
  if (m && (m[3] || m[6] || Number(m[1]) <= 12)) {
    const endMer = m[6] ?? m[3]
    const en = hour(Number(m[4]), endMer, true) + Number(m[5] ?? 0)
    let st = hour(Number(m[1]), m[3] ?? (endMer === 'PM' && Number(m[1]) <= Number(m[4]) ? 'PM' : endMer), true) + Number(m[2] ?? 0)
    if (st >= en) st = hour(Number(m[1]), 'AM', false) + Number(m[2] ?? 0)
    if (en > st) return { start: st, end: en, label: m[0].trim() }
  }
  m = t.match(/[ /](\d{1,2})(?::(\d{2}))? ?(AM|PM)[ ,.)]/)
  if (m) {
    const st = hour(Number(m[1]), m[3], false) + Number(m[2] ?? 0)
    return { start: st, end: st + 60, label: m[0].trim() }
  }
  if (/ AM[ ,.)]/.test(t)) return { start: first, end: 12 * 60, label: 'AM' }
  if (/ PM[ ,.)]/.test(t)) return { start: 12 * 60, end: dayEnd, label: 'PM' }
  return null
}

export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

// ── Stops ───────────────────────────────────────────────────────────────────

export type StopKind = 'visit' | 'assessment' | 'task'

/** One schedulable Jobber item as Dispatch sees it (scheduled or not). */
export interface DispatchStop {
  id: string
  kind: StopKind
  clientName: string
  phone: string | null
  address: string
  routable: boolean
  title: string           // the visit's own title when known, else the job's
  lineItemNames: string[]
  /** Priced line items, for the printed route sheet. */
  lineItems?: Array<{ name: string; qty: number; unitPrice: number; totalPrice: number }>
  totalPrice: number
  instructions: string | null
  startAt: string | null  // ISO from Jobber
  endAt: string | null
  allDay: boolean         // Jobber "anytime"
  isComplete: boolean
  arrivalStart: string | null // Jobber's own arrival window, when it has one
  arrivalEnd: string | null
  techIds: string[]       // Jobber users assigned
  createdAt?: string | null
}

export interface DispatchLock {
  jobber_item_id: string
  item_kind: StopKind
  window_start: string
  window_end: string
  locked_source: 'office' | 'amber' | 'parser'
  note: string | null
}

/** A drafted move. Times are LOCAL "YYYY-MM-DDTHH:MM:SS" — the shape
 *  /api/send-to-jobber takes. `from*` is what Jobber had when the move was made,
 *  so Send can tell whether someone changed the stop since. */
export interface DraftChange {
  id: string
  kind: StopKind
  clientName: string
  phone: string | null
  fromStartAt: string | null   // ISO as read from Jobber (null = was unscheduled)
  fromTechIds: string[]
  toStart: string              // local
  toEnd: string                // local
  toTechId: string
  /** When the move also re-set the stop's locked window ("customer agreed"). */
  newLock?: { start: string; end: string } | null
  at: string                   // when drafted (ISO)
  /** Moved as an ANYTIME visit (date + tech only, no clock time) — Month/Week
   *  drags of anytime stops. toStart/toEnd are then "<date>T00:00:00". */
  anytime?: boolean
  /** Enough of the stop to draw it on a day that didn't load it (moved there
   *  from another day in Month/Week). */
  snapshot?: {
    address: string
    title: string
    lineItemNames: string[]
    totalPrice: number
    routable: boolean
    instructions?: string | null
  } | null
}

/** The day a drafted change lands on. Drafts span every day (Oct 20 2026). */
export const changeDate = (c: Pick<DraftChange, 'toStart'>) => c.toStart.slice(0, 10)

/**
 * A tech's stops for one day in ROUTE order (Ben, Oct 20 2026: Jobber's API
 * can't order anytime visits, so the order the office drags into place lives in
 * Hub — dispatch_route_order). With a saved order: saved positions first; any
 * stop not in it follows, timed by time then anytime as given. Without one:
 * timed stops by time, then anytime stops in the order Jobber returned them.
 */
export function orderRoute<T extends { id: string; startMin: number | null }>(stops: T[], saved?: string[] | null): T[] {
  const byTime = (a: T, b: T) => (a.startMin ?? Infinity) - (b.startMin ?? Infinity)
  const natural = [...stops.filter(s => s.startMin != null).sort(byTime), ...stops.filter(s => s.startMin == null)]
  if (!saved || saved.length === 0) return natural
  const pos = new Map(saved.map((id, i) => [id, i]))
  const known = natural.filter(s => pos.has(s.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!)
  const rest = natural.filter(s => !pos.has(s.id))
  return [...known, ...rest]
}

/** Put `id` just before `beforeId` (or at the end) in an order list. */
export function insertInOrder(ids: string[], id: string, beforeId: string | null): string[] {
  const out = ids.filter(x => x !== id)
  const at = beforeId ? out.indexOf(beforeId) : -1
  if (at < 0) out.push(id)
  else out.splice(at, 0, id)
  return out
}

// ── Time helpers (company timezone) ─────────────────────────────────────────

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: COMPANY_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** ISO instant → { date: "YYYY-MM-DD", minutes since local midnight }. */
export function isoToLocal(iso: string): { date: string; minutes: number } {
  const p: Record<string, string> = {}
  for (const x of partsFmt.formatToParts(new Date(iso))) p[x.type] = x.value
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) }
}

/** Local date + minutes → "YYYY-MM-DDTHH:MM:00" (local, no offset). */
export function localStamp(date: string, minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)))
  return `${date}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`
}

/** Local "YYYY-MM-DDTHH:MM:SS" → ISO instant with the day's real offset. */
export function localToIso(local: string): string {
  const date = local.slice(0, 10)
  return `${local.slice(0, 19)}${tzOffset(date)}`
}

export function fmtClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24
  const m = Math.round(minutes % 60)
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h24 < 12 ? 'am' : 'pm'}`
}

/** Today's date in the company timezone. */
export function todayLocal(now = new Date()): string {
  return isoToLocal(now.toISOString()).date
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Have Jobber's day-before reminders already gone out for `date`?
 * They send at the cutoff on the day before; a same-day or past date is
 * always "already told".
 */
export function remindersAlreadySent(date: string, cutoffHHMM: string, now = new Date()): boolean {
  const today = todayLocal(now)
  if (date <= today) return true
  if (date !== addDays(today, 1)) return false
  return isoToLocal(now.toISOString()).minutes >= hhmmToMinutes(cutoffHHMM)
}

// ── Color + filter ──────────────────────────────────────────────────────────

export const DEFAULT_STOP_COLOR = '#64748b'

/** First matching rule wins (Jobber-style ordered list). */
export function stopColor(stop: DispatchStop, rules: ColorRule[], locked: boolean): string {
  const items = stop.lineItemNames.map(n => n.toLowerCase())
  const title = stop.title.toLowerCase()
  for (const r of rules) {
    const m = r.match.trim().toLowerCase()
    if (r.type === 'promised' && locked) return r.color
    if (r.type === 'assigned' && r.match && stop.techIds.includes(r.match)) return r.color
    if (r.type === 'line_item' && m && items.some(n => n.includes(m))) return r.color
    if (r.type === 'title' && m && title.includes(m)) return r.color
  }
  return DEFAULT_STOP_COLOR
}

export function stopMatchesGroup(stop: DispatchStop, g: FilterGroup): boolean {
  if (g.kind) return stop.kind === g.kind
  const m = g.match.trim().toLowerCase()
  return !!m && stop.lineItemNames.some(n => n.toLowerCase().includes(m))
}

/** Lane colors, one per technician, in team order. */
export const LANE_COLORS = ['#2563eb', '#ea580c', '#16a34a', '#9333ea', '#db2777', '#0d9488', '#ca8a04', '#dc2626']

// ── Saved views (Oct 20 2026) ───────────────────────────────────────────────
// Ben: "I get all the filters the way I want it, and then I hit Save View" —
// one pick switches team, filters, Day/Week/Month and the date.

export type DatePreset = 'keep' | 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'this_month' | 'next_month'

export const DATE_PRESETS: Array<{ id: DatePreset; label: string }> = [
  { id: 'keep', label: 'Keep the date I’m on' },
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'this_week', label: 'This week' },
  { id: 'next_week', label: 'Next week' },
  { id: 'this_month', label: 'This month' },
  { id: 'next_month', label: 'Next month' },
]

export interface DispatchFilters { groups: string[]; hideZero: boolean; items: string[] }

export interface DispatchViewConfig {
  team: string[]
  view: 'day' | 'week' | 'month'
  datePreset: DatePreset
  filters: DispatchFilters
  showBucket: boolean
  showTanks: boolean
}

/** The date a saved view opens on. Week presets land on that week's Monday. */
export function resolveViewDate(preset: DatePreset, today: string, current: string): string {
  const monday = (d: string) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7))
  switch (preset) {
    case 'today': return today
    case 'tomorrow': return addDays(today, 1)
    case 'this_week': return monday(today)
    case 'next_week': return addDays(monday(today), 7)
    case 'this_month': return `${today.slice(0, 7)}-01`
    case 'next_month': {
      const [y, m] = today.split('-').map(Number)
      return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
    }
    default: return current
  }
}

/** Line-item filter: with any ticked, a VISIT shows only if one of its line items is ticked.
 *  Assessments and tasks carry no line items — the Assessments / Tasks chips govern them. */
export function matchesItemFilter(stop: Pick<DispatchStop, 'lineItemNames' | 'kind'>, items: string[]): boolean {
  if (items.length === 0 || stop.kind !== 'visit') return true
  const want = new Set(items.map(i => i.trim().toLowerCase()))
  return stop.lineItemNames.some(n => want.has(n.trim().toLowerCase()))
}

export function normalizeViewConfig(raw: unknown): DispatchViewConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const f = (r.filters && typeof r.filters === 'object' ? r.filters : {}) as Record<string, unknown>
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 300) : [])
  return {
    team: strs(r.team).slice(0, 8),
    view: r.view === 'week' || r.view === 'month' ? r.view : 'day',
    datePreset: DATE_PRESETS.some(p => p.id === r.datePreset) ? (r.datePreset as DatePreset) : 'keep',
    filters: { groups: strs(f.groups), hideZero: f.hideZero === true, items: strs(f.items) },
    showBucket: r.showBucket !== false,
    showTanks: r.showTanks === true,
  }
}
