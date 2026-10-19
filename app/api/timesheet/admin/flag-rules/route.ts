import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireTimesheetAdmin } from '@/lib/timesheet-admin-auth'

const KINDS = ['clock_in_before', 'clock_in_after', 'clock_out_before', 'clock_out_after', 'day_hours_over', 'week_ot_over'] as const
const SELECT = 'id, kind, time_value, hours_value, is_active, created_at'

// GET — the company's flag rules (newest last).
export async function GET() {
  const auth = await requireTimesheetAdmin()
  if (!auth.ok) return auth.res
  const { data, error } = await createAdminClient()
    .from('timesheet_flag_rules')
    .select(SELECT)
    .eq('company_id', auth.companyId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rules: data ?? [] })
}

// POST { kind, time_value?: 'HH:MM', hours_value?: number } — add a rule.
export async function POST(req: NextRequest) {
  const auth = await requireTimesheetAdmin()
  if (!auth.ok) return auth.res
  const { kind, time_value, hours_value } = await req.json()
  if (!KINDS.includes(kind)) return NextResponse.json({ error: 'Unknown rule type' }, { status: 400 })
  const isClock = String(kind).startsWith('clock_')
  if (isClock && !/^\d{2}:\d{2}(:\d{2})?$/.test(String(time_value ?? ''))) {
    return NextResponse.json({ error: 'Pick a time' }, { status: 400 })
  }
  const hours = Number(hours_value)
  if (!isClock && (!Number.isFinite(hours) || hours < 0 || hours > 168)) {
    return NextResponse.json({ error: 'Enter a number of hours' }, { status: 400 })
  }
  const { data, error } = await createAdminClient()
    .from('timesheet_flag_rules')
    .insert({
      company_id: auth.companyId,
      kind,
      time_value: isClock ? time_value : null,
      hours_value: isClock ? null : hours,
      created_by: auth.userId,
    })
    .select(SELECT)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rule: data })
}

// PATCH { id, is_active } — switch a rule on/off.
export async function PATCH(req: NextRequest) {
  const auth = await requireTimesheetAdmin()
  if (!auth.ok) return auth.res
  const { id, is_active } = await req.json()
  if (!id || typeof is_active !== 'boolean') return NextResponse.json({ error: 'id and is_active required' }, { status: 400 })
  const { data, error } = await createAdminClient()
    .from('timesheet_flag_rules')
    .update({ is_active })
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .is('deleted_at', null)
    .select(SELECT)
    .single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: 404 })
  return NextResponse.json({ rule: data })
}

// DELETE ?id= — remove a rule (soft delete; its past clearances stay on record).
export async function DELETE(req: NextRequest) {
  const auth = await requireTimesheetAdmin()
  if (!auth.ok) return auth.res
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await createAdminClient()
    .from('timesheet_flag_rules')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', auth.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
