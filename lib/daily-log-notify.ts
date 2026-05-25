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
  created_at: string
  creator: { display_name: string } | null
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
    .select('id, content, created_at, creator:hub_users!created_by(display_name)')
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
      const content = u.content.replace(/\n+/g, ' ').trim()
      lines.push(`• ${time} (${name}): ${content}`)
    }
  }

  return lines.join('\n')
}
