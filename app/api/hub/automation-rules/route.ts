import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  if (profile.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('hub_automation_rules')
    .select(`
      id, name, trigger_source, keyword, recipient_type, trigger_config, condition_config,
      action_type, message_template, active, created_at, last_fired_at,
      trigger_room:rooms!trigger_room_id (id, name),
      target_room:rooms!target_room_id (id, name),
      target_user:hub_users!target_user_id (id, display_name),
      target_board:boards!target_board_id (id, name),
      created_by_user:hub_users!created_by (id, display_name)
    `)
    .eq('company_id', profile.company_id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rules: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  if (profile.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const {
    name, keyword, trigger_room_id, action_type, target_room_id, target_user_id,
    target_board_id, message_template, active,
    recipient_type, trigger_config, condition_config,
  } = body
  const trigger_source: string = body.trigger_source || 'room_message'

  if (!message_template?.trim()) {
    return NextResponse.json({ error: 'message_template required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: hubUser } = await admin
    .from('hub_users')
    .select('id')
    .eq('id', user.id)
    .single()
  if (!hubUser) return NextResponse.json({ error: 'Hub user not found' }, { status: 404 })

  // Build the insert row, validated per trigger source.
  const row: Record<string, unknown> = {
    company_id: profile.company_id,
    name: name?.trim() || null,
    trigger_source,
    message_template: message_template.trim(),
    active: active !== false,
    created_by: hubUser.id,
    trigger_config: trigger_config ?? {},
    condition_config: condition_config ?? {},
  }

  if (trigger_source === 'room_message') {
    // Existing keyword behavior — unchanged.
    if (!keyword?.trim()) return NextResponse.json({ error: 'keyword required' }, { status: 400 })
    if (!['post_room', 'dm_user', 'create_board_task'].includes(action_type)) return NextResponse.json({ error: 'invalid action_type' }, { status: 400 })
    if (action_type === 'post_room' && !target_room_id) return NextResponse.json({ error: 'target_room_id required for post_room' }, { status: 400 })
    if (action_type === 'dm_user' && !target_user_id) return NextResponse.json({ error: 'target_user_id required for dm_user' }, { status: 400 })
    if (action_type === 'create_board_task' && !target_board_id) return NextResponse.json({ error: 'target_board_id required for create_board_task' }, { status: 400 })
    row.keyword = keyword.trim()
    row.trigger_room_id = trigger_room_id ?? null
    row.action_type = action_type
    row.recipient_type = action_type === 'post_room' ? 'room' : 'fixed_user'
    row.target_room_id = action_type === 'post_room' ? target_room_id : null
    row.target_user_id = action_type === 'dm_user' ? target_user_id : null
    row.target_board_id = action_type === 'create_board_task' ? target_board_id : null
  } else if (trigger_source === 'schedule' || trigger_source === 'fleet_geofence') {
    const rt: string = recipient_type || 'fixed_user'
    if (!['fixed_user', 'room', 'assigned_tech', 'condition_matches', 'created_by'].includes(rt)) {
      return NextResponse.json({ error: 'invalid recipient_type' }, { status: 400 })
    }
    if (rt === 'room' && !target_room_id) return NextResponse.json({ error: 'target_room_id required for room recipient' }, { status: 400 })
    if (rt === 'fixed_user' && !target_user_id) return NextResponse.json({ error: 'target_user_id required for fixed_user recipient' }, { status: 400 })
    if (trigger_source === 'schedule' && !trigger_config?.time) return NextResponse.json({ error: 'trigger_config.time required for schedule' }, { status: 400 })
    if (trigger_source === 'fleet_geofence' && !trigger_config?.geofence_id) return NextResponse.json({ error: 'trigger_config.geofence_id required for fleet_geofence' }, { status: 400 })
    row.keyword = null
    row.recipient_type = rt
    row.action_type = rt === 'room' ? 'post_room' : 'dm_user'
    row.target_room_id = rt === 'room' ? target_room_id : null
    row.target_user_id = rt === 'fixed_user' ? target_user_id : null
  } else {
    return NextResponse.json({ error: 'invalid trigger_source' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('hub_automation_rules')
    .insert(row)
    .select(`
      id, name, trigger_source, keyword, recipient_type, trigger_config, condition_config,
      action_type, message_template, active, created_at, last_fired_at,
      trigger_room:rooms!trigger_room_id (id, name),
      target_room:rooms!target_room_id (id, name),
      target_user:hub_users!target_user_id (id, display_name),
      target_board:boards!target_board_id (id, name),
      created_by_user:hub_users!created_by (id, display_name)
    `)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
