import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const SETTINGS_ID = '00000000-0000-0000-0000-000000000003'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('timesheet_settings')
    .select('id, pay_period_frequency, pay_period_start_day, overtime_threshold_daily, overtime_threshold_weekly, gps_enabled, gps_visible_to_employee')
    .eq('id', SETTINGS_ID)
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
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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

  const { data, error } = await supabase
    .from('timesheet_settings')
    .update(update)
    .eq('id', SETTINGS_ID)
    .select('id, pay_period_frequency, pay_period_start_day, overtime_threshold_daily, overtime_threshold_weekly, gps_enabled, gps_visible_to_employee')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}
