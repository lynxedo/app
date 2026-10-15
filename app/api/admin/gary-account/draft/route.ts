import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { draftGaryEmails, draftGaryFollowUps } from '@/lib/gary-email'

// "Have Gary write the next N emails (or texts)." Writing only — every message
// waits for an approver before anything is sent.

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: Request) {
  const auth = await requireAdminArea('ai')
  if (!auth.ok || !auth.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => ({}))) as { count?: unknown; channel?: unknown }
  try {
    const admin = createAdminClient()
    const count = Number(body.count) || 5
    const result =
      body.channel === 'followup'
        ? await draftGaryFollowUps(admin, auth.company_id, count)
        : await draftGaryEmails(admin, auth.company_id, count, body.channel === 'text' ? 'text' : 'email')
    return NextResponse.json(result)
  } catch (e) {
    console.error('[gary-account] draft failed', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gary couldn’t write just now.' }, { status: 500 })
  }
}
