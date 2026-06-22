import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { syncJobberContactsToEmailList } from '@/lib/email-contacts'

export const maxDuration = 60

// Pull Jobber clients + contacts (with emails) into the master email list and
// mirror their tags. Admin-triggered now; can be cron'd later.
export async function POST() {
  const check = await requireAdminArea('email')
  if (!check.ok || !check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  try {
    const summary = await syncJobberContactsToEmailList(admin, check.company_id)
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'sync_failed' }, { status: 500 })
  }
}
