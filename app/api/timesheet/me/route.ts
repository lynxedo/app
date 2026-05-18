import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/timesheet/me — returns the current user's linked employee + clock status
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: employee } = await supabase
    .from('employees')
    .select('id, first_name, last_name, preferred_name, job_title')
    .eq('user_id', user.id)
    .single()

  if (!employee) return NextResponse.json({ employee: null, clocked_in: false, since: null })

  // Most recent punch determines current status
  const { data: punch } = await supabase
    .from('time_punches')
    .select('punch_type, punched_at')
    .eq('employee_id', employee.id)
    .order('punched_at', { ascending: false })
    .limit(1)
    .single()

  const clocked_in = punch?.punch_type === 'in'
  return NextResponse.json({
    employee,
    clocked_in,
    since: clocked_in ? punch.punched_at : null,
  })
}
