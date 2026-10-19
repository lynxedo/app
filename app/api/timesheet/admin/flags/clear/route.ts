import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireTimesheetAdmin } from '@/lib/timesheet-admin-auth'
import { computeWeekFlags } from '@/lib/timesheet-flags'

// POST /api/timesheet/admin/flags/clear
// Body: { week_start, flag_key, note? }
// Clears one flag. The key must be a flag the week produces right now — so a
// stale screen can't clear something that has since changed.
export async function POST(req: NextRequest) {
  const auth = await requireTimesheetAdmin()
  if (!auth.ok) return auth.res
  const { week_start, flag_key, note } = await req.json()
  if (!week_start || !flag_key) return NextResponse.json({ error: 'week_start and flag_key required' }, { status: 400 })

  const admin = createAdminClient()
  const report = await computeWeekFlags(admin, auth.companyId, week_start)
  if (report.approval) return NextResponse.json({ error: 'This week is already approved.' }, { status: 409 })
  const flag = report.flags.find(f => f.key === flag_key)
  if (!flag) return NextResponse.json({ error: 'That flag has changed — refresh and try again.' }, { status: 409 })
  if (flag.cleared) return NextResponse.json({ ok: true })

  const { error } = await admin.from('timesheet_flag_reviews').insert({
    company_id: auth.companyId,
    employee_id: flag.employee_id,
    week_start,
    flag_key,
    note: typeof note === 'string' && note.trim() ? note.trim() : null,
    cleared_by: auth.userId,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
