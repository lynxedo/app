import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireTimesheetAdmin } from '@/lib/timesheet-admin-auth'
import { computeWeekFlags } from '@/lib/timesheet-flags'

export const dynamic = 'force-dynamic'

// GET /api/timesheet/admin/flags?week_start=YYYY-MM-DD
// The pay week's flags (open + cleared), what still blocks approval, and the
// week's approval if it has one.
export async function GET(req: NextRequest) {
  const auth = await requireTimesheetAdmin()
  if (!auth.ok) return auth.res
  const weekStart = req.nextUrl.searchParams.get('week_start')
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return NextResponse.json({ error: 'week_start (YYYY-MM-DD) required' }, { status: 400 })
  }
  const report = await computeWeekFlags(createAdminClient(), auth.companyId, weekStart)
  return NextResponse.json(report)
}
