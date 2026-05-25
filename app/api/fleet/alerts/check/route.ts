import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFleetDevices, type FleetDevice } from '@/lib/onestepgps'
import { fanoutGuardianNotification } from '@/lib/guardian-post'

export const dynamic = 'force-dynamic'

type AlertType = 'speeding' | 'after_hours' | 'low_fuel' | 'offline'

type FleetSettingsRow = {
  company_id: string
  alert_speeding: boolean
  alert_after_hours: boolean
  alert_low_fuel: boolean
  alert_offline: boolean
  speed_threshold_mph: number
  fuel_threshold_pct: number
  offline_timeout_min: number
  work_hours_start: string
  work_hours_end: string
  work_tz: string
  alert_recipient_user_ids: string[]
  alert_recipient_room_ids: string[]
}

type SupabaseAdmin = ReturnType<typeof createAdminClient>

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  const { data: settingsRows, error: settingsErr } = await admin
    .from('fleet_settings')
    .select('*')
  if (settingsErr) {
    return NextResponse.json({ error: settingsErr.message }, { status: 500 })
  }

  let opened = 0
  let resolved = 0
  let ticked = 0

  for (const settings of (settingsRows ?? []) as FleetSettingsRow[]) {
    let devices: FleetDevice[]
    try {
      devices = await getFleetDevices()
    } catch (err) {
      console.error('[fleet-alerts] OneStepGPS fetch failed:', err)
      continue
    }

    const { data: openEvents } = await admin
      .from('fleet_alert_events')
      .select('id, device_id, alert_type, started_at')
      .eq('company_id', settings.company_id)
      .is('resolved_at', null)

    const openMap = new Map<string, { id: string; started_at: string }>()
    for (const e of openEvents ?? []) {
      openMap.set(`${e.device_id}:${e.alert_type}`, {
        id: e.id as string,
        started_at: e.started_at as string,
      })
    }

    const seen = new Set<string>()
    const nowIso = new Date().toISOString()

    for (const dev of devices) {
      const checks = buildChecks(dev, settings)
      for (const c of checks) {
        if (!c.enabled) continue
        const key = `${dev.id}:${c.type}`
        const existing = openMap.get(key)

        if (c.condition) {
          seen.add(key)
          if (existing) {
            await admin
              .from('fleet_alert_events')
              .update({ last_seen_at: nowIso, payload: c.payload })
              .eq('id', existing.id)
            ticked++
          } else {
            const { error: insErr } = await admin
              .from('fleet_alert_events')
              .insert({
                company_id: settings.company_id,
                device_id: dev.id,
                device_name: dev.name,
                alert_type: c.type,
                payload: c.payload,
              })
            if (insErr) {
              console.error('[fleet-alerts] insert failed:', insErr)
              continue
            }
            opened++
            await sendAlertNotifications(admin, settings, dev, c.type, c.payload)
          }
        }
      }
    }

    for (const [key, ev] of openMap.entries()) {
      if (!seen.has(key)) {
        await admin
          .from('fleet_alert_events')
          .update({ resolved_at: nowIso })
          .eq('id', ev.id)
        resolved++
      }
    }
  }

  return NextResponse.json({ ok: true, opened, resolved, ticked })
}

type Check = {
  type: AlertType
  enabled: boolean
  condition: boolean
  payload: Record<string, unknown>
}

function buildChecks(dev: FleetDevice, settings: FleetSettingsRow): Check[] {
  return [
    {
      type: 'speeding',
      enabled: settings.alert_speeding,
      condition:
        dev.drive_status === 'driving' &&
        dev.speed_mph > settings.speed_threshold_mph,
      payload: {
        speed_mph: dev.speed_mph,
        limit_mph: settings.speed_threshold_mph,
        lat: dev.lat,
        lng: dev.lng,
      },
    },
    {
      type: 'after_hours',
      enabled: settings.alert_after_hours,
      condition: dev.drive_status === 'driving' && isAfterHours(settings),
      payload: {
        lat: dev.lat,
        lng: dev.lng,
        work_hours: `${settings.work_hours_start}-${settings.work_hours_end} ${settings.work_tz}`,
      },
    },
    {
      type: 'low_fuel',
      enabled: settings.alert_low_fuel,
      condition:
        dev.fuel_pct !== null && dev.fuel_pct < settings.fuel_threshold_pct,
      payload: {
        fuel_pct: dev.fuel_pct,
        threshold_pct: settings.fuel_threshold_pct,
      },
    },
    {
      type: 'offline',
      enabled: settings.alert_offline,
      condition: isOffline(dev, settings),
      payload: {
        last_ping: dev.last_ping,
        threshold_min: settings.offline_timeout_min,
      },
    },
  ]
}

function currentTimeInTz(tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = fmt.formatToParts(new Date())
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00'
  return `${h}:${m}:00`
}

function isAfterHours(settings: FleetSettingsRow): boolean {
  const cur = currentTimeInTz(settings.work_tz)
  return cur < settings.work_hours_start || cur > settings.work_hours_end
}

function isOffline(dev: FleetDevice, settings: FleetSettingsRow): boolean {
  const lastMs = Date.parse(dev.last_ping)
  if (!Number.isFinite(lastMs)) return false
  const elapsedMin = (Date.now() - lastMs) / 60000
  if (elapsedMin < settings.offline_timeout_min) return false
  const cur = currentTimeInTz(settings.work_tz)
  const inWorkHours =
    cur >= settings.work_hours_start && cur <= settings.work_hours_end
  return inWorkHours
}

async function sendAlertNotifications(
  admin: SupabaseAdmin,
  settings: FleetSettingsRow,
  dev: FleetDevice,
  type: AlertType,
  payload: Record<string, unknown>,
) {
  const content = formatAlertBody(dev, type, payload)
  await fanoutGuardianNotification({
    admin,
    companyId: settings.company_id,
    userIds: settings.alert_recipient_user_ids ?? [],
    roomIds: settings.alert_recipient_room_ids ?? [],
    body: content,
  })
}

function formatAlertBody(
  dev: FleetDevice,
  type: AlertType,
  payload: Record<string, unknown>,
): string {
  const mapsUrl = `https://maps.google.com/?q=${dev.lat},${dev.lng}`
  const loc = `${dev.lat.toFixed(4)}, ${dev.lng.toFixed(4)}`
  switch (type) {
    case 'speeding':
      return `🚨 *Speeding alert — ${dev.name}*\nSpeed: ${payload.speed_mph} mph (limit ${payload.limit_mph})\nLocation: ${loc} — ${mapsUrl}`
    case 'after_hours':
      return `🌙 *After-hours movement — ${dev.name}*\nVehicle is driving outside work hours (${payload.work_hours}).\nLocation: ${loc} — ${mapsUrl}`
    case 'low_fuel':
      return `⛽ *Low fuel — ${dev.name}*\nFuel: ${payload.fuel_pct}% (threshold ${payload.threshold_pct}%)`
    case 'offline':
      return `📡 *Vehicle offline — ${dev.name}*\nLast ping: ${payload.last_ping}\nThreshold: ${payload.threshold_min} min`
  }
}
