import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_timesheet, company_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' && !profile?.can_admin_timesheet) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json()

  const allowed = ['first_name', 'last_name', 'preferred_name', 'email', 'phone', 'job_title', 'department', 'hourly_rate', 'pay_type', 'is_active', 'user_id']
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }

  // Track 1 — the admin client bypasses RLS: scope the update to the caller's
  // company; a cross-company (or unknown) id matches nothing → 404.
  if (!profile?.company_id) return NextResponse.json({ error: 'No company' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('employees')
    .update(update)
    .eq('id', id)
    .eq('company_id', profile.company_id)
    .select()
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ employee: data })
}
