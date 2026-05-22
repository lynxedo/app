import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

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
    .from('chat_synx_bridges')
    .select(`
      id, slack_channel_id, active, created_at,
      hub_room:rooms!hub_room_id (id, name)
    `)
    .eq('company_id', ctx.companyId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ bridges: data ?? [] })
}

export async function POST(request: Request) {
  const ctx = await gate()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const slackChannelId = (body.slack_channel_id as string | undefined)?.trim()
  const hubRoomId = body.hub_room_id as string | undefined

  if (!slackChannelId || !hubRoomId) {
    return NextResponse.json({ error: 'slack_channel_id and hub_room_id required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('chat_synx_bridges')
    .insert({
      slack_channel_id: slackChannelId,
      hub_room_id: hubRoomId,
      company_id: ctx.companyId,
      active: true,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id }, { status: 201 })
}
