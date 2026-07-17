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
  // Track 1 — the admin client below bypasses RLS; a caller with no company can't manage anyone.
  if (!check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { enabled } = await request.json()
  const admin = createAdminClient()
  const now = new Date().toISOString()

  // Track 1 — verify the target belongs to the caller's company before ANY roster
  // mutation or grant; a cross-company id answers exactly like a missing user.
  const { data: targetProfile } = await admin
    .from('user_profiles')
    .select('company_id, deactivated_at, full_name')
    .eq('id', id)
    .maybeSingle()
  if (!targetProfile || targetProfile.company_id !== check.company_id) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  if (enabled && targetProfile.deactivated_at) {
    return NextResponse.json({ error: 'This person is deactivated — reactivate them first' }, { status: 400 })
  }

  if (!enabled) {
    const { data, error } = await admin
      .from('employees')
      .update({ is_active: false, updated_at: now })
      .eq('user_id', id)
      .eq('company_id', check.company_id) // Track 1 — scope the RLS-bypassing write
      .select()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, employee: data?.[0] ?? null })
  }

  // Re-activate an existing linked row if there is one
  const { data: linked } = await admin
    .from('employees')
    .select('*')
    .eq('user_id', id)
    .eq('company_id', check.company_id) // Track 1 — scope the RLS-bypassing read
    .limit(1)
    .maybeSingle()
  if (linked) {
    const { data, error } = await admin
      .from('employees')
      .update({ is_active: true, updated_at: now })
      .eq('id', linked.id)
      .eq('company_id', check.company_id) // Track 1 — scope the RLS-bypassing write
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await admin.from('user_profiles').update({ can_access_timesheet: true, updated_at: now }).eq('id', id)
    return NextResponse.json({ ok: true, employee: data })
  }

  const { data: authUser } = await admin.auth.admin.getUserById(id)
  const email = authUser?.user?.email ?? null

  // Adopt an unlinked roster row with the same email before creating a new one
  // (Track 1 — only within the caller's company; never adopt another tenant's row)
  if (email) {
    const { data: byEmail } = await admin
      .from('employees')
      .select('*')
      .ilike('email', email)
      .is('user_id', null)
      .eq('company_id', check.company_id)
      .limit(1)
      .maybeSingle()
    if (byEmail) {
      const { data, error } = await admin
        .from('employees')
        .update({ user_id: id, is_active: true, updated_at: now })
        .eq('id', byEmail.id)
        .eq('company_id', check.company_id) // Track 1 — scope the RLS-bypassing write
        .select()
        .single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await admin.from('user_profiles').update({ can_access_timesheet: true, updated_at: now }).eq('id', id)
      return NextResponse.json({ ok: true, employee: data })
    }
  }

  const fullName = (targetProfile.full_name ?? '').trim()
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
      company_id: check.company_id, // Track 1 — target verified same-company above
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await admin.from('user_profiles').update({ can_access_timesheet: true, updated_at: now }).eq('id', id)
  return NextResponse.json({ ok: true, employee: data })
}
