import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { fetchSlackUserProfile } from '@/lib/chat-synx'

async function gate() {
  const check = await requireAdminArea('hub')
  if (!check.ok || !check.company_id) return null
  return { companyId: check.company_id }
}

export async function GET() {
  const ctx = await gate()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('chat_synx_user_links')
    .select(`
      slack_user_id, display_name, avatar_url, created_at,
      hub_user:hub_users!hub_user_id (id, display_name, avatar_url)
    `)
    .eq('company_id', ctx.companyId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ links: data ?? [] })
}

export async function POST(request: Request) {
  const ctx = await gate()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const slackUserId = (body.slack_user_id as string | undefined)?.trim()
  const hubUserId = body.hub_user_id as string | undefined

  if (!slackUserId || !hubUserId) {
    return NextResponse.json({ error: 'slack_user_id and hub_user_id required' }, { status: 400 })
  }

  // Pull current profile from Slack to cache name + avatar — looks empty in the UI
  // until we have it, and outbound posts need it.
  const profile = await fetchSlackUserProfile(slackUserId)

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('chat_synx_user_links')
    .insert({
      slack_user_id: slackUserId,
      hub_user_id: hubUserId,
      company_id: ctx.companyId,
      display_name: profile?.displayName ?? null,
      avatar_url: profile?.avatarUrl ?? null,
    })
    .select('slack_user_id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ slack_user_id: data.slack_user_id }, { status: 201 })
}
