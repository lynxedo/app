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
  }
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
