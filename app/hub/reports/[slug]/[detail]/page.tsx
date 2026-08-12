import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canSeeReport, getReport } from '@/lib/reports/registry'
import { getDrilldown, type DrillColumn, type DrillRow } from '@/lib/reports/drilldowns'
import { resolveWindow } from '@/lib/scoreboards/widgets/windows'
import { formatCurrency } from '@/lib/format'

export const metadata = { title: 'Report detail' }
export const dynamic = 'force-dynamic'

/* The rows behind one number on a Report.
 *
 * A full page rather than a panel, so it can be linked, bookmarked and sent to
 * someone — "here is the list of unbilled jobs" is a thing people forward.
 *
 * The date range travels in the query string so returning to the report lands on
 * the same window the number was read in. Point-in-time datasets (AR, unbilled
 * work) ignore it and SAY SO on the page, rather than displaying a range they
 * never applied — a filter that silently does nothing is how a figure ends up
 * disagreeing with its own label.
 */

function fmtDate(v: string | number | null): string {
  if (!v) return '—'
  const d = new Date(`${String(v).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function fmtCell(col: DrillColumn, row: DrillRow): string {
  const v = row[col.key]
  if (v === null || v === undefined || v === '') return '—'
  switch (col.format) {
    case 'currency': return formatCurrency(Number(v))
    case 'number': return Number(v).toLocaleString()
    case 'date': return fmtDate(v)
    case 'days': {
      const n = Number(v)
      if (!Number.isFinite(n)) return '—'
      return n === 1 ? '1 day' : `${n.toLocaleString()} days`
    }
    default: return String(v)
  }
}

function isNumeric(col: DrillColumn): boolean {
  return col.format === 'currency' || col.format === 'number' || col.format === 'days'
}

export default async function ReportDetailPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string; detail: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug, detail } = await params
  const sp = await searchParams

  const report = getReport(slug)
  if (!report) notFound()

  const drill = getDrilldown(detail)
  // Reachability is checked against the REPORT, not just the key: a drill-down is
  // only openable from a report it actually belongs to.
  if (!drill || !drill.reports.includes(slug)) notFound()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_access_reports, company_id')
    .eq('id', user.id)
    .single()

  const perms = {
    isAdmin: profile?.role === 'admin',
    canAccessReports: profile?.can_access_reports === true,
  }
  // Same gate as the report itself — a drill-down must never be a side door into
  // data the report it belongs to is closed to.
  if (!canSeeReport(perms, slug)) redirect('/hub')
  if (!profile?.company_id) notFound()

  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v }
  const win = resolveWindow(one('range') ?? report.defaultRange, one('start'), one('end'))

  let rows: DrillRow[] = []
  let loadError: string | null = null
  try {
    rows = await drill.run({ supabase, companyId: profile.company_id, win })
  } catch (e) {
    loadError = e instanceof Error ? e.message : 'Could not load these rows'
  }

  const qs = new URLSearchParams()
  if (one('range')) qs.set('range', one('range') as string)
  if (one('start')) qs.set('start', one('start') as string)
  if (one('end')) qs.set('end', one('end') as string)
  const backHref = `/hub/reports/${slug}${qs.toString() ? `?${qs}` : ''}`

  const exportQs = new URLSearchParams(qs)
  exportQs.set('report', slug)
  exportQs.set('drill', detail)

  const totals = drill.columns.filter(c => c.format === 'currency')

  // The Hub shell hands each section a bare, overflow-hidden slot with no scroll of
  // its own. The reports index and WidgetBoardView each provide their own; this page
  // did not, so a drill-down longer than the viewport could not be scrolled — the
  // rows rendered but were unreachable, which reads as "the list is empty/broken".
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--t-well)] text-gray-200">
      <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
        <Link href={backHref} className="text-sm text-[var(--t-accent)] hover:underline">
          ← Back to {report.title}
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-semibold text-[var(--t-heading)]">{drill.title}</h1>
            <p className="mt-1 text-sm text-[var(--t-muted)] max-w-3xl">{drill.description}</p>
            <p className="mt-2 text-xs text-[var(--t-muted)]">
              {drill.pointInTime
                ? 'As of today — this figure is not affected by the report’s date range.'
                : `Range: ${win.label}`}
              {' · '}
              {rows.length.toLocaleString()} {rows.length === 1 ? 'row' : 'rows'}
            </p>
          </div>

          {rows.length > 0 && (
            <a
              href={`/api/hub/reports/export?${exportQs}`}
              className="flex-none rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-[#fff] hover:opacity-90"
            >
              ⬇ Download for Excel
            </a>
          )}
        </div>

        {loadError ? (
          <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-[var(--t-body)]">
            Could not load these rows: {loadError}
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-6 text-sm text-[var(--t-muted)]">
            Nothing here right now — and that is the answer, not a loading failure.
          </div>
        ) : (
          <>
            {/* Wide tables scroll inside their own box so the page never scrolls sideways. */}
            <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-white/[0.04] text-[var(--t-muted)]">
                    {drill.columns.map(c => (
                      <th
                        key={c.key}
                        className={`px-3 py-2 font-semibold whitespace-nowrap ${
                          (c.align ?? (isNumeric(c) ? 'right' : 'left')) === 'right' ? 'text-right' : 'text-left'
                        }`}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t border-white/[0.06] text-[var(--t-body)]">
                      {drill.columns.map(c => (
                        <td
                          key={c.key}
                          className={`px-3 py-2 ${
                            (c.align ?? (isNumeric(c) ? 'right' : 'left')) === 'right'
                              ? 'text-right tabular-nums whitespace-nowrap'
                              : 'text-left'
                          }`}
                        >
                          {fmtCell(c, r)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {totals.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-white/15 bg-white/[0.04] font-semibold text-[var(--t-heading)]">
                      {drill.columns.map((c, idx) => (
                        <td
                          key={c.key}
                          className={`px-3 py-2 ${isNumeric(c) ? 'text-right tabular-nums' : 'text-left'}`}
                        >
                          {c.format === 'currency'
                            ? formatCurrency(rows.reduce((s, r) => s + Number(r[c.key] ?? 0), 0))
                            : idx === 0 ? `${rows.length.toLocaleString()} total` : ''}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
