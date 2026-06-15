import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // No ID filter needed — RLS scopes this to the user's company automatically
  const { data, error } = await supabase
    .from('timesheet_settings')
    .select('id, pay_period_frequency, pay_period_start_day, overtime_threshold_daily, overtime_threshold_weekly, gps_enabled, gps_visible_to_employee')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_timesheet, company_id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin' && !profile?.can_admin_timesheet) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const allowed = [
    'pay_period_frequency',
    'pay_period_start_day',
    'overtime_threshold_daily',
    'overtime_threshold_weekly',
    'gps_enabled',
    'gps_visible_to_employee',
  ]

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }

  // Explicit company_id filter: PostgREST rejects an UPDATE with no filter, and
  // it's the right backstop anyway (RLS still scopes/validates on top).
  const { data, error } = await supabase
    .from('timesheet_settings')
    .update(update)
    .eq('company_id', profile.company_id)
    .select('id, pay_period_frequency, pay_period_start_day, overtime_threshold_daily, overtime_threshold_weekly, gps_enabled, gps_visible_to_employee')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}
