import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendHubPush } from '@/lib/hub-push'
import { notifyDailyLogComplete, broadcastDailyLogUpdate } from '@/lib/daily-log-notify'
import { GUARDIAN_HUB_USER_ID } from '@/lib/guardian-post'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { entryId } = await params
  const body = await request.json()
  const content: string = body.content?.trim() ?? ''
  const mediaUrls: { key: string; name: string; type: string }[] = body.media_urls ?? []

  if (!content && mediaUrls.length === 0) {
    return NextResponse.json({ error: 'content or attachments required' }, { status: 400 })
  }

  const { data: update, error } = await supabase
    .from('daily_log_updates')
    .insert({
      entry_id: entryId,
      company_id: profile.company_id,
      content,
      media_urls: mediaUrls,
      created_by: user.id,
    })
    .select('id, content, media_urls, created_at, created_by, creator:hub_users!created_by(id, display_name, avatar_url)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Build the recipient set for this update. "Members" of a Daily Log entry =
  // the assigned tech(s) ALWAYS + the company's admin-configured always-notify
  // users ALWAYS + anyone who tapped Follow (daily_log_subscribers). The poster
  // and the @Guardian bot are always excluded. This audience drives push, the
  // sidebar/rail unread dot, the desktop chime, and the desktop banner — exactly
  // like a DM/Room (you get a signal only for things you're part of).
  const admin = createAdminClient()
  const [subscribersResult, senderResult, entryResult, settingsResult] = await Promise.all([
    admin
      .from('daily_log_subscribers')
      .select('user_id')
      .eq('entry_id', entryId),
    admin
      .from('hub_users')
      .select('display_name')
      .eq('id', user.id)
      .single(),
    admin
      .from('daily_log_entries')
      .select('completed_at, tech_user_id, secondary_tech_user_ids, tech:hub_users!tech_user_id(display_name)')
      .eq('id', entryId)
      .single(),
    admin
      .from('daily_log_settings')
      .select('update_notify_user_ids')
      .eq('company_id', profile.company_id)
      .maybeSingle(),
  ])

  const entryRow = entryResult.data as {
    completed_at: string | null
    tech_user_id: string | null
    secondary_tech_user_ids: string[] | null
    tech: { display_name: string } | { display_name: string }[] | null
  } | null

  const memberSet = new Set<string>()
  for (const s of (subscribersResult.data ?? []) as { user_id: string }[]) {
    if (s.user_id) memberSet.add(s.user_id)
  }
  if (entryRow?.tech_user_id) memberSet.add(entryRow.tech_user_id)
  for (const id of (entryRow?.secondary_tech_user_ids ?? [])) {
    if (id) memberSet.add(id)
  }
  for (const id of ((settingsResult.data?.update_notify_user_ids ?? []) as string[])) {
    if (id) memberSet.add(id)
  }
  // Never notify the poster or the bot.
  memberSet.delete(user.id)
  memberSet.delete(GUARDIAN_HUB_USER_ID)
  const recipientIds = [...memberSet]

  const senderName = senderResult.data?.display_name ?? 'Someone'
  const techRaw = entryRow?.tech
  const techName = (Array.isArray(techRaw) ? techRaw[0] : techRaw)?.display_name ?? 'a tech'

  let snippet: string
  if (content) {
    snippet = content.length > 100 ? content.slice(0, 97) + '…' : content
  } else {
    snippet = mediaUrls.length === 1
      ? `📎 ${mediaUrls[0].name}`
      : `📎 ${mediaUrls.length} attachments`
  }

  if (recipientIds.length > 0) {
    // Push (Web Push / APNs / FCM). sendHubPush applies each user's own
    // mute/DND — so a muted user gets no push but still sees the unread dot,
    // exactly like a Room. url drives tap-to-open → /hub/daily-log.
    await sendHubPush(
      recipientIds,
      {
        title: `📋 Daily Log — ${techName}`,
        body: `${senderName}: ${snippet}`,
        url: '/hub/daily-log',
        type: 'daily-log',
        groupKey: entryId,
      },
      { isDm: true }
    )
  }

  // Live signal for open Hub tabs — fired ALWAYS (even with no push recipients)
  // so anyone currently *viewing* the Daily Log sees the new update appear without
  // refreshing. Recipient-scoped consumers (sidebar/rail dot, chime, desktop
  // banner) self-filter on `recipient_ids`; the in-view refresh ignores it.
  after(() => broadcastDailyLogUpdate(profile.company_id, {
    update_id: update.id,
    entry_id: entryId,
    sender_id: user.id,
    sender_name: senderName,
    tech_name: techName,
    snippet,
    recipient_ids: recipientIds,
  }))

  if (entryRow?.completed_at) {
    after(() => notifyDailyLogComplete(entryId).catch((err) =>
      console.error('[daily-log] re-notify on update failed:', err),
    ))
  }

  return NextResponse.json(update, { status: 201 })
}
