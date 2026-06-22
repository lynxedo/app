import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SCOREBOARDS } from '@/lib/scoreboards/registry'
import { computeBoardPayload } from '../route'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST /api/hub/scoreboards/snapshot
// Captures one weekly point-in-time snapshot of every scoreboard's full payload
// for every company that uses Scoreboards. Wired to a Friday-night VPS cron so a
// fresh weekly checkpoint is ready each Monday. Idempotent per week: upserts on
// (company_id, board_slug, label), so a same-week re-run refreshes the row.
//
// Runs with the service-role client (no auth.uid()), so the gated scoreboard RPCs
// return data via their `auth.uid() IS NULL` bypass.

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    if (req.headers.get('x-cron-secret') === cronSecret) return true
    if (req.headers.get('Authorization') === `Bearer ${cronSecret}`) return true
  }
  // Fallback: an admin session may trigger a capture manually.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const admin = createAdminClient()
  const { data: profile } = await admin.from('user_profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin'
}

// Human week label in business-local time, e.g. "Jun 20".
function weekLabel(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', month: 'short', day: 'numeric',
  }).format(new Date())
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Companies that use Scoreboards = any with ≥1 user holding the section flag.
  const { data: profs, error: profErr } = await admin
    .from('user_profiles')
    .select('company_id')
    .eq('can_access_scoreboards', true)
  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 })
  const companies = [...new Set((profs ?? []).map(p => p.company_id).filter(Boolean) as string[])]

  const label = weekLabel()
  const capturedAt = new Date().toISOString()
  const results: { company: string; board: string; ok: boolean; error?: string }[] = []

  for (const company of companies) {
    for (const b of SCOREBOARDS) {
      try {
        const payload = await computeBoardPayload(admin, company, b.slug)
        const { error } = await admin
          .from('scoreboard_snapshots')
          .upsert(
            { company_id: company, board_slug: b.slug, label, payload, captured_at: capturedAt },
            { onConflict: 'company_id,board_slug,label' },
          )
        results.push({ company, board: b.slug, ok: !error, error: error?.message })
        if (error) console.error('[scoreboard-snapshot] upsert failed', company, b.slug, error.message)
      } catch (e) {
        const msg = String((e as Error).message || e)
        results.push({ company, board: b.slug, ok: false, error: msg })
        console.error('[scoreboard-snapshot] build failed', company, b.slug, msg)
      }
    }
  }

  const captured = results.filter(r => r.ok).length
  return NextResponse.json({ status: 'done', label, companies: companies.length, captured, results })
}
