import { createAdminClient } from '@/lib/supabase/admin'
import { GUARDIAN_HUB_USER_ID, fanoutGuardianNotification } from '@/lib/guardian-post'

type EntryRow = {
  id: string
  log_date: string
  office_notes: string | null
  route_sheet_url: string | null
  route_sheet_name: string | null
  completed_at: string | null
  completed_by: string | null
  company_id: string
  tech_user_id: string
  secondary_tech_user_ids: string[]
  tech: { id: string; display_name: string } | null
}

type UpdateRow = {
  id: string
  content: string
  media_urls: { key: string; name: string; type: string }[] | null
  created_at: string
  creator: { display_name: string } | null
}

export type DailyLogUpdateBroadcast = {
  update_id: string
  entry_id: string
  sender_id: string
  sender_name: string
  tech_name: string
  snippet: string
  /** Hub user IDs who are "members" of this entry — assigned tech(s),
   *  admin-configured always-notify users, and Followers. Clients use this to
   *  decide whether to light the sidebar dot / chime / raise a banner. */
  recipient_ids: string[]
}

// Fire a realtime broadcast so open Hub clients react to a new Daily Log update
// instantly (sidebar dot, chime, desktop banner) — the same pattern as
// broadcastReceiptUpdated in the read-receipts route. `daily_log_updates` is NOT
// in the Realtime publication, so postgres_changes won't deliver these; this
// company-scoped broadcast is the live signal. Fire-and-forget.
export async function broadcastDailyLogUpdate(
  companyId: string,
  payload: DailyLogUpdateBroadcast,
): Promise<void> {
  const admin = createAdminClient()
  const channel = admin.channel(`daily-log:${companyId}`)
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('subscribe timeout')), 5000)
      channel.subscribe((status) => {
        const s = String(status)
        if (s === 'SUBSCRIBED') { clearTimeout(timeout); resolve() }
        else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') { clearTimeout(timeout); reject(new Error(s)) }
      })
    })
    await channel.send({ type: 'broadcast', event: 'update-inserted', payload })
  } catch (err) {
    console.warn('[daily-log] update broadcast failed:', (err as Error).message)
  } finally {
    await admin.removeChannel(channel)
  }
}

export async function notifyDailyLogComplete(entryId: string): Promise<void> {
  const admin = createAdminClient()

  const { data: entry } = await admin
    .from('daily_log_entries')
    .select(`
      id, log_date, office_notes, route_sheet_url, route_sheet_name,
      completed_at, completed_by, company_id, tech_user_id, secondary_tech_user_ids,
      tech:hub_users!tech_user_id(id, display_name)
    `)
    .eq('id', entryId)
    .single<EntryRow>()

  if (!entry?.completed_at) return

  const { data: settings } = await admin
    .from('daily_log_settings')
    .select('completion_notify_user_ids, completion_notify_room_ids')
    .eq('company_id', entry.company_id)
    .single<{
      completion_notify_user_ids: string[]
      completion_notify_room_ids: string[]
    }>()

  const recipientUserIds = (settings?.completion_notify_user_ids ?? []).filter(
    (id) => id !== GUARDIAN_HUB_USER_ID,
  )
  const recipientRoomIds = settings?.completion_notify_room_ids ?? []
  if (recipientUserIds.length === 0 && recipientRoomIds.length === 0) return

  const { data: updates } = await admin
    .from('daily_log_updates')
    .select('id, content, media_urls, created_at, creator:hub_users!created_by(display_name)')
    .eq('entry_id', entryId)
    .order('created_at', { ascending: true })
    .returns<UpdateRow[]>()

  const secondaryNames: string[] = []
  if (entry.secondary_tech_user_ids?.length) {
    const { data: secs } = await admin
      .from('hub_users')
      .select('id, display_name')
      .in('id', entry.secondary_tech_user_ids)
    const byId = new Map<string, string>(
      (secs ?? []).map((s: { id: string; display_name: string }) => [s.id, s.display_name]),
    )
    for (const id of entry.secondary_tech_user_ids) {
      const name = byId.get(id)
      if (name) secondaryNames.push(name)
    }
  }

  let completerName = 'Someone'
  if (entry.completed_by) {
    const { data: c } = await admin
      .from('hub_users')
      .select('display_name')
      .eq('id', entry.completed_by)
      .single<{ display_name: string }>()
    if (c?.display_name) completerName = c.display_name
  }

  const body = formatBody(entry, updates ?? [], secondaryNames, completerName)

  await fanoutGuardianNotification({
    admin,
    companyId: entry.company_id,
    userIds: recipientUserIds,
    roomIds: recipientRoomIds,
    body,
  })
}

// DL1 — Daily Log v2 stop notes & photos previously notified nobody. Fire this
// after a stop note/photo is posted: it reuses the SAME recipients as the
// "Route Complete" button (daily_log_settings.completion_notify_*) and the same
// Guardian fan-out. Fire-and-forget; best-effort.
export async function notifyDailyLogStopActivity(opts: {
  stopId: string
  companyId: string
  actorUserId: string
  kind: 'note' | 'photo'
  preview: string
}): Promise<void> {
  const { stopId, companyId, actorUserId, kind, preview } = opts
  const admin = createAdminClient()

  const { data: settings } = await admin
    .from('daily_log_settings')
    .select('completion_notify_user_ids, completion_notify_room_ids')
    .eq('company_id', companyId)
    .single<{ completion_notify_user_ids: string[]; completion_notify_room_ids: string[] }>()

  const userIds = (settings?.completion_notify_user_ids ?? []).filter(
    (id) => id !== GUARDIAN_HUB_USER_ID && id !== actorUserId,
  )
  const roomIds = settings?.completion_notify_room_ids ?? []
  if (userIds.length === 0 && roomIds.length === 0) return

  const { data: stop } = await admin
    .from('daily_log_stops')
    .select('client_name, address, entry_id')
    .eq('id', stopId)
    .single<{ client_name: string | null; address: string | null; entry_id: string }>()
  const where = stop?.client_name || stop?.address || 'a stop'

  let techName = 'a tech'
  if (stop?.entry_id) {
    const { data: entry } = await admin
      .from('daily_log_entries')
      .select('tech_user_id')
      .eq('id', stop.entry_id)
      .single<{ tech_user_id: string }>()
    if (entry?.tech_user_id) {
      const { data: tech } = await admin
        .from('hub_users')
        .select('display_name')
        .eq('id', entry.tech_user_id)
        .maybeSingle<{ display_name: string }>()
      techName = tech?.display_name ?? 'a tech'
    }
  }

  const { data: actor } = await admin
    .from('hub_users')
    .select('display_name')
    .eq('id', actorUserId)
    .maybeSingle<{ display_name: string }>()
  const actorName = actor?.display_name ?? 'Someone'

  const icon = kind === 'photo' ? '📷' : '📝'
  const verb = kind === 'photo' ? 'added a photo to' : 'left a note on'
  const tail = preview ? `: ${preview.replace(/\n+/g, ' ').trim().slice(0, 200)}` : ''
  const body = `${icon} *${actorName}* ${verb} *${techName}*'s stop — ${where}${tail}`

  await fanoutGuardianNotification({ admin, companyId, userIds, roomIds, body })
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
  })
}

function formatBody(
  entry: EntryRow,
  updates: UpdateRow[],
  secondaryNames: string[],
  completerName: string,
): string {
  const techName = entry.tech?.display_name ?? 'Unknown Tech'
  const techLine =
    secondaryNames.length > 0
      ? `*Tech:* ${techName} (+ ${secondaryNames.join(', ')})`
      : `*Tech:* ${techName}`

  const lines: string[] = []
  lines.push(`✅ *Daily Log complete — ${techName} · ${formatDate(entry.log_date)}*`)
  lines.push(techLine)
  lines.push(`*Marked complete by:* ${completerName}`)
  lines.push('')

  if (entry.office_notes) {
    lines.push(`*Office notes:*`)
    lines.push(entry.office_notes)
    lines.push('')
  }

  if (entry.route_sheet_name) {
    lines.push(`*Route sheet:* ${entry.route_sheet_name}`)
    lines.push('')
  }

  lines.push(`*Updates posted today (${updates.length}):*`)
  if (updates.length === 0) {
    lines.push('_None_')
  } else {
    for (const u of updates) {
      const time = formatTime(u.created_at)
      const name = u.creator?.display_name ?? 'Unknown'
      const attachCount = u.media_urls?.length ?? 0
      let text = u.content.replace(/\n+/g, ' ').trim()
      if (!text && attachCount > 0) {
        text = attachCount === 1
          ? `📎 ${u.media_urls![0].name}`
          : `📎 ${attachCount} attachments`
      }
      lines.push(`• ${time} (${name}): ${text}`)
    }
  }

  return lines.join('\n')
}
