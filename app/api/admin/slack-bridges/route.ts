import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' || !profile.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: profile.company_id }
}

export async function GET() {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('slack_bridges')
    .select(`
      id, bridge_type, slack_user_id, slack_channel_id, active, created_at,
      hub_user:hub_users!hub_user_id (id, display_name),
      hub_room:rooms!hub_room_id (id, name)
    `)
    .eq('company_id', ctx.companyId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ bridges: data ?? [] })
}

export async function POST(request: Request) {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx.error

  const body = await request.json()
  const { bridge_type, slack_user_id, hub_user_id, slack_channel_id, hub_room_id } = body

  if (bridge_type !== 'dm' && bridge_type !== 'room') {
    return NextResponse.json({ error: 'bridge_type must be "dm" or "room"' }, { status: 400 })
  }

  if (bridge_type === 'dm') {
    if (!slack_user_id?.trim() || !hub_user_id) {
      return NextResponse.json({ error: 'slack_user_id and hub_user_id required for DM bridge' }, { status: 400 })
    }
  } else {
    if (!slack_channel_id?.trim() || !hub_room_id) {
      return NextResponse.json({ error: 'slack_channel_id and hub_room_id required for room bridge' }, { status: 400 })
    }
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('slack_bridges')
    .insert({
      company_id: ctx.companyId,
      bridge_type,
      slack_user_id: bridge_type === 'dm' ? slack_user_id.trim() : null,
      hub_user_id: bridge_type === 'dm' ? hub_user_id : null,
      slack_channel_id: bridge_type === 'room' ? slack_channel_id.trim() : null,
      hub_room_id: bridge_type === 'room' ? hub_room_id : null,
      active: true,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id }, { status: 201 })
}
