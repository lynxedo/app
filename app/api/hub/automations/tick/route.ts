import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFleetDevices, type FleetDevice } from '@/lib/onestepgps'
import {
  type AutomationRule,
  nowInTz,
  scheduleDue,
  withinWindow,
  haversineMeters,
  stillClockedInUserIds,
  assignedTechForDevice,
  userDisplayNames,
  renderTemplate,
  deliver,
} from '@/lib/automations'

export const dynamic = 'force-dynamic'

type SupabaseAdmin = ReturnType<typeof createAdminClient>
const DEFAULT_TZ = 'America/Chicago'

const RULE_SELECT =
  'id, company_id, name, trigger_source, trigger_config, condition_config, recipient_type, deliver_via, target_user_id, target_room_id, message_template, active, created_by, last_fired_at'

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  const { data: ruleRows, error } = await admin
    .from('hub_automation_rules')
    .select(RULE_SELECT)
    .eq('active', true)
    .in('trigger_source', ['schedule', 'fleet_geofence'])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rules = (ruleRows ?? []) as AutomationRule[]
  let scheduleFired = 0
  let geofenceFired = 0

  // ── Schedule rules ──────────────────────────────────────────────────────
  for (const rule of rules.filter((r) => r.trigger_source === 'schedule')) {
    try {
      if (!scheduleDue(rule.trigger_config ?? {}, rule.last_fired_at)) continue
      const fired = await runScheduleRule(admin, rule)
      if (fired) {
        scheduleFired++
        await admin
          .from('hub_automation_rules')
          .update({ last_fired_at: new Date().toISOString() })
          .eq('id', rule.id)
      } else {
        // Mark the minute as evaluated so we don't re-check every second within it.
        await admin
          .from('hub_automation_rules')
          .update({ last_fired_at: new Date().toISOString() })
          .eq('id', rule.id)
      }
    } catch (e) {
      console.error('[automations] schedule rule failed:', rule.id, e)
    }
  }

  // ── Geofence rules ──────────────────────────────────────────────────────
  const geoRules = rules.filter((r) => r.trigger_source === 'fleet_geofence')
  if (geoRules.length > 0) {
    let devices: FleetDevice[] = []
    try {
      devices = await getFleetDevices()
    } catch (e) {
      console.error('[automations] OneStepGPS fetch failed:', e)
    }
    if (devices.length > 0) {
      for (const rule of geoRules) {
        try {
          geofenceFired += await runGeofenceRule(admin, rule, devices)
        } catch (e) {
          console.error('[automations] geofence rule failed:', rule.id, e)
        }
      }
    }
  }

  return NextResponse.json({ ok: true, scheduleFired, geofenceFired })
}

// ── Schedule ────────────────────────────────────────────────────────────────

async function runScheduleRule(
  admin: SupabaseAdmin,
  rule: AutomationRule,
): Promise<boolean> {
  const tz = rule.trigger_config?.tz || DEFAULT_TZ
  const { hhmm, ymd } = nowInTz(tz)
  const baseVars: Record<string, string> = { time: hhmm, date: ymd }

  // Condition gate
  let conditionUsers: string[] | null = null
  if (rule.condition_config?.type === 'still_clocked_in') {
    conditionUsers = await stillClockedInUserIds(admin, rule.company_id)
    if (conditionUsers.length === 0 && rule.recipient_type === 'condition_matches') {
      return false // nobody matched — nothing to do
    }
  }

  return dispatch(admin, rule, { baseVars, conditionUsers, deviceId: null, ymd })
}

// ── Geofence ──────────────────────────────────────────────────────────────

async function runGeofenceRule(
  admin: SupabaseAdmin,
  rule: AutomationRule,
  devices: FleetDevice[],
): Promise<number> {
  const cfg = rule.trigger_config ?? {}
  if (!cfg.geofence_id) return 0

  const { data: fence } = await admin
    .from('hub_geofences')
    .select('id, name, lat, lng, radius_m')
    .eq('id', cfg.geofence_id)
    .eq('company_id', rule.company_id)
    .single()
  if (!fence) return 0

  const tz = cfg.tz || DEFAULT_TZ
  const { ymd } = nowInTz(tz)
  const direction = cfg.direction === 'leave' ? 'leave' : 'enter'
  const wantDeviceId = cfg.device_id || null

  let fired = 0
  for (const dev of devices) {
    if (wantDeviceId && dev.id !== wantDeviceId) continue

    const dist = haversineMeters(dev.lat, dev.lng, fence.lat as number, fence.lng as number)
    const inside = dist <= (fence.radius_m as number)

    // Prior state for this (rule, device)
    const { data: stateRow } = await admin
      .from('hub_automation_geofence_state')
      .select('inside')
      .eq('rule_id', rule.id)
      .eq('device_id', dev.id)
      .maybeSingle()
    const wasInside = stateRow?.inside ?? false

    // Persist current state
    await admin
      .from('hub_automation_geofence_state')
      .upsert(
        { rule_id: rule.id, device_id: dev.id, inside, updated_at: new Date().toISOString() },
        { onConflict: 'rule_id,device_id' },
      )

    const transitioned =
      (direction === 'enter' && !wasInside && inside) ||
      (direction === 'leave' && wasInside && !inside)
    if (!transitioned) continue
    if (!withinWindow(cfg.window_start, cfg.window_end, tz)) continue

    const baseVars: Record<string, string> = {
      vehicle: dev.name,
      geofence: (fence.name as string) ?? '',
      time: nowInTz(tz).hhmm,
      date: ymd,
    }
    const did = await dispatch(admin, rule, {
      baseVars,
      conditionUsers: null,
      deviceId: dev.id,
      ymd,
    })
    if (did) fired++
  }
  return fired
}

// ── Shared dispatch: resolve recipients, render, fire ───────────────────────

async function dispatch(
  admin: SupabaseAdmin,
  rule: AutomationRule,
  ctx: {
    baseVars: Record<string, string>
    conditionUsers: string[] | null
    deviceId: string | null
    ymd: string
  },
): Promise<boolean> {
  const { baseVars, conditionUsers, deviceId, ymd } = ctx
  const deliverVia = rule.deliver_via || 'guardian'

  // Room target — single post, no per-user personalization.
  if (rule.recipient_type === 'room') {
    if (!rule.target_room_id) return false
    const body = renderTemplate(rule.message_template, { ...baseVars, tech_name: '' })
    await deliver({
      admin, companyId: rule.company_id, ruleId: rule.id, ruleName: rule.name,
      source: rule.trigger_source, deliverVia,
      userTargets: [], roomTargets: [{ roomId: rule.target_room_id, body }],
      detail: { ...baseVars },
    })
    return true
  }

  // Fixed external phone number (text only).
  if (rule.recipient_type === 'phone_number') {
    const phone = rule.trigger_config?.target_phone
    if (!phone) return false
    const body = renderTemplate(rule.message_template, { ...baseVars, tech_name: '' })
    await deliver({
      admin, companyId: rule.company_id, ruleId: rule.id, ruleName: rule.name,
      source: rule.trigger_source, deliverVia: 'sms',
      userTargets: [], phoneTargets: [{ phone, body }],
      detail: { ...baseVars },
    })
    return true
  }

  // Resolve the recipient user id(s)
  let userIds: string[] = []
  switch (rule.recipient_type) {
    case 'fixed_user':
      if (rule.target_user_id) userIds = [rule.target_user_id]
      break
    case 'created_by':
      userIds = [rule.created_by]
      break
    case 'assigned_tech': {
      if (!deviceId) break
      const tech = await assignedTechForDevice(admin, rule.company_id, deviceId, ymd)
      if (tech) userIds = [tech]
      break
    }
    case 'condition_matches':
      userIds = conditionUsers ?? []
      break
  }
  userIds = [...new Set(userIds)].filter(Boolean)
  if (userIds.length === 0) return false

  // Per-user personalization ({tech_name})
  const names = await userDisplayNames(admin, userIds)
  const userTargets = userIds.map((uid) => ({
    userId: uid,
    body: renderTemplate(rule.message_template, { ...baseVars, tech_name: names.get(uid) ?? '' }),
  }))

  await deliver({
    admin, companyId: rule.company_id, ruleId: rule.id, ruleName: rule.name,
    source: rule.trigger_source, deliverVia,
    userTargets,
    detail: { ...baseVars },
  })
  return true
}
