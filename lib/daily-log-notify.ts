import { createAdminClient } from '@/lib/supabase/admin'

const GUARDIAN_HUB_USER_ID = '00000000-0000-0000-0001-000000000001'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

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
    .select('completion_notify_user_ids')
    .eq('company_id', entry.company_id)
    .single<{ completion_notify_user_ids: string[] }>()

  const recipients = (settings?.completion_notify_user_ids ?? []).filter(
    (id) => id !== GUARDIAN_HUB_USER_ID,
  )
  if (recipients.length === 0) return

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

  for (const recipientId of recipients) {
    const conversationId = await findOrCreateDmConversation(
      admin,
      entry.company_id,
      recipientId,
    )
    if (!conversationId) continue
    const { error: msgErr } = await admin.from('messages').insert({
      company_id: entry.company_id,
      conversation_id: conversationId,
      sender_id: GUARDIAN_HUB_USER_ID,
      content: body,
    })
    if (msgErr) {
      console.error('[daily-log-notify] DM insert failed:', msgErr)
      continue
    }
    await admin
      .from('conversation_members')
      .update({ archived_at: null })
      .eq('conversation_id', conversationId)
      .not('archived_at', 'is', null)
  }
}

async function findOrCreateDmConversation(
  admin: SupabaseAdmin,
  companyId: string,
  recipientHubUserId: string,
): Promise<string | null> {
  const { data: guardianMemberships } = await admin
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', GUARDIAN_HUB_USER_ID)
  const guardianConvIds = (guardianMemberships ?? []).map(
    (m: { conversation_id: string }) => m.conversation_id,
  )

  if (guardianConvIds.length > 0) {
    const { data: candidates } = await admin
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', recipientHubUserId)
      .in('conversation_id', guardianConvIds)
    for (const cand of candidates ?? []) {
      const { count } = await admin
        .from('conversation_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('conversation_id', cand.conversation_id)
      if (count === 2) return cand.conversation_id as string
    }
  }

  const { data: conv, error } = await admin
    .from('conversations')
    .insert({ company_id: companyId })
    .select('id')
    .single()
  if (error || !conv) {
    console.error('[daily-log-notify] conversation create failed:', error)
    return null
  }
  await admin.from('conversation_members').insert([
    { conversation_id: conv.id, user_id: GUARDIAN_HUB_USER_ID },
    { conversation_id: conv.id, user_id: recipientHubUserId },
  ])
  return conv.id as string
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
