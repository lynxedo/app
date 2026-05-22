import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { fetchSlackUserProfile } from '@/lib/chat-synx'

async function gate() {
  const check = await requireAdminArea('hub')
  if (!check.ok || !check.company_id) return null
  return { companyId: check.company_id }
}

// Re-pull the cached display_name + avatar_url from Slack. Used by the Refresh
// button in the People tab.
export async function PATCH(_request: Request, { params }: { params: Promise<{ slackUserId: string }> }) {
  const ctx = await gate()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { slackUserId } = await params
  const profile = await fetchSlackUserProfile(slackUserId)
  if (!profile) return NextResponse.json({ error: 'Could not fetch Slack profile' }, { status: 502 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('chat_synx_user_links')
    .update({
      display_name: profile.displayName,
      avatar_url: profile.avatarUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('slack_user_id', slackUserId)
    .eq('company_id', ctx.companyId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ display_name: profile.displayName, avatar_url: profile.avatarUrl })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ slackUserId: string }> }) {
  const ctx = await gate()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { slackUserId } = await params
  const admin = createAdminClient()
  const { error } = await admin
    .from('chat_synx_user_links')
    .delete()
    .eq('slack_user_id', slackUserId)
    .eq('company_id', ctx.companyId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
