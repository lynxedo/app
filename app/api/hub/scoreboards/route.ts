import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getGrantedBoardSlugs } from '@/lib/scoreboards/access'

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
type TechRevRow = RevRow & { tech_external_id: string }

// SB3 — group a single batched scoreboard_techs_revenue result by tech, so the
// per-tech loops read from a map instead of each issuing its own RPC (N+1 → 1).
function groupRevByTech(rows: TechRevRow[]): Map<string, RevRow[]> {
  const m = new Map<string, RevRow[]>()
  for (const r of rows) {
    let arr = m.get(r.tech_external_id)
    if (!arr) { arr = []; m.set(r.tech_external_id, arr) }
    arr.push(r)
  }
  return m
}

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

  const board = new URL(request.url).searchParams.get('board') ?? '1'
  if (board !== '1' && board !== '2' && board !== '3' && board !== '4' && board !== '5') return NextResponse.json({ error: 'Unknown scoreboard' }, { status: 404 })

  // Per-board view grant (Admin -> Scoreboards). Admins bypass; non-admins must
  // be explicitly granted this board even when they have section access.
  if (!isAdmin) {
    const allowed = await getGrantedBoardSlugs(supabase, user.id)
    if (!allowed.includes(board)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Boards 2–5 have their own payloads; board 1 falls through below.
  if (board === '2') return buildWfBoard(supabase, company)
  if (board === '3') return buildIrBoard(supabase, company)
  if (board === '4') return buildPwBoard(supabase, company)
  if (board === '5') return buildOfficeBoard(supabase, company)

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

// ── Board 2: WF Weed & Fert ──────────────────────────────────────────────────
// All from Hub-synced tables: WF visit revenue (Jobber sync), Jobber recurring
// book (jobs + line_items + recurring_program_definitions), leads (Monday mirror),
// time_entries (timesheet). KPI metrics reflect the active Jobber recurring book.
//   - WF weekly visit revenue, trailing 6 weeks        (scoreboard_visit_revenue 'week', WF dept)
//   - WF monthly visit revenue, trailing 4 months      (scoreboard_visit_revenue 'month', WF dept)
//   - WF job count / avg value / annual value          (Jobber recurring book, WF dept)
//   - % with PHC / % with BWP / # with an add-on       (Jobber line_items, WF aux items)
//   - Base-program mix (Basic/Complete/Plus/Recovery)  (recurring_program_definitions.display_name)
//   - Per WF technician: weekly revenue by dept, $/hr last week, weekly sales $
const TIER_ORDER = ['Basic', 'Complete', 'Plus', 'Recovery', 'Other'] as const
const round1 = (n: number) => Math.round(n * 10) / 10

// Map a base_program_sold name to a lawn-health tier slice. No program name
// contains two of these keywords, so first-match precedence is unambiguous.
function wfTier(program: string): string {
  const s = (program || '').toLowerCase()
  if (s.includes('basic')) return 'Basic'
  if (s.includes('complete')) return 'Complete'
  if (s.includes('plus')) return 'Plus'
  if (s.includes('recovery') || s.includes('root rot')) return 'Recovery'
  return 'Other'
}

type TechRow = { employee_id: string; jobber_external_id: string | null; display_name: string; salesperson_name: string }
type LeadLite = { salesperson: string | null; stage: string | null; annual_value: number | null; sold_date: string | null }
type RecurringJobBook = { clientId: string; dept: string; displayName: string; hasPHC: boolean; hasBWP: boolean; annualValue: number }
type RecurringBookRow = { client_id: string; dept_prefix: string; display_name: string; has_phc: boolean; has_bwp: boolean; annual_value: number | string | null }

// Fetches the active Jobber recurring book (jobs + line_items + recurring_program_definitions),
// one row per (active recurring job, base-program dept), with test accounts excluded.
// Replaces recurring_services (Monday mirror) reads for boards 2–4. The join +
// test-account filter happen in the scoreboard_recurring_book SECURITY DEFINER RPC
// so the route never has to .in() hundreds of job ids (URL blowup → "fetch failed")
// or hit Supabase's 1000-row read cap on the ~2k job line items.
async function fetchJobberRecurringBook(
  supabase: Awaited<ReturnType<typeof createClient>>,
  company: string
): Promise<RecurringJobBook[] | { error: string }> {
  const { data, error } = await supabase.rpc('scoreboard_recurring_book', { p_company_id: company })
  if (error) return { error: error.message }
  return ((data ?? []) as RecurringBookRow[]).map(r => ({
    clientId: r.client_id,
    dept: r.dept_prefix,
    displayName: r.display_name,
    hasPHC: r.has_phc,
    hasBWP: r.has_bwp,
    annualValue: Number(r.annual_value) || 0,
  }))
}

async function buildWfBoard(supabase: Awaited<ReturnType<typeof createClient>>, company: string) {
  const t = chicagoToday()
  const todayStr = ymd(utcNoon(t.y, t.m, t.d))
  const currentMonday = mondayOf(utcNoon(t.y, t.m, t.d))
  const sixWeekStart = addDays(currentMonday, -35)
  const sixWeekStartStr = ymd(sixWeekStart)
  const weekStarts: Date[] = Array.from({ length: 6 }, (_, i) => addDays(sixWeekStart, i * 7))
  const weekKeys = weekStarts.map(ymd)
  const weekLabels = weekStarts.map(weekLabel)
  const weekIndex = new Map(weekKeys.map((k, i) => [k, i]))
  // Last complete week = the 5th of 6 buckets (index 4); index 5 is the current partial week.
  const LAST_WK = 4
  const lastWeekStartStr = weekKeys[LAST_WK]
  const lastWeekEndStr = ymd(addDays(weekStarts[LAST_WK], 6))

  // Trailing 4 calendar months incl. current.
  const monthBuckets: { key: string; label: string }[] = []
  for (let i = 3; i >= 0; i--) {
    let mm = t.m - i, yy = t.y
    while (mm <= 0) { mm += 12; yy -= 1 }
    monthBuckets.push({
      key: `${yy}-${String(mm).padStart(2, '0')}`,
      label: MONTH_ABBR[mm - 1] + (yy !== t.y ? ` '${String(yy).slice(2)}` : ''),
    })
  }
  const fourMonthStart = `${monthBuckets[0].key}-01`
  const monthIndex = new Map(monthBuckets.map((b, i) => [b.key, i]))

  // ── Fetch everything in parallel ──
  const bookPromise = fetchJobberRecurringBook(supabase, company)
  const [wfWeekRes, wfMonthRes, techRes, leadsRes] = await Promise.all([
    supabase.rpc('scoreboard_visit_revenue', { p_company_id: company, p_start: sixWeekStartStr, p_end: todayStr, p_bucket: 'week' }),
    supabase.rpc('scoreboard_visit_revenue', { p_company_id: company, p_start: fourMonthStart, p_end: todayStr, p_bucket: 'month' }),
    supabase.rpc('scoreboard_board_technicians', { p_company_id: company, p_board_slug: '2' }),
    supabase.from('leads').select('salesperson, stage, annual_value, sold_date').eq('company_id', company),
  ])
  if (wfWeekRes.error) return NextResponse.json({ error: wfWeekRes.error.message }, { status: 500 })
  if (wfMonthRes.error) return NextResponse.json({ error: wfMonthRes.error.message }, { status: 500 })
  if (techRes.error) return NextResponse.json({ error: techRes.error.message }, { status: 500 })
  if (leadsRes.error) return NextResponse.json({ error: leadsRes.error.message }, { status: 500 })
  const bookOrErr = await bookPromise
  if ('error' in bookOrErr) return NextResponse.json({ error: bookOrErr.error }, { status: 500 })
  const book = bookOrErr

  // ── WF visit revenue (WF department only) ──
  const weeklyRevenue = weekKeys.map(() => 0)
  for (const r of (wfWeekRes.data ?? []) as RevRow[]) {
    if (r.dept === 'WF') { const wi = weekIndex.get(r.bucket); if (wi !== undefined) weeklyRevenue[wi] += Number(r.total) || 0 }
  }
  const monthlyRevenue = monthBuckets.map(() => 0)
  for (const r of (wfMonthRes.data ?? []) as RevRow[]) {
    if (r.dept === 'WF') { const mi = monthIndex.get(r.bucket.slice(0, 7)); if (mi !== undefined) monthlyRevenue[mi] += Number(r.total) || 0 }
  }

  // ── WF recurring KPIs + program mix (Jobber active book) ──
  const wfJobs = book.filter(r => r.dept === 'WF')
  const totalJobs = wfJobs.length
  const annualValue = wfJobs.reduce((s, r) => s + r.annualValue, 0)
  const avgValue = totalJobs ? annualValue / totalJobs : 0
  const phcCount = wfJobs.filter(r => r.hasPHC).length
  const bwpCount = wfJobs.filter(r => r.hasBWP).length
  const addonCount = wfJobs.filter(r => r.hasPHC || r.hasBWP).length

  const mixMap = new Map<string, number>()
  for (const r of wfJobs) { const tier = wfTier(r.displayName); mixMap.set(tier, (mixMap.get(tier) || 0) + 1) }
  const programMix = TIER_ORDER.map(tier => ({ label: tier, n: mixMap.get(tier) || 0 })).filter(x => x.n > 0)

  // ── Technicians (explicitly assigned in Admin -> Scoreboards, board 2) ──
  const techRows = (techRes.data ?? []) as TechRow[]
  const leads = (leadsRes.data ?? []) as LeadLite[]

  // SB3 — fetch ALL techs' revenue + hours in 2 RPCs instead of 2 per tech.
  const wfTechExtIds = techRows.map(t => t.jobber_external_id).filter((x): x is string => !!x)
  const [wfRevRes, wfHoursRes] = await Promise.all([
    wfTechExtIds.length
      ? supabase.rpc('scoreboard_techs_revenue', { p_company_id: company, p_start: sixWeekStartStr, p_end: todayStr, p_bucket: 'week', p_tech_external_ids: wfTechExtIds })
      : Promise.resolve({ data: [], error: null }),
    supabase.rpc('scoreboard_techs_hours', { p_company_id: company, p_start: lastWeekStartStr, p_end: lastWeekEndStr, p_employee_ids: techRows.map(t => t.employee_id) }),
  ])
  const wfRevByTech = groupRevByTech((wfRevRes.data ?? []) as TechRevRow[])
  const wfHoursByEmp = new Map<string, number>()
  for (const h of (wfHoursRes.data ?? []) as Array<{ employee_id: string; hours: number }>) wfHoursByEmp.set(h.employee_id, Number(h.hours) || 0)

  const techs = techRows.map((tech) => {
    // Weekly revenue by dept — full visit revenue attributed when this tech is assigned.
    const deptWeekly: Record<string, number[]> = {}
    let lastWeekRevenue = 0
    if (tech.jobber_external_id) {
      for (const r of wfRevByTech.get(tech.jobber_external_id) ?? []) {
        const wi = weekIndex.get(r.bucket); if (wi === undefined) continue
        const d = (DEPTS as readonly string[]).includes(r.dept ?? '') ? (r.dept as string) : 'Other'
        ;(deptWeekly[d] ??= weekKeys.map(() => 0))[wi] += Number(r.total) || 0
        if (wi === LAST_WK) lastWeekRevenue += Number(r.total) || 0
      }
    }
    const techDepts = DEPTS.filter(d => deptWeekly[d]?.some(v => v > 0))

    // $/hour for the last complete week (revenue ÷ timesheet hours).
    const hours = wfHoursByEmp.get(tech.employee_id) ?? 0

    // Sales $ by week — closed-won annual value where this person is the lead-tracker salesperson.
    const salesValue = weekKeys.map(() => 0)
    const who = (tech.salesperson_name || '').toLowerCase()
    for (const l of leads) {
      if (l.stage !== 'closed_won' || !l.sold_date || (l.salesperson || '').toLowerCase() !== who) continue
      const mk = ymd(mondayOf(utcNoon(Number(l.sold_date.slice(0, 4)), Number(l.sold_date.slice(5, 7)), Number(l.sold_date.slice(8, 10)))))
      const wi = weekIndex.get(mk); if (wi !== undefined) salesValue[wi] += Number(l.annual_value) || 0
    }

    return {
      name: tech.display_name,
      depts: techDepts,
      weekly: { labels: weekLabels, data: Object.fromEntries(techDepts.map(d => [d, deptWeekly[d]])) },
      perHour: {
        revenue: Math.round(lastWeekRevenue),
        hours: round1(hours),
        rate: hours > 0 ? Math.round(lastWeekRevenue / hours) : 0,
        weekLabel: `${weekStarts[LAST_WK].getUTCMonth() + 1}/${weekStarts[LAST_WK].getUTCDate()}`,
      },
      sales: { labels: weekLabels, value: salesValue.map(v => Math.round(v)) },
    }
  })

  return NextResponse.json({
    asOf: new Date().toISOString(),
    kpis: {
      totalJobs,
      avgValue: Math.round(avgValue),
      annualValue: Math.round(annualValue),
      phcCount, phcPct: totalJobs ? round1((phcCount / totalJobs) * 100) : 0,
      bwpCount, bwpPct: totalJobs ? round1((bwpCount / totalJobs) * 100) : 0,
      addonCount, addonPct: totalJobs ? round1((addonCount / totalJobs) * 100) : 0,
    },
    weeklyRevenue: { labels: weekLabels, data: weeklyRevenue.map(v => Math.round(v)) },
    monthlyRevenue: { labels: monthBuckets.map(b => b.label), data: monthlyRevenue.map(v => Math.round(v)) },
    programMix,
    techs,
  })
}

// ── Board 3: IR Irrigation ───────────────────────────────────────────────────
// All from Hub-synced tables: IR visit revenue (Jobber sync), Jobber recurring
// book (jobs + line_items + recurring_program_definitions), leads (Monday mirror),
// time_entries (timesheet). Technicians assigned explicitly (scoreboard_technicians).
//   - Active IR Gold customers + their annual value   (Jobber recurring book, IR Gold tiers)
//   - Average repair ticket value                      (scoreboard_ir_repair_ticket RPC, trailing 12mo)
//   - IR visit revenue weekly (6wk) + monthly (4mo), stacked by technician
//   - Rachio sold / week + Irrigation Gold plans sold / week  (leads, trailing 6wk)
//   - Per IR technician: $/hour last complete week     (visit revenue ÷ timesheet hours)
type LeadIr = { service: string[] | null; base_program_sold: string | null; stage: string | null; sold_date: string | null }

async function buildIrBoard(supabase: Awaited<ReturnType<typeof createClient>>, company: string) {
  const t = chicagoToday()
  const todayStr = ymd(utcNoon(t.y, t.m, t.d))
  const currentMonday = mondayOf(utcNoon(t.y, t.m, t.d))
  const sixWeekStart = addDays(currentMonday, -35)
  const sixWeekStartStr = ymd(sixWeekStart)
  const weekStarts: Date[] = Array.from({ length: 6 }, (_, i) => addDays(sixWeekStart, i * 7))
  const weekKeys = weekStarts.map(ymd)
  const weekLabels = weekStarts.map(weekLabel)
  const weekIndex = new Map(weekKeys.map((k, i) => [k, i]))
  // Last complete week = the 5th of 6 buckets (index 4); index 5 is the current partial week.
  const LAST_WK = 4
  const lastWeekStartStr = weekKeys[LAST_WK]
  const lastWeekEndStr = ymd(addDays(weekStarts[LAST_WK], 6))

  // Trailing 4 calendar months incl. current.
  const monthBuckets: { key: string; label: string }[] = []
  for (let i = 3; i >= 0; i--) {
    let mm = t.m - i, yy = t.y
    while (mm <= 0) { mm += 12; yy -= 1 }
    monthBuckets.push({
      key: `${yy}-${String(mm).padStart(2, '0')}`,
      label: MONTH_ABBR[mm - 1] + (yy !== t.y ? ` '${String(yy).slice(2)}` : ''),
    })
  }
  const fourMonthStart = `${monthBuckets[0].key}-01`
  const monthIndex = new Map(monthBuckets.map((b, i) => [b.key, i]))

  // Repair-ticket window: trailing 12 months.
  const yearAgoStr = ymd(addDays(utcNoon(t.y, t.m, t.d), -365))

  const bookPromise = fetchJobberRecurringBook(supabase, company)
  const [techRes, leadsRes, repairRes, irWeekRes, irMonthRes] = await Promise.all([
    supabase.rpc('scoreboard_board_technicians', { p_company_id: company, p_board_slug: '3' }),
    supabase.from('leads').select('service, base_program_sold, stage, sold_date').eq('company_id', company),
    supabase.rpc('scoreboard_ir_repair_ticket', { p_company_id: company, p_start: yearAgoStr, p_end: todayStr }),
    supabase.rpc('scoreboard_visit_revenue', { p_company_id: company, p_start: sixWeekStartStr, p_end: todayStr, p_bucket: 'week' }),
    supabase.rpc('scoreboard_visit_revenue', { p_company_id: company, p_start: fourMonthStart, p_end: todayStr, p_bucket: 'month' }),
  ])
  if (techRes.error) return NextResponse.json({ error: techRes.error.message }, { status: 500 })
  if (leadsRes.error) return NextResponse.json({ error: leadsRes.error.message }, { status: 500 })
  if (repairRes.error) return NextResponse.json({ error: repairRes.error.message }, { status: 500 })
  if (irWeekRes.error) return NextResponse.json({ error: irWeekRes.error.message }, { status: 500 })
  if (irMonthRes.error) return NextResponse.json({ error: irMonthRes.error.message }, { status: 500 })
  const bookOrErr = await bookPromise
  if ('error' in bookOrErr) return NextResponse.json({ error: bookOrErr.error }, { status: 500 })
  const book = bookOrErr

  // ── KPI 1+2: active IR Gold book (Jobber source — includes all Gold tiers) ──
  // Count DISTINCT customers (a customer with multiple Gold jobs is one member).
  const goldJobs = book.filter(r => r.dept === 'IR' && r.displayName.toLowerCase().includes('gold'))
  const activeGold = new Set(goldJobs.map(r => r.clientId)).size
  const goldAnnualValue = goldJobs.reduce((s, r) => s + r.annualValue, 0)

  // ── KPI 3: average repair ticket (trailing 12 months) ──
  const rt = ((repairRes.data ?? []) as Array<{ ticket_count: number; avg_value: number | null; median_value: number | null }>)[0]
  const repairAvg = Math.round(Number(rt?.avg_value) || 0)
  const repairMedian = Math.round(Number(rt?.median_value) || 0)
  const repairCount = Number(rt?.ticket_count) || 0

  // ── Total IR visit revenue per bucket (for the "Other/Unassigned" stack) ──
  const totalWeekIr = weekKeys.map(() => 0)
  for (const r of (irWeekRes.data ?? []) as RevRow[]) {
    if (r.dept === 'IR') { const wi = weekIndex.get(r.bucket); if (wi !== undefined) totalWeekIr[wi] += Number(r.total) || 0 }
  }
  const totalMonthIr = monthBuckets.map(() => 0)
  for (const r of (irMonthRes.data ?? []) as RevRow[]) {
    if (r.dept === 'IR') { const mi = monthIndex.get(r.bucket.slice(0, 7)); if (mi !== undefined) totalMonthIr[mi] += Number(r.total) || 0 }
  }

  // ── Per-technician IR revenue (weekly + monthly) + $/hour last complete week ──
  const techRows = (techRes.data ?? []) as TechRow[]
  // SB3 — 3 batched RPCs (week revenue, month revenue, hours) for ALL techs
  // instead of 3 per tech.
  const irTechExtIds = techRows.map(t => t.jobber_external_id).filter((x): x is string => !!x)
  const [irWeekByTechRes, irMonthByTechRes, irHoursRes] = await Promise.all([
    irTechExtIds.length
      ? supabase.rpc('scoreboard_techs_revenue', { p_company_id: company, p_start: sixWeekStartStr, p_end: todayStr, p_bucket: 'week', p_tech_external_ids: irTechExtIds })
      : Promise.resolve({ data: [], error: null }),
    irTechExtIds.length
      ? supabase.rpc('scoreboard_techs_revenue', { p_company_id: company, p_start: fourMonthStart, p_end: todayStr, p_bucket: 'month', p_tech_external_ids: irTechExtIds })
      : Promise.resolve({ data: [], error: null }),
    supabase.rpc('scoreboard_techs_hours', { p_company_id: company, p_start: lastWeekStartStr, p_end: lastWeekEndStr, p_employee_ids: techRows.map(t => t.employee_id) }),
  ])
  const irWeekByTech = groupRevByTech((irWeekByTechRes.data ?? []) as TechRevRow[])
  const irMonthByTech = groupRevByTech((irMonthByTechRes.data ?? []) as TechRevRow[])
  const irHoursByEmp = new Map<string, number>()
  for (const h of (irHoursRes.data ?? []) as Array<{ employee_id: string; hours: number }>) irHoursByEmp.set(h.employee_id, Number(h.hours) || 0)

  const techs = techRows.map((tech) => {
    const weekly = weekKeys.map(() => 0)     // IR-only, for the stacked chart
    const monthly = monthBuckets.map(() => 0)
    let lastWeekRevenue = 0                   // ALL depts last week, for $/hr ("visit revenue they had")
    if (tech.jobber_external_id) {
      for (const r of irWeekByTech.get(tech.jobber_external_id) ?? []) {
        const wi = weekIndex.get(r.bucket); if (wi === undefined) continue
        if (r.dept === 'IR') weekly[wi] += Number(r.total) || 0
        if (wi === LAST_WK) lastWeekRevenue += Number(r.total) || 0
      }
      for (const r of irMonthByTech.get(tech.jobber_external_id) ?? []) {
        if (r.dept !== 'IR') continue
        const mi = monthIndex.get(r.bucket.slice(0, 7)); if (mi !== undefined) monthly[mi] += Number(r.total) || 0
      }
    }
    const hours = irHoursByEmp.get(tech.employee_id) ?? 0
    return {
      name: tech.display_name,
      weekly: weekly.map(v => Math.round(v)),
      monthly: monthly.map(v => Math.round(v)),
      perHour: {
        revenue: Math.round(lastWeekRevenue),
        hours: round1(hours),
        rate: hours > 0 ? Math.round(lastWeekRevenue / hours) : 0,
        weekLabel: `${weekStarts[LAST_WK].getUTCMonth() + 1}/${weekStarts[LAST_WK].getUTCDate()}`,
      },
    }
  })

  // "Other / Unassigned IR" stack = total IR revenue minus the tracked techs (when material).
  const otherWeekly = totalWeekIr.map((tot, i) => Math.max(0, Math.round(tot - techs.reduce((s, tk) => s + tk.weekly[i], 0))))
  const otherMonthly = totalMonthIr.map((tot, i) => Math.max(0, Math.round(tot - techs.reduce((s, tk) => s + tk.monthly[i], 0))))

  // ── Rachio sold + Irrigation Gold plans sold per week (trailing 6 weeks) ──
  const rachioSold = weekKeys.map(() => 0)
  const goldSold = weekKeys.map(() => 0)
  for (const l of (leadsRes.data ?? []) as LeadIr[]) {
    if (!l.sold_date || (l.stage !== 'closed_won' && l.stage !== 'upsells')) continue
    const sd = l.sold_date
    const mk = ymd(mondayOf(utcNoon(Number(sd.slice(0, 4)), Number(sd.slice(5, 7)), Number(sd.slice(8, 10)))))
    const wi = weekIndex.get(mk); if (wi === undefined) continue
    const svc = (l.service ?? []).map(s => (s || '').toLowerCase())
    const base = (l.base_program_sold || '').toLowerCase()
    if (svc.some(s => s.includes('rachio'))) rachioSold[wi]++
    if (base.includes('gold') || svc.some(s => s.includes('gold'))) goldSold[wi]++
  }

  return NextResponse.json({
    asOf: new Date().toISOString(),
    kpis: { activeGold, goldAnnualValue: Math.round(goldAnnualValue), repairAvg, repairMedian, repairCount },
    weeklyByTech: {
      labels: weekLabels,
      techs: techs.map(tk => ({ name: tk.name, data: tk.weekly })),
      other: otherWeekly.some(v => v > 1) ? otherWeekly : null,
    },
    monthlyByTech: {
      labels: monthBuckets.map(b => b.label),
      techs: techs.map(tk => ({ name: tk.name, data: tk.monthly })),
      other: otherMonthly.some(v => v > 1) ? otherMonthly : null,
    },
    rachioSold: { labels: weekLabels, data: rachioSold },
    goldSold: { labels: weekLabels, data: goldSold },
    techs: techs.map(tk => ({ name: tk.name, perHour: tk.perHour })),
  })
}

// ── Board 4: PW Pet Waste ────────────────────────────────────────────────────
// All from Hub-synced tables: PW visit revenue (Jobber sync), Jobber recurring
// book (jobs + line_items + recurring_program_definitions), time_entries (timesheet).
// Technicians assigned explicitly via scoreboard_technicians (same as board 3).
//   - Active PW customer count + total annual value       (Jobber recurring book, PW dept)
//   - PW visit revenue weekly (6wk) + monthly (4mo), stacked by technician
//   - Per PW technician: weekly + monthly revenue by dept (ALL depts), $/hr last week

async function buildPwBoard(supabase: Awaited<ReturnType<typeof createClient>>, company: string) {
  const t = chicagoToday()
  const todayStr = ymd(utcNoon(t.y, t.m, t.d))
  const currentMonday = mondayOf(utcNoon(t.y, t.m, t.d))
  const sixWeekStart = addDays(currentMonday, -35)
  const sixWeekStartStr = ymd(sixWeekStart)
  const weekStarts: Date[] = Array.from({ length: 6 }, (_, i) => addDays(sixWeekStart, i * 7))
  const weekKeys = weekStarts.map(ymd)
  const weekLabels = weekStarts.map(weekLabel)
  const weekIndex = new Map(weekKeys.map((k, i) => [k, i]))
  const LAST_WK = 4
  const lastWeekStartStr = weekKeys[LAST_WK]
  const lastWeekEndStr = ymd(addDays(weekStarts[LAST_WK], 6))

  const monthBuckets: { key: string; label: string }[] = []
  for (let i = 3; i >= 0; i--) {
    let mm = t.m - i, yy = t.y
    while (mm <= 0) { mm += 12; yy -= 1 }
    monthBuckets.push({
      key: `${yy}-${String(mm).padStart(2, '0')}`,
      label: MONTH_ABBR[mm - 1] + (yy !== t.y ? ` '${String(yy).slice(2)}` : ''),
    })
  }
  const fourMonthStart = `${monthBuckets[0].key}-01`
  const monthIndex = new Map(monthBuckets.map((b, i) => [b.key, i]))

  const bookPromise = fetchJobberRecurringBook(supabase, company)
  const [techRes, pwWeekRes, pwMonthRes] = await Promise.all([
    supabase.rpc('scoreboard_board_technicians', { p_company_id: company, p_board_slug: '4' }),
    supabase.rpc('scoreboard_visit_revenue', { p_company_id: company, p_start: sixWeekStartStr, p_end: todayStr, p_bucket: 'week' }),
    supabase.rpc('scoreboard_visit_revenue', { p_company_id: company, p_start: fourMonthStart, p_end: todayStr, p_bucket: 'month' }),
  ])
  if (techRes.error) return NextResponse.json({ error: techRes.error.message }, { status: 500 })
  if (pwWeekRes.error) return NextResponse.json({ error: pwWeekRes.error.message }, { status: 500 })
  if (pwMonthRes.error) return NextResponse.json({ error: pwMonthRes.error.message }, { status: 500 })
  const bookOrErr = await bookPromise
  if ('error' in bookOrErr) return NextResponse.json({ error: bookOrErr.error }, { status: 500 })
  const book = bookOrErr

  // ── KPIs: active PW book (Jobber source) ──
  // A 2x/week customer is entered as two identical day-split jobs (one per
  // service day) but is ONE membership. Count distinct customers, and value the
  // membership ONCE: each job's annual_value already = per-visit price × the
  // plan's yearly visits (e.g. $20 × 104 = $2,080 for 2x/week), so summing both
  // day-jobs would double it. Collapse identical (customer, plan, value) jobs;
  // genuinely distinct plans for one customer still sum.
  const pwJobs = book.filter(r => r.dept === 'PW')
  const activeCustomers = new Set(pwJobs.map(r => r.clientId)).size
  const pwSeen = new Set<string>()
  let annualValue = 0
  for (const r of pwJobs) {
    const key = `${r.clientId}|${r.displayName}|${r.annualValue}`
    if (pwSeen.has(key)) continue
    pwSeen.add(key)
    annualValue += r.annualValue
  }

  // ── Total PW visit revenue per bucket (for the "Other/Unassigned" stack) ──
  const totalWeekPw = weekKeys.map(() => 0)
  for (const r of (pwWeekRes.data ?? []) as RevRow[]) {
    if (r.dept === 'PW') { const wi = weekIndex.get(r.bucket); if (wi !== undefined) totalWeekPw[wi] += Number(r.total) || 0 }
  }
  const totalMonthPw = monthBuckets.map(() => 0)
  for (const r of (pwMonthRes.data ?? []) as RevRow[]) {
    if (r.dept === 'PW') { const mi = monthIndex.get(r.bucket.slice(0, 7)); if (mi !== undefined) totalMonthPw[mi] += Number(r.total) || 0 }
  }

  // ── Per-technician: PW-slice (stacked chart) + all-dept (performance section) + $/hr ──
  const techRows = (techRes.data ?? []) as TechRow[]
  // SB3 — 3 batched RPCs for ALL techs instead of 3 per tech.
  const pwTechExtIds = techRows.map(t => t.jobber_external_id).filter((x): x is string => !!x)
  const [pwWeekByTechRes, pwMonthByTechRes, pwHoursRes] = await Promise.all([
    pwTechExtIds.length
      ? supabase.rpc('scoreboard_techs_revenue', { p_company_id: company, p_start: sixWeekStartStr, p_end: todayStr, p_bucket: 'week', p_tech_external_ids: pwTechExtIds })
      : Promise.resolve({ data: [], error: null }),
    pwTechExtIds.length
      ? supabase.rpc('scoreboard_techs_revenue', { p_company_id: company, p_start: fourMonthStart, p_end: todayStr, p_bucket: 'month', p_tech_external_ids: pwTechExtIds })
      : Promise.resolve({ data: [], error: null }),
    supabase.rpc('scoreboard_techs_hours', { p_company_id: company, p_start: lastWeekStartStr, p_end: lastWeekEndStr, p_employee_ids: techRows.map(t => t.employee_id) }),
  ])
  const pwWeekByTech = groupRevByTech((pwWeekByTechRes.data ?? []) as TechRevRow[])
  const pwMonthByTech = groupRevByTech((pwMonthByTechRes.data ?? []) as TechRevRow[])
  const pwHoursByEmp = new Map<string, number>()
  for (const h of (pwHoursRes.data ?? []) as Array<{ employee_id: string; hours: number }>) pwHoursByEmp.set(h.employee_id, Number(h.hours) || 0)

  const techs = techRows.map((tech) => {
    const weeklyPw = weekKeys.map(() => 0)
    const monthlyPw = monthBuckets.map(() => 0)
    const deptWeekly: Record<string, number[]> = {}
    const deptMonthly: Record<string, number[]> = {}
    let lastWeekRevenue = 0

    if (tech.jobber_external_id) {
      for (const r of pwWeekByTech.get(tech.jobber_external_id) ?? []) {
        const wi = weekIndex.get(r.bucket); if (wi === undefined) continue
        const d = (DEPTS as readonly string[]).includes(r.dept ?? '') ? (r.dept as string) : 'Other'
        ;(deptWeekly[d] ??= weekKeys.map(() => 0))[wi] += Number(r.total) || 0
        if (r.dept === 'PW') weeklyPw[wi] += Number(r.total) || 0
        if (wi === LAST_WK) lastWeekRevenue += Number(r.total) || 0
      }
      for (const r of pwMonthByTech.get(tech.jobber_external_id) ?? []) {
        const mi = monthIndex.get(r.bucket.slice(0, 7)); if (mi === undefined) continue
        const d = (DEPTS as readonly string[]).includes(r.dept ?? '') ? (r.dept as string) : 'Other'
        ;(deptMonthly[d] ??= monthBuckets.map(() => 0))[mi] += Number(r.total) || 0
        if (r.dept === 'PW') monthlyPw[mi] += Number(r.total) || 0
      }
    }

    const hours = pwHoursByEmp.get(tech.employee_id) ?? 0
    const depts = DEPTS.filter(d => deptWeekly[d]?.some(v => v > 0))
    const monthDepts = DEPTS.filter(d => deptMonthly[d]?.some(v => v > 0))

    return {
      name: tech.display_name,
      weeklyPw: weeklyPw.map(v => Math.round(v)),
      monthlyPw: monthlyPw.map(v => Math.round(v)),
      depts,
      monthDepts,
      weekly: { labels: weekLabels, data: Object.fromEntries(depts.map(d => [d, deptWeekly[d]])) },
      monthly: { labels: monthBuckets.map(b => b.label), data: Object.fromEntries(monthDepts.map(d => [d, deptMonthly[d]])) },
      perHour: {
        revenue: Math.round(lastWeekRevenue),
        hours: round1(hours),
        rate: hours > 0 ? Math.round(lastWeekRevenue / hours) : 0,
        weekLabel: `${weekStarts[LAST_WK].getUTCMonth() + 1}/${weekStarts[LAST_WK].getUTCDate()}`,
      },
    }
  })

  const otherWeekly = totalWeekPw.map((tot, i) => Math.max(0, Math.round(tot - techs.reduce((s, tk) => s + tk.weeklyPw[i], 0))))
  const otherMonthly = totalMonthPw.map((tot, i) => Math.max(0, Math.round(tot - techs.reduce((s, tk) => s + tk.monthlyPw[i], 0))))

  return NextResponse.json({
    asOf: new Date().toISOString(),
    kpis: { activeCustomers, annualValue: Math.round(annualValue) },
    weeklyByTech: {
      labels: weekLabels,
      techs: techs.map(tk => ({ name: tk.name, data: tk.weeklyPw })),
      other: otherWeekly.some(v => v > 1) ? otherWeekly : null,
    },
    monthlyByTech: {
      labels: monthBuckets.map(b => b.label),
      techs: techs.map(tk => ({ name: tk.name, data: tk.monthlyPw })),
      other: otherMonthly.some(v => v > 1) ? otherMonthly : null,
    },
    techs: techs.map(tk => ({
      name: tk.name,
      depts: tk.depts,
      monthDepts: tk.monthDepts,
      weekly: tk.weekly,
      monthly: tk.monthly,
      perHour: tk.perHour,
    })),
  })
}

// ── Board 5: Office ──────────────────────────────────────────────────────────
// 100% from the Lead Tracker (`leads`, Monday mirror). No Jobber / recurring /
// timesheet data. Three charts + six KPI cards:
//   - Top 5 lead sources this month, stacked Closed Won vs Closed Lost (count)
//   - Company sales per week, trailing 6wk, stacked Closed Won $ + Upsells $
//   - Katherine's monthly sales, trailing 4mo, stacked Closed Won $ vs Upsells $
//   - KPIs: leads last week · close rate YTD · close rate last week ·
//           Katherine close rate last week · Katherine sales $ last week ·
//           company sales YTD
// Conventions: "sales $" = closed_won + upsells annual value (Main-board parity).
//   - CLOSE RATE = won/(won+lost), upsells excluded, windowed by the lead COHORT
//     (lead_creation_date) to match the Monday Office board — i.e. "of the leads
//     that came IN during the window, what share are won." (Monday windows rates
//     by the cohort, not the decision date; a loss decided last week but created
//     the prior week belongs to the prior week's cohort.)
//   - DOLLAR TOTALS (sales $, weekly sales chart) window by sold_date — what
//     actually closed in the period. Same split Monday itself uses.
// Dates are America/Chicago, weeks ISO-Monday. "Katherine" is stored as "Kathryn".
const KATHERINE = 'kathryn'
type LeadOffice = {
  stage: string | null; lead_source: string | null; salesperson: string | null
  annual_value: number | null; sold_date: string | null; lead_creation_date: string | null
}

async function buildOfficeBoard(supabase: Awaited<ReturnType<typeof createClient>>, company: string) {
  const t = chicagoToday()
  const yearStart = `${t.y}-01-01`
  const thisMonthPrefix = `${t.y}-${String(t.m).padStart(2, '0')}`

  // Trailing 6 ISO weeks incl. current (matches the other boards).
  const currentMonday = mondayOf(utcNoon(t.y, t.m, t.d))
  const sixWeekStart = addDays(currentMonday, -35)
  const weekStarts: Date[] = Array.from({ length: 6 }, (_, i) => addDays(sixWeekStart, i * 7))
  const weekKeys = weekStarts.map(ymd)
  const weekLabels = weekStarts.map(weekLabel)
  const weekIndex = new Map(weekKeys.map((k, i) => [k, i]))

  // Last COMPLETE ISO week = the Mon–Sun before the current (partial) week.
  const lastWeekStart = ymd(addDays(currentMonday, -7))
  const lastWeekEnd = ymd(addDays(currentMonday, -1))
  const lastWeekLabel = `${weekStarts[4].getUTCMonth() + 1}/${weekStarts[4].getUTCDate()}`
  const inLastWeek = (d: string | null) => !!d && d >= lastWeekStart && d <= lastWeekEnd

  // Trailing 4 calendar months incl. current.
  const monthBuckets: { key: string; label: string }[] = []
  for (let i = 3; i >= 0; i--) {
    let mm = t.m - i, yy = t.y
    while (mm <= 0) { mm += 12; yy -= 1 }
    monthBuckets.push({
      key: `${yy}-${String(mm).padStart(2, '0')}`,
      label: MONTH_ABBR[mm - 1] + (yy !== t.y ? ` '${String(yy).slice(2)}` : ''),
    })
  }
  const monthIndex = new Map(monthBuckets.map((b, i) => [b.key, i]))

  const { data: leads, error: leadsErr } = await supabase
    .from('leads')
    .select('stage, lead_source, salesperson, annual_value, sold_date, lead_creation_date')
    .eq('company_id', company)
  if (leadsErr) return NextResponse.json({ error: leadsErr.message }, { status: 500 })

  // ── Accumulators ──
  // Chart 1: lead sources this month (by lead_creation_date) → won / lost counts.
  const srcWon = new Map<string, number>()
  const srcLost = new Map<string, number>()
  // Chart 2: company sales per week (by sold_date) → won / upsell $ value.
  const salesWonVal = weekKeys.map(() => 0)
  const salesUpVal = weekKeys.map(() => 0)
  // Chart 3: Katherine monthly sales (by sold_date) → won / upsell $ value.
  const kWonVal = monthBuckets.map(() => 0)
  const kUpVal = monthBuckets.map(() => 0)
  // KPIs
  let leadsLastWeek = 0
  let ytdWon = 0, ytdLost = 0
  let lwWon = 0, lwLost = 0
  let kLwWon = 0, kLwLost = 0
  let kSalesLastWeek = 0
  let companySalesYtd = 0

  const weekOf = (d: string) =>
    weekIndex.get(ymd(mondayOf(utcNoon(Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10))))))

  for (const l of (leads ?? []) as LeadOffice[]) {
    const stage = l.stage
    const val = Number(l.annual_value) || 0
    const isKath = (l.salesperson || '').trim().toLowerCase() === KATHERINE
    const cd = l.lead_creation_date
    const isWon = stage === 'closed_won', isLost = stage === 'closed_lost'
    const isSale = stage === 'closed_won' || stage === 'upsells'

    // Chart 1 — lead sources this month (by lead_creation_date)
    if (cd && cd.startsWith(thisMonthPrefix)) {
      const src = (l.lead_source || 'Unknown').trim() || 'Unknown'
      if (isWon) srcWon.set(src, (srcWon.get(src) ?? 0) + 1)
      else if (isLost) srcLost.set(src, (srcLost.get(src) ?? 0) + 1)
    }

    // ── Close-rate cohorts — windowed by lead_creation_date (matches Monday) ──
    if (cd) {
      if (inLastWeek(cd)) leadsLastWeek++                     // KPI 4 — leads in last week
      if (cd >= yearStart) {                                  // KPI 5 — close rate YTD
        if (isWon) ytdWon++; else if (isLost) ytdLost++
      }
      if (inLastWeek(cd)) {                                   // KPIs 6/7 — close rate last week
        if (isWon) { lwWon++; if (isKath) kLwWon++ }
        else if (isLost) { lwLost++; if (isKath) kLwLost++ }
      }
    }

    // ── Dollar totals + weekly chart — windowed by sold_date (what closed) ──
    if (!l.sold_date) continue
    const sd = l.sold_date

    // Chart 2 — company sales per week, $ value (trailing 6wk)
    if (isSale) {
      const wi = weekOf(sd)
      if (wi !== undefined) { if (isWon) salesWonVal[wi] += val; else salesUpVal[wi] += val }
    }
    // Chart 3 — Katherine monthly sales $ (trailing 4mo)
    if (isKath && isSale) {
      const mi = monthIndex.get(sd.slice(0, 7))
      if (mi !== undefined) { if (isWon) kWonVal[mi] += val; else kUpVal[mi] += val }
    }
    // KPI 9 — company sales YTD $ (won + upsells)
    if (sd >= yearStart && isSale) companySalesYtd += val
    // KPI 8 — Katherine sales $ last week (won + upsells)
    if (inLastWeek(sd) && isKath && isSale) kSalesLastWeek += val
  }

  // Chart 1 — top 5 sources by total decided volume (won + lost)
  const allSrc = new Set<string>([...srcWon.keys(), ...srcLost.keys()])
  const leadSources = [...allSrc]
    .map(src => ({ src, won: srcWon.get(src) ?? 0, lost: srcLost.get(src) ?? 0 }))
    .sort((a, b) => (b.won + b.lost) - (a.won + a.lost))
    .slice(0, 5)

  const rate = (won: number, lost: number) => (won + lost > 0 ? Math.round((won / (won + lost)) * 1000) / 10 : 0)

  return NextResponse.json({
    asOf: new Date().toISOString(),
    kpis: {
      leadsLastWeek,
      closeRateYtd: rate(ytdWon, ytdLost), ytdWon, ytdLost,
      closeRateLastWeek: rate(lwWon, lwLost), lwWon, lwLost,
      kCloseRateLastWeek: rate(kLwWon, kLwLost), kLwWon, kLwLost,
      kSalesLastWeek: Math.round(kSalesLastWeek),
      companySalesYtd: Math.round(companySalesYtd),
      lastWeekLabel,
    },
    leadSources,                                                   // [{ src, won, lost }]
    companyWeekly: { labels: weekLabels, won: salesWonVal.map(v => Math.round(v)), upsells: salesUpVal.map(v => Math.round(v)) }, // $ value
    katherineMonthly: { labels: monthBuckets.map(b => b.label), won: kWonVal.map(v => Math.round(v)), upsells: kUpVal.map(v => Math.round(v)) },
  })
}
