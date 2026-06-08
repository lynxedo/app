import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const COMPANY_ID = '00000000-0000-0000-0000-000000000002'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('user_profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const { data: logs } = await admin
    .from('sync_log')
    .select('*')
    .eq('company_id', COMPANY_ID)
    .order('started_at', { ascending: false })
    .limit(20)

  const logsWithDuration = (logs ?? []).map(log => ({
    ...log,
    duration_seconds: log.completed_at
      ? Math.round((new Date(log.completed_at).getTime() - new Date(log.started_at).getTime()) / 1000)
      : null,
  }))

  return NextResponse.json({ logs: logsWithDuration })
}
