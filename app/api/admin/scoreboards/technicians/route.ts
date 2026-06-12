import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Admin-only: assign which employees appear on a scoreboard's per-technician
// panel. Gusto job_title / department proved unreliable for this (Angel mis-
// tagged "Fert Tech", Lucas + Wilson both "Irrigation" but only Lucas is a
// tracked tech), so admins pick technicians explicitly. Writes go through the
// service-role client (bypasses RLS); reads for the page are server-side.
async function getAdminCompany(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.role !== 'admin' || !profile.company_id) return null
  return profile.company_id as string
}

export async function POST(request: Request) {
  const company = await getAdminCompany()
  if (!company) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({})) as { board_slug?: string; employee_id?: string; assigned?: boolean }
  const boardSlug = String(body.board_slug || '').trim()
  const employeeId = String(body.employee_id || '').trim()
  const assigned = !!body.assigned
  if (!boardSlug || !employeeId) {
    return NextResponse.json({ error: 'board_slug and employee_id are required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Guard: the employee must belong to this company.
  const { data: emp } = await admin
    .from('employees').select('id').eq('id', employeeId).eq('company_id', company).maybeSingle()
  if (!emp) return NextResponse.json({ error: 'Unknown employee' }, { status: 404 })

  if (assigned) {
    const { error } = await admin
      .from('scoreboard_technicians')
      .upsert(
        { company_id: company, board_slug: boardSlug, employee_id: employeeId },
        { onConflict: 'company_id,board_slug,employee_id' }
      )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await admin
      .from('scoreboard_technicians')
      .delete()
      .eq('company_id', company)
      .eq('board_slug', boardSlug)
      .eq('employee_id', employeeId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
