import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

async function requireAdmin() {
  const check = await requireAdminArea('people')
  return check.ok && check.user && check.company_id ? { company_id: check.company_id } : null
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin_ctx = await requireAdmin()
  if (!admin_ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const admin = createAdminClient()

  const { data: emp, error: empError } = await admin
    .from('employees')
    .select('id, first_name, last_name, preferred_name, email, company_id')
    .eq('id', id)
    .eq('company_id', admin_ctx.company_id)
    .single()

  if (empError || !emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

  // work_email in body takes priority over the Gusto personal email on file
  const inviteEmail: string = body.work_email || emp.email
  if (!inviteEmail) return NextResponse.json({ error: 'No email address provided' }, { status: 400 })

  const { data, error } = await admin.auth.admin.inviteUserByEmail(inviteEmail, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (data.user) {
    const fullName = `${emp.first_name} ${emp.last_name}`
    const displayName = emp.preferred_name ?? emp.first_name

    await admin.from('user_profiles').update({
      full_name: fullName,
      invite_sent_at: new Date().toISOString(),
      can_access_timesheet: true,
    }).eq('id', data.user.id)

    await admin.from('hub_users').update({ display_name: displayName }).eq('id', data.user.id)
    await admin.from('employees').update({ user_id: data.user.id }).eq('id', emp.id)
  }

  return NextResponse.json({ user: data.user })
}
