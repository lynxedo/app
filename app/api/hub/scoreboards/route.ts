import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getGrantedBoardSlugs } from '@/lib/scoreboards/access'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/* Service-role client, used ONLY for the `scoreboard_*` RPCs below.
 *
 * ⚠⚠ Those functions are no longer executable by `authenticated`. Until
 * 2026-08-12 they were, and the only check inside them was "can you see
 * Reports or Scoreboards at all" — so a technician granted boards 1 and 2
 * could POST to /rest/v1/rpc and read every other board's data and every
 * report's, including per-person hours and labour cost. Proven live by
 * impersonating a technician in SQL. The per-board grant was enforced here in
 * the route and nowhere else.
 *
 * ⚠ So this route's `getGrantedBoardSlugs` check is now the ONLY gate on this
 * data. It must stay above every builder call. Table reads keep using the
 * caller's own client so RLS still scopes them.
 *
 * Lazily created: `createAdminClient()` reads env at call time, and evaluating
 * it at module scope would run during the build.
 */
let _rpcClient: ReturnType<typeof createAdminClient> | null = null
function rpcClient() {
  return (_rpcClient ??= createAdminClient())
}

/* GET /api/hub/scoreboards?board=7
 *
 * The payload for Retention & Churn — the one shipped board left. Main (1), WF (2),
 * IR (3), PW (4), Office (5) and Lead Sources (8) were retired on Sep 3 2026; their
 * builders and this file's date/dept helpers went with them, because every card they
 * drew now exists in the widget library behind /api/hub/scoreboards/widgets.
 *
 * Retention did NOT move, and the reason is the snapshots. This board takes no date
 * window at all — the RPC is asked for a YEAR — so a date picker could not stand in
 * for it. It also needs the freeze more than any other board did: the six months
 * already closed when the Jul 11 2026 snapshot was taken report FOUR more
 * cancellations today than that snapshot recorded (Feb 6→7, May 7→8, Jun 14→16;
 * 86% retention → 84.8%), because cancellations get entered late and reasons get
 * tagged later still. Re-running the numbers tells you what we believe now; only the
 * snapshot tells you what the board said the morning somebody acted on it.
 *
 * Data comes from the Hub's own synced tables (Jobber mirror + Recurring Services),
 * never Monday directly. Gated to admins OR a user granted this board.
 */
export async function GET(request: Request) {
  const res = await handleScoreboards(request)
  // Scoreboard data only changes on the nightly Jobber/Monday sync — let the
  // browser reuse a recent response for 5 min instead of recomputing each open.
  if (res.ok) res.headers.set('Cache-Control', 'private, max-age=300')
  return res
}

async function handleScoreboards(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_access_scoreboards')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  const isAdmin = profile.role === 'admin'
  if (!isAdmin && !profile.can_access_scoreboards) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const company = profile.company_id

  /* '7' is the only board this route serves now, and it is NOT defaulted to: a
   * request for a retired slug must 404 rather than quietly hand back Retention
   * under someone else's board name. */
  const board = new URL(request.url).searchParams.get('board')
  if (board !== '7') return NextResponse.json({ error: 'Unknown scoreboard' }, { status: 404 })

  // Per-board view grant (Admin -> Scoreboards). Admins bypass; non-admins must
  // be explicitly granted this board even when they have section access.
  if (!isAdmin) {
    const allowed = await getGrantedBoardSlugs(supabase, user.id)
    if (!allowed.includes(board)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sp = new URL(request.url).searchParams

  // ── Weekly snapshots (Friday-night capture) ──
  // List the snapshots available for this board (drives the rollback dropdown).
  if (sp.get('snapshots') === '1') {
    const { data, error } = await supabase
      .from('scoreboard_snapshots')
      .select('id, captured_at, label')
      .eq('company_id', company).eq('board_slug', board)
      .order('captured_at', { ascending: false })
      .limit(52)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ snapshots: data ?? [] })
  }
  // Render a stored snapshot instead of live — return the exact payload captured
  // that week, so the board renders precisely as it looked then.
  const snapshotId = sp.get('snapshot')
  if (snapshotId) {
    const { data, error } = await supabase
      .from('scoreboard_snapshots')
      .select('payload')
      .eq('id', snapshotId).eq('company_id', company).eq('board_slug', board)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })
    return NextResponse.json(data.payload)
  }

  return buildRetentionBoard(supabase, company)
}

/* Used by the Friday-night snapshot cron (../snapshot), which runs service-role
 * with no auth.uid() and so bypasses the grant check above on purpose. */
export async function computeBoardPayload(
  supabase: Awaited<ReturnType<typeof createClient>>,
  company: string,
  board: string,
): Promise<Record<string, unknown>> {
  if (board !== '7') throw new Error(`scoreboard ${board} has no builder`)
  const res = await buildRetentionBoard(supabase, company)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || `scoreboard ${board} build failed`)
  }
  return res.json()
}

// ── Board 7: Retention & Churn ───────────────────────────────────────────────
// Universe = the Recurring Services board (recurring_services), scoped to the
// CURRENT YEAR: Active/Upgraded/Downgraded rows + Cancelled rows whose
// cancel_date falls in the year. Cancellation reasons are normalized through
// churn_reasons/churn_reason_aliases (old Monday + Jobber spellings both map);
// unmapped reasons surface as churn_type 'Review', never silently dropped.
// All aggregation happens in the scoreboard_churn_summary RPC.
// Retention method = full-year book (see the churn_retention_by_year migration):
//   retention(Y) = 1 − cancels-during-Y ÷ services-on-the-book-at-any-point-in-Y.
// Works identically for any year, so the board can show the current year (YTD) as
// the headline and the prior year (full year) as a reminder. The prior-year figure
// matters because the Recurring Services board began in 2025 — there's no earlier
// start-of-year base, so a start-of-year cohort can't be computed for 2025.
type ChurnSummary = {
  year: number
  book_size: number; active_now: number; new_in_year: number
  churned_gross: number; churned_controllable: number
  churned_company_initiated: number; churned_uncontrollable: number; churned_review: number
  churned_annual_value: number; active_annual_value: number
  retention_pct: number | null; gross_churn_pct: number | null; controllable_churn_pct: number | null
  by_reason: { reason: string; churn_type: string; count: number; annual_value: number }[]
  by_type: { churn_type: string; count: number; annual_value: number }[]
  monthly: { month: string; gross: number; controllable: number }[]
}

async function buildRetentionBoard(supabase: Awaited<ReturnType<typeof createClient>>, company: string) {
  const year = new Date().getFullYear()
  const [{ data: cur, error }, { data: prev, error: prevErr }] = await Promise.all([
    rpcClient().rpc('scoreboard_churn_summary', { p_company_id: company, p_year: year }),
    rpcClient().rpc('scoreboard_churn_summary', { p_company_id: company, p_year: year - 1 }),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (prevErr) return NextResponse.json({ error: prevErr.message }, { status: 500 })
  const s = cur as unknown as ChurnSummary
  const p = prev as unknown as ChurnSummary
  // Prior full year is only worth showing once it actually has a book behind it.
  const prior = p.book_size > 0
    ? { year: p.year, retention_pct: p.retention_pct, book_size: p.book_size, churned_gross: p.churned_gross, churned_annual_value: p.churned_annual_value }
    : null

  // Owner-language callouts, computed server-side so snapshots freeze them too.
  const insights: string[] = []
  insights.push(
    `${year} YTD: kept ${s.retention_pct}% of the ${s.book_size} recurring services on the books this year (${s.churned_gross} cancelled).`,
  )
  if (prior && prior.retention_pct != null && s.retention_pct != null) {
    const delta = Math.round((s.retention_pct - prior.retention_pct) * 10) / 10
    insights.push(
      `Retention is ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta)} pts vs ${prior.year} full year (${prior.retention_pct}%) — note ${year} is only part-way through, so it will move as the year finishes.`,
    )
  }
  const ctrl = s.by_type.find(t => t.churn_type === 'Controllable')
  if (ctrl && ctrl.count > 0) {
    insights.push(
      `Controllable churn — the part we can fight — is ${s.churned_controllable} of ${s.churned_gross} cancels (~$${Math.round(ctrl.annual_value).toLocaleString()}/yr in lost value).`,
    )
  }
  if (s.monthly.length > 1) {
    const worst = [...s.monthly].sort((a, b) => b.gross - a.gross)[0]
    const label = new Date(worst.month + '-15').toLocaleString('en-US', { month: 'long' })
    insights.push(`Worst month: ${label} (${worst.gross} cancellations).`)
  }
  if (s.churned_review > 0) {
    insights.push(
      `${s.churned_review} cancellation${s.churned_review === 1 ? ' has' : 's have'} no usable reason — tag them on the Recurring Services board so they count toward the right bucket.`,
    )
  }

  return NextResponse.json({ asOf: new Date().toISOString(), ...s, prior, insights })
}

