import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DRAIN_BATCH_SIZE, drainJobberWebhookQueue } from '@/lib/jobber-webhook-queue'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Drain the Jobber webhook queue — the backstop that makes delivery durable.
 *
 * The webhook route already kicks a drain right after acking, so in the happy
 * path this cron finds nothing. It exists for everything else: a retry whose
 * backoff has come due, an event enqueued while the app was restarting, or a
 * post-ack drain that never ran because the process died. Runs every minute.
 *
 * Multi-tenant by construction — the queue is drained by due-ness, not per
 * company, so a new subscriber needs no additional wiring.
 */
async function isAuthorized(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    if (req.headers.get('x-cron-secret') === cronSecret) return true
    if (req.headers.get('Authorization') === `Bearer ${cronSecret}`) return true
  }

  // Admin session, so an admin can force a drain from a browser while debugging.
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
  const requested = Number(body?.limit)
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), 200)
    : DRAIN_BATCH_SIZE

  // Awaited, not detached: the caller is a cron that wants the outcome, and the
  // batch is bounded so it cannot outlive the request.
  const result = await drainJobberWebhookQueue(limit)
  return NextResponse.json({ ok: true, ...result })
}

/** Queue health — depth by status, and the newest dead-letter reasons. */
export async function GET(req: NextRequest) {
  if (!await isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const counts: Record<string, number> = {}
  for (const status of ['pending', 'processing', 'done', 'failed']) {
    const { count } = await admin
      .from('jobber_webhook_events')
      .select('id', { count: 'exact', head: true })
      .eq('status', status)
    counts[status] = count ?? 0
  }

  const { data: failed } = await admin
    .from('jobber_webhook_events')
    .select('topic, item_id, attempts, last_error, created_at')
    .eq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(10)

  return NextResponse.json({ ok: true, counts, recentFailures: failed ?? [] })
}
