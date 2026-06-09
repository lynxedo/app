import { createAdminClient } from '@/lib/supabase/admin'
import { fanoutGuardianNotification } from '@/lib/guardian-post'
import { sendHubPush } from '@/lib/hub-push'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

export type RecipientType =
  | 'fixed_user'
  | 'room'
  | 'assigned_tech'
  | 'condition_matches'
  | 'created_by'

export type ScheduleConfig = {
  time?: string // "HH:MM" 24h
  days?: number[] // 0=Sun .. 6=Sat; empty/undefined = every day
  tz?: string // IANA tz, default America/Chicago
}

export type GeofenceTriggerConfig = {
  device_id?: string | null // null/'' = any vehicle
  geofence_id?: string
  direction?: 'enter' | 'leave'
  window_start?: string | null // "HH:MM"
  window_end?: string | null
  tz?: string
}

export type ConditionConfig = {
  type?: 'still_clocked_in' | null
}

export type AutomationRule = {
  id: string
  company_id: string
  name: string | null
  trigger_source: string
  trigger_config: ScheduleConfig & GeofenceTriggerConfig
  condition_config: ConditionConfig
  recipient_type: RecipientType
  target_user_id: string | null
  target_room_id: string | null
  message_template: string
  active: boolean
  created_by: string
  last_fired_at: string | null
}

const DEFAULT_TZ = 'America/Chicago'

// ── Time helpers ───────────────────────────────────────────────────────────

/** Current { hhmm: "HH:MM", dow: 0-6, ymd: "YYYY-MM-DD" } in the given tz. */
export function nowInTz(tz: string): { hhmm: string; dow: number; ymd: string } {
  const d = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const hhmm = `${get('hour')}:${get('minute')}`
  const dowMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  const dow = dowMap[get('weekday')] ?? 0
  const ymd = `${get('year')}-${get('month')}-${get('day')}`
  return { hhmm, dow, ymd }
}

/** True if a schedule rule should fire this minute (and hasn't already fired this minute). */
export function scheduleDue(
  cfg: ScheduleConfig,
  lastFiredAt: string | null,
): boolean {
  const tz = cfg.tz || DEFAULT_TZ
  if (!cfg.time) return false
  const { hhmm, dow } = nowInTz(tz)
  if (hhmm !== cfg.time) return false
  if (cfg.days && cfg.days.length > 0 && !cfg.days.includes(dow)) return false
  // De-dupe: don't fire twice within the same clock-minute
  if (lastFiredAt) {
    const last = new Date(lastFiredAt)
    if (Date.now() - last.getTime() < 60_000) return false
  }
  return true
}

/** True if "now" (in tz) falls within [start, end] inclusive. No window = always true. */
export function withinWindow(
  start: string | null | undefined,
  end: string | null | undefined,
  tz: string,
): boolean {
  if (!start || !end) return true
  const { hhmm } = nowInTz(tz)
  return hhmm >= start && hhmm <= end
}

// ── Geofence ─────────────────────────────────────────────────────────────

export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371000
  const toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// ── Conditions ───────────────────────────────────────────────────────────

/**
 * Users whose most-recent time punch today is "in" (i.e. still clocked in).
 * time_punches: { employee_id, punch_type 'in'|'out', punched_at, company_id }.
 * employee_id maps 1:1 onto hub_users.id.
 */
export async function stillClockedInUserIds(
  admin: SupabaseAdmin,
  companyId: string,
): Promise<string[]> {
  const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString()
  const { data } = await admin
    .from('time_punches')
    .select('employee_id, punch_type, punched_at')
    .eq('company_id', companyId)
    .gte('punched_at', since)
    .order('punched_at', { ascending: true })

  const latest = new Map<string, string>() // employee_id -> last punch_type
  for (const p of (data ?? []) as { employee_id: string; punch_type: string }[]) {
    latest.set(p.employee_id, p.punch_type)
  }
  return [...latest.entries()].filter(([, t]) => t === 'in').map(([id]) => id)
}

// ── Recipient resolution ─────────────────────────────────────────────────

/** Resolve the assigned technician for a vehicle on a given date (dated row wins over standing default). */
export async function assignedTechForDevice(
  admin: SupabaseAdmin,
  companyId: string,
  deviceId: string,
  ymd: string,
): Promise<string | null> {
  const { data: dated } = await admin
    .from('hub_vehicle_assignments')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('device_id', deviceId)
    .eq('effective_date', ymd)
    .limit(1)
  if (dated && dated.length > 0 && dated[0].user_id) return dated[0].user_id as string

  const { data: def } = await admin
    .from('hub_vehicle_assignments')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('device_id', deviceId)
    .is('effective_date', null)
    .limit(1)
  if (def && def.length > 0 && def[0].user_id) return def[0].user_id as string
  return null
}

// ── Templating ─────────────────────────────────────────────────────────────

export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (_m, key) =>
    key in vars ? vars[key] : `{${key}}`,
  )
}

// ── Fire ─────────────────────────────────────────────────────────────────

/**
 * Send one automation message to a set of DM users and/or rooms, push to phones,
 * and log a run. Reuses the proven Fleet-alert fan-out, then adds an explicit
 * sendHubPush so the recipient's phone actually buzzes (guardian-post alone does not push).
 */
export async function fireAutomation(args: {
  admin: SupabaseAdmin
  companyId: string
  ruleId: string
  source: string
  dmUserIds: string[]
  roomIds: string[]
  body: string
  ruleName?: string | null
  detail?: Record<string, unknown>
}): Promise<void> {
  const { admin, companyId, ruleId, source, body } = args
  const dmUserIds = [...new Set(args.dmUserIds)].filter(Boolean)
  const roomIds = [...new Set(args.roomIds)].filter(Boolean)
  if (dmUserIds.length === 0 && roomIds.length === 0) return

  await fanoutGuardianNotification({ admin, companyId, userIds: dmUserIds, roomIds, body })

  if (dmUserIds.length > 0) {
    const title = args.ruleName ? `Guardian · ${args.ruleName}` : 'Guardian'
    await sendHubPush(
      dmUserIds,
      { title, body: body.slice(0, 180), url: '/hub' },
      { isDm: true },
    )
  }

  await admin.from('hub_automation_runs').insert({
    company_id: companyId,
    rule_id: ruleId,
    trigger_source: source,
    recipient_user_ids: dmUserIds,
    detail: args.detail ?? {},
  })
}
