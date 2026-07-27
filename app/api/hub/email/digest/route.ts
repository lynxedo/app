import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { postGuardianToUserDm } from '@/lib/guardian-post'
import { sendHubPush } from '@/lib/hub-push'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Called by VPS cron (wiring is a later manual step) — DOES send real Guardian
// DMs + pushes:
//   curl -s -X POST https://lynxedo.com/api/hub/email/digest \
//     -H "x-cron-secret: $CRON_SECRET"
// End-of-day sweep: DMs each shared-inbox MANAGER a short summary of what's
// still open in the shared inbox, so nothing sleeps overnight. Best-effort per
// company + per manager — one failure can't abort the sweep.

// Compact "2d" / "5h" / "3m" age from a past ISO timestamp.
function formatAge(fromIso: string): string {
  const diffMs = Date.now() - new Date(fromIso).getTime()
  if (!Number.isFinite(diffMs) || diffMs <= 0) return '0m'
  const mins = Math.floor(diffMs / 60000)
  if (mins >= 1440) return `${Math.floor(mins / 1440)}d`
  if (mins >= 60) return `${Math.floor(mins / 60)}h`
  return `${mins}m`
}

// Health check — no secret required; returns nothing sensitive.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'hub/email/digest' })
}

type ThreadRow = {
  assigned_to_user_id: string | null
  last_message_direction: string | null
  waiting_state: string | null
  last_message_at: string | null
}

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  // Companies that have an active SHARED inbox account.
  const { data: acctRows, error: acctErr } = await admin
    .from('inbox_accounts')
    .select('company_id')
    .eq('account_type', 'shared')
    .eq('active', true)
  if (acctErr) return NextResponse.json({ error: acctErr.message }, { status: 500 })

  const companyIds = [
    ...new Set(
      ((acctRows ?? []) as { company_id: string | null }[])
        .map((r) => r.company_id)
        .filter((id): id is string => !!id),
    ),
  ]

  let companies = 0
  let digestsSent = 0

  for (const companyId of companyIds) {
    // Best-effort per company — one bad company can't abort the whole sweep.
    try {
      // Open, non-snoozed shared threads for this company.
      const { data: rows, error: threadErr } = await admin
        .from('inbox_threads')
        .select('assigned_to_user_id, last_message_direction, waiting_state, last_message_at')
        .eq('company_id', companyId)
        .eq('is_shared', true)
        .is('deleted_at', null)
        .neq('status', 'closed')
        .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
      if (threadErr) {
        console.error('[inbox:digest] thread query failed:', companyId, threadErr.message)
        continue
      }

      const threads = (rows ?? []) as ThreadRow[]

      let unassigned = 0
      let needsReply = 0
      let waiting = 0
      let oldestIso: string | null = null // oldest last_message_at among needs-reply threads

      for (const t of threads) {
        if (t.assigned_to_user_id === null) unassigned++
        if (t.waiting_state !== null) waiting++
        if (t.last_message_direction === 'inbound') {
          needsReply++
          if (t.last_message_at && (!oldestIso || t.last_message_at < oldestIso)) {
            oldestIso = t.last_message_at
          }
        }
      }

      // Nothing outstanding → no empty digest for this company.
      if (unassigned === 0 && needsReply === 0 && waiting === 0) continue

      companies++

      const oldest = oldestIso ? formatAge(oldestIso) : null
      const body =
        `📬 Inbox end of day — ${unassigned} unassigned, ${needsReply} awaiting reply, ${waiting} waiting` +
        (oldest ? `, oldest unanswered ${oldest}` : '') +
        `. Open the Inbox to clear them.`

      // Managers: admins + anyone granted can_manage_shared_inbox in this company.
      const { data: mgrRows, error: mgrErr } = await admin
        .from('user_profiles')
        .select('id')
        .eq('company_id', companyId)
        .or('role.eq.admin,can_manage_shared_inbox.eq.true')
      if (mgrErr) {
        console.error('[inbox:digest] manager query failed:', companyId, mgrErr.message)
        continue
      }

      const managerIds = ((mgrRows ?? []) as { id: string }[]).map((r) => r.id)

      for (const userId of managerIds) {
        // Best-effort per manager — one failure can't skip the rest.
        try {
          await postGuardianToUserDm(companyId, userId, body, { admin })
          await sendHubPush(
            [userId],
            { title: 'Inbox — end-of-day summary', body, url: '/hub/email', type: 'inbox_digest' },
            { isDm: true },
          )
          digestsSent++
        } catch (err) {
          console.error('[inbox:digest] manager notify failed:', userId, (err as Error).message)
        }
      }
    } catch (err) {
      console.error('[inbox:digest] company failed:', companyId, (err as Error).message)
    }
  }

  return NextResponse.json({ ok: true, companies, digestsSent })
}
