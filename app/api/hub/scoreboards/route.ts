import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET /api/hub/scoreboards?board=1
// Returns the full payload for a scoreboard. All data is sourced from the Hub's
// own synced tables (Jobber mirror + Lead Tracker + Recurring Services) — never
// Monday directly. Gated to admins OR users with can_access_scoreboards.
//
// Board 1 metrics:
//   - YTD visit revenue by month, stacked by dept       (scoreboard_visit_revenue RPC, 'month')
//   - Trailing 6-week visit revenue, stacked by dept     (same RPC, 'week')
//   - Last month visit revenue by dept                   (derived from the monthly result)
//   - Upsells vs New Sales by month                       (leads: closed_won vs upsells × annual_value)
//   - Top 3 lead sources this month                       (leads.lead_source × lead_creation_date)
//   - Close rate, trailing 6 weeks                        (leads: closed_won vs closed_lost × sold_date)
//   - Recurring retention                                 (recurring_services.cancelled_status)

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// Canonical stacking order (matches the mockup): WF, IR, PW, MO, Other.
const DEPTS = ['WF', 'IR', 'PW', 'MO', 'Other'] as const

// ── Date helpers (business-local = America/Chicago) ──────────────────────────
function chicagoToday(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const get = (t: string) => Number(parts.find(p => p.type === t)!.value)
  return { y: get('year'), m: get('month'), d: get('day') }
}
// A UTC Date anchored at noon for a Y-M-D calendar date — safe for ±day math.
function utcNoon(y: number, m: number, d: number) { return new Date(Date.UTC(y, m - 1, d, 12)) }
function addDays(dt: Date, n: number) { return new Date(dt.getTime() + n * 86400000) }
function ymd(dt: Date) { return dt.toISOString().slice(0, 10) }
// Monday of the ISO week containing dt (matches Postgres date_trunc('week')).
function mondayOf(dt: Date): Date {
  const dow = dt.getUTCDay() // 0=Sun..6=Sat
  return addDays(dt, dow === 0 ? -6 : 1 - dow)
}
function weekLabel(dt: Date) { return `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}` }

type RevRow = { bucket: string; dept: string | null; total: number | string | null }

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_access_scoreboards')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  if (profile.role !== 'admin' && !profile.can_access_scoreboards) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const company = profile.company_id

  const board = new URL(request.url).searchParams.get('board') ?? '1'
  if (board !== '1') return NextResponse.json({ error: 'Unknown scoreboard' }, { status: 404 })

  // ── Date windows ──
  const t = chicagoToday()
  const todayStr = ymd(utcNoon(t.y, t.m, t.d))
  const yearStart = `${t.y}-01-01`
  const currentMonday = mondayOf(utcNoon(t.y, t.m, t.d))
  const sixWeekStart = addDays(currentMonday, -35)             // 6 week-buckets incl. current
  const sixWeekStartStr = ymd(sixWeekStart)
  const weekStarts: Date[] = Array.from({ length: 6 }, (_, i) => addDays(sixWeekStart, i * 7))
  const weekKeys = weekStarts.map(ymd)
  const weekLabels = weekStarts.map(weekLabel)

  // ── 1+2+3: visit revenue (monthly YTD + weekly trailing-6) ──
  const [monthlyRes, weeklyRes] = await Promise.all([
    supabase.rpc('scoreboard_visit_revenue', { p_company_id: company, p_start: yearStart, p_end: todayStr, p_bucket: 'month' }),
    supabase.rpc('scoreboard_visit_revenue', { p_company_id: company, p_start: sixWeekStartStr, p_end: todayStr, p_bucket: 'week' }),
  ])
  if (monthlyRes.error) return NextResponse.json({ error: monthlyRes.error.message }, { status: 500 })
  if (weeklyRes.error) return NextResponse.json({ error: weeklyRes.error.message }, { status: 500 })

  const norm = (d: string | null) => (DEPTS as readonly string[]).includes(d ?? '') ? (d as string) : 'Other'

  // Monthly: Jan → current month
  const monthIdx = Array.from({ length: t.m }, (_, i) => i) // 0..(m-1)
  const ytdData: Record<string, number[]> = Object.fromEntries(DEPTS.map(dpt => [dpt, monthIdx.map(() => 0)]))
  let ytdTotal = 0
  for (const r of (monthlyRes.data ?? []) as RevRow[]) {
    const mi = Number(r.bucket.slice(5, 7)) - 1
    const val = Number(r.total) || 0
    if (mi >= 0 && mi < t.m) { ytdData[norm(r.dept)][mi] += val; ytdTotal += val }
  }

  // Weekly: map onto the 6 canonical Monday buckets
  const weekIndex = new Map(weekKeys.map((k, i) => [k, i]))
  const weeklyData: Record<string, number[]> = Object.fromEntries(DEPTS.map(dpt => [dpt, weekKeys.map(() => 0)]))
  for (const r of (weeklyRes.data ?? []) as RevRow[]) {
    const wi = weekIndex.get(r.bucket)
    if (wi !== undefined) weeklyData[norm(r.dept)][wi] += Number(r.total) || 0
  }

  // Last month (derived from monthly result): previous calendar month if in-year, else skip
  const prevMonthIdx = t.m - 2 // 0-based index of month before current
  const lastMonth = prevMonthIdx >= 0
    ? DEPTS.map(dpt => ({ dept: dpt, total: ytdData[dpt][prevMonthIdx] })).filter(x => x.total > 0).sort((a, b) => b.total - a.total)
    : []
  const lastMonthTotal = lastMonth.reduce((s, x) => s + x.total, 0)
  const lastMonthLabel = prevMonthIdx >= 0 ? `${MONTH_ABBR[prevMonthIdx]} ${t.y}` : ''

  // ── 4+5+7: lead tracker ──
  const { data: leads, error: leadsErr } = await supabase
    .from('leads')
    .select('stage, lead_source, annual_value, sold_date, lead_creation_date')
    .eq('company_id', company)
  if (leadsErr) return NextResponse.json({ error: leadsErr.message }, { status: 500 })

  // Upsells vs New Sales — by sold_date month, current year
  const salesWon = monthIdx.map(() => 0)
  const salesUp = monthIdx.map(() => 0)
  // Lead sources — this calendar month, by lead_creation_date
  const sourceCounts = new Map<string, number>()
  const thisMonthPrefix = `${t.y}-${String(t.m).padStart(2, '0')}`
  // Close rate — won vs lost by sold_date week, 6-week window
  const closeWon = weekKeys.map(() => 0)
  const closeTotal = weekKeys.map(() => 0)
  let ytdNewSalesCount = 0
  let ytdNewSalesValue = 0

  for (const l of (leads ?? []) as Array<{ stage: string | null; lead_source: string | null; annual_value: number | null; sold_date: string | null; lead_creation_date: string | null }>) {
    const val = Number(l.annual_value) || 0
    // Sales by month + YTD new-sales KPI (sold this year)
    if (l.sold_date && l.sold_date >= yearStart) {
      const mi = Number(l.sold_date.slice(5, 7)) - 1
      if (mi >= 0 && mi < t.m) {
        if (l.stage === 'closed_won') { salesWon[mi] += val; ytdNewSalesCount++; ytdNewSalesValue += val }
        else if (l.stage === 'upsells') { salesUp[mi] += val; ytdNewSalesCount++; ytdNewSalesValue += val }
      }
    }
    // Lead sources this month
    if (l.lead_creation_date && l.lead_creation_date.startsWith(thisMonthPrefix)) {
      const src = (l.lead_source || 'Unknown').trim() || 'Unknown'
      sourceCounts.set(src, (sourceCounts.get(src) ?? 0) + 1)
    }
    // Close rate — won/lost decided in the 6-week window
    if ((l.stage === 'closed_won' || l.stage === 'closed_lost') && l.sold_date) {
      const sd = l.sold_date
      const mk = ymd(mondayOf(utcNoon(Number(sd.slice(0, 4)), Number(sd.slice(5, 7)), Number(sd.slice(8, 10)))))
      const wi = weekIndex.get(mk)
      if (wi !== undefined) { closeTotal[wi]++; if (l.stage === 'closed_won') closeWon[wi]++ }
    }
  }

  const leadSources = [...sourceCounts.entries()]
    .map(([src, n]) => ({ src, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)

  // ── 6: recurring retention ──
  const { data: recurring, error: recErr } = await supabase
    .from('recurring_services')
    .select('cancelled_status')
    .eq('company_id', company)
  if (recErr) return NextResponse.json({ error: recErr.message }, { status: 500 })

  let active = 0, upgraded = 0, downgraded = 0, cancelled = 0
  for (const r of (recurring ?? []) as Array<{ cancelled_status: string | null }>) {
    switch ((r.cancelled_status || '').toLowerCase()) {
      case 'cancelled': cancelled++; break
      case 'upgraded': upgraded++; break
      case 'downgraded': downgraded++; break
      default: active++; break // Active + any non-cancel state
    }
  }
  const recTotal = active + upgraded + downgraded + cancelled
  const retentionRate = recTotal > 0 ? ((recTotal - cancelled) / recTotal) * 100 : 0

  // Only surface departments that actually have revenue, so an empty "Other"
  // (or any unused dept) never shows up in the legend/stack.
  const activeDepts = DEPTS.filter(d =>
    (ytdData[d]?.some(v => v > 0)) ||
    (weeklyData[d]?.some(v => v > 0)) ||
    lastMonth.some(x => x.dept === d)
  )

  return NextResponse.json({
    asOf: new Date().toISOString(),
    depts: activeDepts,
    kpis: {
      ytdRevenue: Math.round(ytdTotal),
      lastMonthRevenue: Math.round(lastMonthTotal),
      lastMonthLabel,
      retentionRate: Math.round(retentionRate * 10) / 10,
      activeRecurring: active,
      ytdNewSalesCount,
      ytdNewSalesValue: Math.round(ytdNewSalesValue),
    },
    ytdByMonth: { labels: monthIdx.map(i => MONTH_ABBR[i]), data: ytdData },
    weekly: { labels: weekLabels, data: weeklyData },
    lastMonth: { label: lastMonthLabel, rows: lastMonth },
    sales: { labels: monthIdx.map(i => MONTH_ABBR[i]), won: salesWon, upsells: salesUp },
    leadSources,
    closeRate: weekLabels.map((wk, i) => ({ week: wk, won: closeWon[i], total: closeTotal[i] })),
    retention: { active, upgraded, downgraded, cancelled, total: recTotal, rate: Math.round(retentionRate * 10) / 10 },
  })
}
