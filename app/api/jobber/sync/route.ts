import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runInitialJobberSync, runDeltaJobberSync } from '@/lib/jobber-sync'

const COMPANY_ID = '00000000-0000-0000-0000-000000000002'

async function isAuthorized(req: NextRequest): Promise<boolean> {
  // Cron secret auth (for nightly cron in Session 68)
  const authHeader = req.headers.get('Authorization')
  if (authHeader === `Bearer ${process.env.CRON_SECRET}`) return true

  // Admin session auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  return profile?.role === 'admin'
}

export async function POST(req: NextRequest) {
  if (!await isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const type = body.type === 'delta' ? 'delta' : 'initial'

  // Kick off in background — don't await (initial pull takes 10–20 min)
  if (type === 'initial') {
    void runInitialJobberSync(COMPANY_ID).catch(err =>
      console.error('[jobber-sync] Unhandled error in initial sync:', err)
    )
  } else {
    void runDeltaJobberSync(COMPANY_ID).catch(err =>
      console.error('[jobber-sync] Unhandled error in delta sync:', err)
    )
  }

  return NextResponse.json({ status: 'started', type })
}
