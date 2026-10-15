import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { draftGaryEmails } from '@/lib/gary-email'

// "Have Gary write the next N emails (or texts)." Writing only — every message
// waits for an approver before anything is sent.

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: Request) {
  const auth = await requireAdminArea('ai')
  if (!auth.ok || !auth.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => ({}))) as { count?: unknown; channel?: unknown }
  try {
    const channel = body.channel === 'text' ? 'text' : 'email'
    const result = await draftGaryEmails(createAdminClient(), auth.company_id, Number(body.count) || 5, channel)
    return NextResponse.json(result)
  } catch (e) {
    console.error('[gary-account] draft failed', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gary couldn’t write just now.' }, { status: 500 })
  }
}
