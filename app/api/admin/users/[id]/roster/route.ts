import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

// The Employee Roster toggle in Admin → People. ON creates (or re-activates and
// links) the person's employees row — this is how people get onto the roster;
// Gusto never creates rows. OFF marks the row inactive, keeping all timesheet
// history so the toggle is fully reversible.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = await requireAdminArea('people')
  if (!check.ok || !check.user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { enabled } = await request.json()
  const admin = createAdminClient()
  const now = new Date().toISOString()

  if (enabled) {
    const { data: targetProfile } = await admin
      .from('user_profiles')
      .select('deactivated_at')
      .eq('id', id)
      .maybeSingle()
    if (targetProfile?.deactivated_at) {
      return NextResponse.json({ error: 'This person is deactivated — reactivate them first' }, { status: 400 })
    }
  }

  if (!enabled) {
    const { data, error } = await admin
      .from('employees')
      .update({ is_active: false, updated_at: now })
      .eq('user_id', id)
      .select()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, employee: data?.[0] ?? null })
  }

  // Re-activate an existing linked row if there is one
  const { data: linked } = await admin
    .from('employees')
    .select('*')
    .eq('user_id', id)
    .limit(1)
    .maybeSingle()
  if (linked) {
    const { data, error } = await admin
      .from('employees')
      .update({ is_active: true, updated_at: now })
      .eq('id', linked.id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await admin.from('user_profiles').update({ can_access_timesheet: true, updated_at: now }).eq('id', id)
    return NextResponse.json({ ok: true, employee: data })
  }

  const { data: authUser } = await admin.auth.admin.getUserById(id)
  const email = authUser?.user?.email ?? null
  const { data: profile } = await admin
    .from('user_profiles')
    .select('full_name, company_id')
    .eq('id', id)
    .single()

  // Adopt an unlinked roster row with the same email before creating a new one
  if (email) {
    const { data: byEmail } = await admin
      .from('employees')
      .select('*')
      .ilike('email', email)
      .is('user_id', null)
      .limit(1)
      .maybeSingle()
    if (byEmail) {
      const { data, error } = await admin
        .from('employees')
        .update({ user_id: id, is_active: true, updated_at: now })
        .eq('id', byEmail.id)
        .select()
        .single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await admin.from('user_profiles').update({ can_access_timesheet: true, updated_at: now }).eq('id', id)
      return NextResponse.json({ ok: true, employee: data })
    }
  }

  const fullName = (profile?.full_name ?? '').trim()
  const parts = fullName.split(/\s+/).filter(Boolean)
  const firstName = parts[0] || (email ? email.split('@')[0] : 'New')
  const lastName = parts.slice(1).join(' ') || '—'

  const { data, error } = await admin
    .from('employees')
    .insert({
      user_id: id,
      first_name: firstName,
      last_name: lastName,
      email,
      pay_type: 'hourly',
      flsa_status: 'Nonexempt',
      is_active: true,
      ...(profile?.company_id ? { company_id: profile.company_id } : {}),
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await admin.from('user_profiles').update({ can_access_timesheet: true, updated_at: now }).eq('id', id)
  return NextResponse.json({ ok: true, employee: data })
}
