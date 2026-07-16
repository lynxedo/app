import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Optional pipeline semantics a stage can be tagged with. Consumed by the Board /
// Needs-me cockpit views (won/lost = terminal columns) and the drip stage_changed
// trigger. At most one stage per company may hold each role (enforced by a partial
// unique index); assigning a role here MOVES it off any other stage.
const VALID_SYSTEM_ROLES = ['new', 'responded', 'quoted', 'won', 'lost']

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const allowed: Record<string, unknown> = {}
  if (body.label !== undefined) allowed.label = body.label
  if (body.color !== undefined) allowed.color = body.color
  if (body.sort_order !== undefined) allowed.sort_order = body.sort_order

  let roleToAssign: string | null | undefined
  if (body.system_role !== undefined) {
    const normalized = body.system_role === null || body.system_role === '' ? null : String(body.system_role)
    if (normalized !== null && !VALID_SYSTEM_ROLES.includes(normalized)) {
      return NextResponse.json({ error: 'Invalid system_role' }, { status: 400 })
    }
    allowed.system_role = normalized
    roleToAssign = normalized
  }

  const admin = createAdminClient()

  // A role is single-source per company. Clear it off any other stage first so the
  // partial unique index (company_id, system_role) can't reject the assignment.
  if (roleToAssign) {
    await admin
      .from('tracker_stages')
      .update({ system_role: null })
      .eq('company_id', profile.company_id)
      .eq('system_role', roleToAssign)
      .neq('id', id)
  }

  const { data, error } = await admin
    .from('tracker_stages')
    .update(allowed)
    .eq('id', id)
    .eq('company_id', profile.company_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const migrateTo = searchParams.get('migrate_to')

  // Fetch the stage being deleted
  const { data: stage } = await supabase
    .from('tracker_stages')
    .select('key')
    .eq('id', id)
    .eq('company_id', profile.company_id)
    .single()

  if (!stage) return NextResponse.json({ error: 'Stage not found' }, { status: 404 })

  const admin = createAdminClient()

  // Move all leads in this stage to the migration target (or null)
  if (migrateTo) {
    await admin
      .from('leads')
      .update({ stage: migrateTo })
      .eq('company_id', profile.company_id)
      .eq('stage', stage.key)
  }

  const { error } = await admin
    .from('tracker_stages')
    .delete()
    .eq('id', id)
    .eq('company_id', profile.company_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
