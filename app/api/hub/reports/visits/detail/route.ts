import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET /api/hub/reports/visits/detail?start=YYYY-MM-DD&end=YYYY-MM-DD&tech=<external_id>
// Returns individual visit rows for one technician in the date range.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  if (profile.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const start = searchParams.get('start')
  const end   = searchParams.get('end')
  const tech  = searchParams.get('tech')
  if (!start || !end || !tech) return NextResponse.json({ error: 'start, end, and tech required' }, { status: 400 })

  const { data, error } = await supabase.rpc('get_visits_report_detail', {
    p_company_id:       profile.company_id,
    p_start:            start,
    p_end:              end,
    p_tech_external_id: tech,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ visits: data ?? [] })
}
