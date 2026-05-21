import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendHubPush } from '@/lib/hub-push'
import { notifyDailyLogComplete } from '@/lib/daily-log-notify'

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
  const { content } = await request.json()
  if (!content?.trim()) return NextResponse.json({ error: 'content required' }, { status: 400 })

  const { data: update, error } = await supabase
    .from('daily_log_updates')
    .insert({
      entry_id: entryId,
      company_id: profile.company_id,
      content: content.trim(),
      created_by: user.id,
    })
    .select('id, content, created_at, created_by, creator:hub_users!created_by(id, display_name, avatar_url)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fire push to all subscribers except the poster
  const admin = createAdminClient()
  const [subscribersResult, senderResult, entryResult] = await Promise.all([
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
      .select('completed_at, tech:hub_users!tech_user_id(display_name)')
      .eq('id', entryId)
      .single(),
  ])

  const subscriberIds = (subscribersResult.data ?? [])
    .map((s: { user_id: string }) => s.user_id)
    .filter((id: string) => id !== user.id) // don't notify the poster

  if (subscriberIds.length > 0) {
    const senderName = senderResult.data?.display_name ?? 'Someone'
    const techRaw = entryResult.data?.tech
    const techName = (Array.isArray(techRaw) ? techRaw[0] : techRaw)?.display_name ?? 'a tech'
    const snippet = content.trim().length > 100
      ? content.trim().slice(0, 97) + '…'
      : content.trim()

    await sendHubPush(
      subscriberIds,
      {
        title: `${senderName} — Daily Log (${techName})`,
        body: snippet,
        url: '/hub/daily-log',
      },
      { isDm: true }
    )
  }

  // If the entry is already complete, re-fire the completion DM with the latest update list
  if (entryResult.data?.completed_at) {
    notifyDailyLogComplete(entryId).catch((err) =>
      console.error('[daily-log] re-notify on update failed:', err),
    )
  }

  return NextResponse.json(update, { status: 201 })
}
