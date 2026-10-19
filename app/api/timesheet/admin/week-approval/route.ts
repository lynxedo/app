import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireTimesheetAdmin } from '@/lib/timesheet-admin-auth'
import { computeWeekFlags } from '@/lib/timesheet-flags'

// POST /api/timesheet/admin/week-approval
// Body: { week_start, action: 'approve' | 'unapprove' }
//
// Approve = payroll for this pay week is final. Re-checked here (never trust the
// button): every flag cleared, nobody still on the clock, no pending edit or PTO
// requests. An approved week is locked — see lib/timesheet-lock.ts.
// Unapprove stamps revoked_* so the history of approvals is kept.
export async function POST(req: NextRequest) {
  const auth = await requireTimesheetAdmin()
  if (!auth.ok) return auth.res
  const { week_start, action } = await req.json()
  if (!week_start || !/^\d{4}-\d{2}-\d{2}$/.test(week_start)) {
    return NextResponse.json({ error: 'week_start (YYYY-MM-DD) required' }, { status: 400 })
  }
  const admin = createAdminClient()

  if (action === 'unapprove') {
    const { error } = await admin
      .from('timesheet_week_approvals')
      .update({ revoked_at: new Date().toISOString(), revoked_by: auth.userId })
      .eq('company_id', auth.companyId)
      .eq('week_start', week_start)
      .is('revoked_at', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  if (action !== 'approve') return NextResponse.json({ error: 'action must be approve or unapprove' }, { status: 400 })

  const report = await computeWeekFlags(admin, auth.companyId, week_start)
  if (report.approval) return NextResponse.json({ ok: true })
  const open = report.flags.filter(f => !f.cleared).length
  const blockers: string[] = []
  if (open > 0) blockers.push(`${open} flag${open === 1 ? '' : 's'} still to clear`)
  if (report.openShifts.length > 0) blockers.push(`${report.openShifts.length} still clocked in`)
  if (report.pendingEditRequests > 0) blockers.push(`${report.pendingEditRequests} edit request${report.pendingEditRequests === 1 ? '' : 's'} waiting`)
  if (report.pendingPto > 0) blockers.push(`${report.pendingPto} PTO request${report.pendingPto === 1 ? '' : 's'} waiting`)
  if (blockers.length > 0) {
    return NextResponse.json({ error: `Can't approve yet: ${blockers.join(', ')}.` }, { status: 409 })
  }

  const { error } = await admin.from('timesheet_week_approvals').insert({
    company_id: auth.companyId,
    week_start,
    approved_by: auth.userId,
  })
  // 23505 = a parallel click already approved it — same outcome.
  if (error && error.code !== '23505') return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
