import { createAdminClient } from '@/lib/supabase/admin'
import { postGuardianToUserDm, postGuardianToRoom } from '@/lib/guardian-post'
import { sendHubPush } from '@/lib/hub-push'
import { sendSms, toE164 } from '@/lib/twilio'
import { resolveFromNumber } from '@/lib/txt-numbers'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

export type RecipientType =
  | 'fixed_user'
  | 'room'
  | 'assigned_tech'
  | 'condition_matches'
  | 'created_by'
  | 'event_actor'
  | 'phone_number'

export type DeliverVia = 'guardian' | 'sms' | 'both'

export type EventSource = 'daily_log_stop_complete' | 'txt_inbound' | 'clock_event'

export type ScheduleConfig = {
  time?: string // "HH:MM" 24h
  days?: number[] // 0=Sun .. 6=Sat; empty/undefined = every day
  tz?: string // IANA tz, default America/Chicago
}

export type GeofenceTriggerConfig = {
  device_id?: string | null
  geofence_id?: string
  direction?: 'enter' | 'leave'
  window_start?: string | null
  window_end?: string | null
  tz?: string
}

export type TriggerConfig = ScheduleConfig &
  GeofenceTriggerConfig & {
    target_phone?: string | null // for phone_number recipient
    event?: string | null // clock_event: 'in' | 'out' | 'any'
    keyword?: string | null // txt_inbound: only when body contains this
  }

export type ConditionConfig = {
  type?: 'still_clocked_in' | null
}

export type AutomationRule = {
  id: string
  company_id: string
  name: string | null
  trigger_source: string
  trigger_config: TriggerConfig
  condition_config: ConditionConfig
  recipient_type: RecipientType
  deliver_via: DeliverVia
  target_user_id: string | null
  target_room_id: string | null
  message_template: string
  active: boolean
  created_by: string
  last_fired_at: string | null
}

const DEFAULT_TZ = 'America/Chicago'

// ── Time helpers ───────────────────────────────────────────────────────────

export function nowInTz(tz: string): { hhmm: string; dow: number; ymd: string } {
  const d = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit',
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const hhmm = `${get('hour')}:${get('minute')}`
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const dow = dowMap[get('weekday')] ?? 0
  const ymd = `${get('year')}-${get('month')}-${get('day')}`
  return { hhmm, dow, ymd }
}

export function scheduleDue(cfg: ScheduleConfig, lastFiredAt: string | null): boolean {
  const tz = cfg.tz || DEFAULT_TZ
  if (!cfg.time) return false
  const { hhmm, dow } = nowInTz(tz)
  if (hhmm !== cfg.time) return false
  if (cfg.days && cfg.days.length > 0 && !cfg.days.includes(dow)) return false
  if (lastFiredAt && Date.now() - new Date(lastFiredAt).getTime() < 60_000) return false
  return true
}

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

export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000
  const toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// ── Conditions ───────────────────────────────────────────────────────────

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

  const latest = new Map<string, string>()
  for (const p of (data ?? []) as { employee_id: string; punch_type: string }[]) {
    latest.set(p.employee_id, p.punch_type)
  }
  const empIds = [...latest.entries()].filter(([, t]) => t === 'in').map(([id]) => id)
  if (empIds.length === 0) return []

  // employee_id → hub user id (employees.user_id)
  const { data: emps } = await admin
    .from('employees')
    .select('id, user_id')
    .in('id', empIds)
  return (emps ?? [])
    .map((e: { user_id: string | null }) => e.user_id)
    .filter((id): id is string => !!id)
}

// ── Recipient resolution helpers ─────────────────────────────────────────

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

async function getUserPhones(
  admin: SupabaseAdmin,
  userIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (userIds.length === 0) return out
  const { data } = await admin
    .from('user_profiles')
    .select('id, phone')
    .in('id', userIds)
  for (const r of (data ?? []) as { id: string; phone: string | null }[]) {
    if (r.phone) out.set(r.id, r.phone)
  }
  return out
}

async function isDoNotText(
  admin: SupabaseAdmin,
  companyId: string,
  e164: string,
): Promise<boolean> {
  const { data } = await admin
    .from('txt_contacts')
    .select('do_not_text')
    .eq('company_id', companyId)
    .eq('phone', e164)
    .limit(1)
  return !!(data && data.length > 0 && data[0].do_not_text)
}

export async function userDisplayNames(
  admin: SupabaseAdmin,
  userIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (userIds.length === 0) return out
  const { data } = await admin.from('hub_users').select('id, display_name').in('id', userIds)
  for (const r of (data ?? []) as { id: string; display_name: string | null }[]) {
    out.set(r.id, r.display_name ?? '')
  }
  return out
}

// ── Templating ─────────────────────────────────────────────────────────────

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key) => (key in vars ? vars[key] : `{${key}}`))
}

// ── Deliver ──────────────────────────────────────────────────────────────

/**
 * Deliver an automation message to resolved recipients via Guardian DM/room,
 * SMS text, or both — then log one run. Per-recipient body so {tech_name} etc.
 * can be personalized by the caller.
 */
export async function deliver(args: {
  admin: SupabaseAdmin
  companyId: string
  ruleId: string
  ruleName?: string | null
  source: string
  deliverVia: DeliverVia
  userTargets: { userId: string; body: string }[]
  roomTargets?: { roomId: string; body: string }[]
  phoneTargets?: { phone: string; body: string }[]
  detail?: Record<string, unknown>
}): Promise<void> {
  const { admin, companyId, ruleId, source } = args
  const deliverVia: DeliverVia = args.deliverVia || 'guardian'
  const userTargets = args.userTargets.filter((t) => t.userId && t.body)
  const roomTargets = (args.roomTargets ?? []).filter((t) => t.roomId && t.body)
  const phoneTargets = (args.phoneTargets ?? []).filter((t) => t.phone && t.body)
  if (userTargets.length === 0 && roomTargets.length === 0 && phoneTargets.length === 0) return

  const wantGuardian = deliverVia === 'guardian' || deliverVia === 'both'
  const wantSms = deliverVia === 'sms' || deliverVia === 'both'

  // Guardian DM/room + phone push
  if (wantGuardian) {
    for (const t of userTargets) {
      await postGuardianToUserDm(companyId, t.userId, t.body, { admin })
      await sendHubPush(
        [t.userId],
        { title: args.ruleName ? `Guardian · ${args.ruleName}` : 'Guardian', body: t.body.slice(0, 180), url: '/hub' },
        { isDm: true },
      )
    }
    for (const t of roomTargets) {
      await postGuardianToRoom(t.roomId, t.body, { admin })
    }
  }

  // SMS texts
  if (wantSms && (userTargets.length > 0 || phoneTargets.length > 0)) {
    const fromNumber = (await resolveFromNumber(admin, { companyId })) ?? undefined
    const smsJobs: { phone: string; body: string }[] = [...phoneTargets]
    if (userTargets.length > 0) {
      const phones = await getUserPhones(admin, userTargets.map((t) => t.userId))
      for (const t of userTargets) {
        const p = phones.get(t.userId)
        if (p) smsJobs.push({ phone: p, body: t.body })
      }
    }
    for (const job of smsJobs) {
      const e164 = toE164(job.phone)
      if (!e164) continue
      if (await isDoNotText(admin, companyId, e164)) continue
      await sendSms({ to: e164, body: job.body, fromNumber })
    }
  }

  await admin.from('hub_automation_runs').insert({
    company_id: companyId,
    rule_id: ruleId,
    trigger_source: source,
    recipient_user_ids: userTargets.map((t) => t.userId),
    detail: args.detail ?? {},
  })
}

// ── Event-source evaluation (Phase 3) ───────────────────────────────────────

/**
 * Fire matching automations for an app event (clock in/out, daily-log stop
 * completed, inbound text). Best-effort, never throws into the caller.
 *
 * `vars` already contains the rendered context (tech_name = the actor's name,
 * customer, address, vehicle, from, message, event, time, date). `filter`
 * carries raw facts used to gate rules (clock event direction, inbound keyword).
 */
export async function evaluateEventAutomations(args: {
  companyId: string
  source: EventSource
  actorUserId?: string | null
  vars: Record<string, string>
  filter?: { event?: string; keyword?: string }
}): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data: rules } = await admin
      .from('hub_automation_rules')
      .select(
        'id, company_id, name, trigger_source, trigger_config, condition_config, recipient_type, deliver_via, target_user_id, target_room_id, message_template, active, created_by, last_fired_at',
      )
      .eq('company_id', args.companyId)
      .eq('trigger_source', args.source)
      .eq('active', true)

    for (const r of (rules ?? []) as AutomationRule[]) {
      const cfg = r.trigger_config ?? {}

      // Filters
      if (args.source === 'clock_event') {
        const want = cfg.event || 'any'
        if (want !== 'any' && want !== args.filter?.event) continue
      }
      if (args.source === 'txt_inbound' && cfg.keyword) {
        const msg = (args.filter?.keyword ?? args.vars.message ?? '').toLowerCase()
        if (!msg.includes(cfg.keyword.toLowerCase())) continue
      }

      const body = renderTemplate(r.message_template, args.vars)
      const userTargets: { userId: string; body: string }[] = []
      const roomTargets: { roomId: string; body: string }[] = []
      const phoneTargets: { phone: string; body: string }[] = []

      switch (r.recipient_type) {
        case 'event_actor':
          if (args.actorUserId) userTargets.push({ userId: args.actorUserId, body })
          break
        case 'fixed_user':
          if (r.target_user_id) userTargets.push({ userId: r.target_user_id, body })
          break
        case 'created_by':
          userTargets.push({ userId: r.created_by, body })
          break
        case 'room':
          if (r.target_room_id) roomTargets.push({ roomId: r.target_room_id, body })
          break
        case 'phone_number':
          if (cfg.target_phone) phoneTargets.push({ phone: cfg.target_phone, body })
          break
      }

      await deliver({
        admin,
        companyId: r.company_id,
        ruleId: r.id,
        ruleName: r.name,
        source: r.trigger_source,
        deliverVia: r.deliver_via || 'guardian',
        userTargets,
        roomTargets,
        phoneTargets,
        detail: { ...args.vars },
      })
    }
  } catch (e) {
    console.error('[automations] event eval failed:', args.source, e)
  }
}
