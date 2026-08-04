import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseLsaRelay } from '@/lib/lsa-relay'

export const maxDuration = 300

const HEROES_COMPANY_ID = process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'
const RELAY_PREFIX = 'You have received a new message from a customer via Google Local Services Ads'

// POST /api/txt/lsa-relay/backfill
//
// One-off cleanup for Google Local Services relay threads that arrived BEFORE the
// inbound webhook learned to unwrap them (see lib/lsa-relay.ts). For each affected
// inbound message it moves Google's full text into raw_body and puts the
// customer's actual message in body, then tags each thread with lsa_relay +
// location/service so the UI labels it by the lead instead of "Unknown".
//
// Safety properties:
//   • Reversible — the original text is preserved verbatim in raw_body. Rollback is
//     `update txt_messages set body = raw_body, raw_body = null where raw_body is not null`.
//   • Idempotent — only messages with raw_body IS NULL are touched, so a second run
//     is a no-op and it can be resumed after a timeout.
//   • Uses the exact same parser as the live webhook, so history and new traffic
//     end up formatted identically.
//
// Body: { dryRun?: boolean, limit?: number }  — dryRun reports what WOULD change
// and writes nothing. Gate: x-cron-secret OR a Txt admin.
export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const isCron = !!cronSecret && request.headers.get('x-cron-secret') === cronSecret

  let companyId = HEROES_COMPANY_ID
  if (!isCron) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role, can_admin_txt, company_id')
      .eq('id', user.id)
      .single()
    const isAdmin = profile?.role === 'admin' || profile?.can_admin_txt === true
    if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    companyId = profile?.company_id || HEROES_COMPANY_ID
  }

  const payload = await request.json().catch(() => ({}))
  const dryRun = payload.dryRun === true
  const limit = Math.min(Math.max(parseInt(payload.limit, 10) || 500, 1), 2000)

  const admin = createAdminClient()

  const { data: rows, error } = await admin
    .from('txt_messages')
    .select('id, conversation_id, body, created_at')
    .eq('company_id', companyId)
    .eq('direction', 'inbound')
    .is('raw_body', null)
    .like('body', `${RELAY_PREFIX}%`)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Newest relay message per conversation wins for the thread's location/service.
  const threadMeta = new Map<string, { location: string | null; service: string | null }>()
  const samples: Array<{ before: string; after: string }> = []
  let unwrapped = 0
  let skipped = 0

  for (const row of rows ?? []) {
    const parsed = parseLsaRelay(row.body)
    if (!parsed) {
      // Prefix matched but the wrapper didn't (no "Message:" — e.g. one of Google's
      // notification-only texts). Left completely untouched.
      skipped++
      continue
    }
    if (samples.length < 5) {
      samples.push({ before: (row.body ?? '').slice(0, 160), after: parsed.text.slice(0, 160) })
    }
    // Rows are ordered oldest→newest, so the last write per conversation is newest.
    threadMeta.set(row.conversation_id, { location: parsed.location, service: parsed.service })

    if (!dryRun) {
      const { error: upErr } = await admin
        .from('txt_messages')
        .update({ raw_body: row.body, body: parsed.text || null })
        .eq('id', row.id)
        .is('raw_body', null) // re-assert the guard so a concurrent run can't double-apply
      if (upErr) {
        console.error('[lsa-backfill] message update failed', row.id, upErr.message)
        continue
      }
    }
    unwrapped++
  }

  if (!dryRun) {
    for (const [conversationId, meta] of threadMeta) {
      const { error: cErr } = await admin
        .from('txt_conversations')
        .update({ lsa_relay: true, lsa_location: meta.location, lsa_service: meta.service })
        .eq('id', conversationId)
        .eq('company_id', companyId)
      if (cErr) console.error('[lsa-backfill] conversation update failed', conversationId, cErr.message)
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    scanned: rows?.length ?? 0,
    messages_unwrapped: unwrapped,
    messages_skipped_unparsable: skipped,
    threads_tagged: threadMeta.size,
    // More rows than the limit means run it again to continue.
    more: (rows?.length ?? 0) === limit,
    samples,
  })
}
