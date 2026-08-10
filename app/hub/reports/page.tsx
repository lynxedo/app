import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { REPORTS, SECTION_ORDER, canSeeReports, reportsForUser } from '@/lib/reports/registry'

export const metadata = { title: 'Reports' }
export const dynamic = 'force-dynamic'

/* The Reports index.
 *
 * Two kinds of thing live here for now:
 *  - PRESET reports built from the widget library (the direction of travel)
 *  - the two original operational tables, kept until their replacements exist
 *
 * ⚠ Gate changed: this page was hardcoded to `role === 'admin'`. It now uses
 * `can_access_reports` with an admin bypass, so no admin loses anything and
 * non-admins gain access only when someone grants it in Admin → People.
 */

const LEGACY = [
  {
    href: '/hub/reports/visits',
    title: 'Visit Report',
    desc: 'Completed visits by technician — counts, value, recurring vs one-off, drill-down per tech.',
  },
  {
    href: '/hub/reports/customers',
    title: 'Customer Report',
    desc: 'Every customer and property with a column-picker — toggle any field, including custom fields. Search, sort, export to CSV.',
  },
]

export default async function ReportsIndexPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_access_reports')
    .eq('id', user.id)
    .single()

  const perms = {
    isAdmin: profile?.role === 'admin',
    canAccessReports: profile?.can_access_reports === true,
  }
  if (!canSeeReports(perms)) redirect('/hub')

  const mine = reportsForUser(perms)
  const sections = SECTION_ORDER
    .map(s => ({ section: s, items: mine.filter(r => r.section === s) }))
    .filter(g => g.items.length > 0)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--t-well)] text-gray-200">
      <header className="flex items-center gap-3.5 border-b border-sky-400/15 bg-gradient-to-br from-[var(--t-panel)] to-[var(--t-sidebar)] px-5 py-4 max-md:pl-14">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-sky-400 text-lg">📊</div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-sky-50">Reports</h1>
          <div className="text-[13px] text-sky-300">Ready-made views of the standard numbers</div>
        </div>
      </header>

      <div className="mx-auto max-w-[1100px] px-5 pb-12 pt-2">
        {sections.map(g => (
          <section key={g.section}>
            <div className="mb-3 mt-7 text-[11px] font-semibold uppercase tracking-[1.2px] text-gray-500 first:mt-4">
              {g.section}
            </div>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
              {g.items.map(r => (
                <Link
                  key={r.slug}
                  href={`/hub/reports/${r.slug}`}
                  className="relative overflow-hidden rounded-2xl border border-sky-400/[0.12] bg-gradient-to-br from-[var(--t-panel)] to-[var(--t-sidebar)] p-4 transition-colors hover:border-sky-400/40"
                >
                  <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-sky-500 via-sky-400 to-transparent" />
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-base">{r.icon}</span>
                    <span className="font-semibold text-gray-100">{r.title}</span>
                  </div>
                  <div className="text-[13px] leading-snug text-gray-400">{r.subtitle}</div>
                </Link>
              ))}
            </div>
          </section>
        ))}

        <div className="mb-3 mt-8 text-[11px] font-semibold uppercase tracking-[1.2px] text-gray-500">
          Operational tables
        </div>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {LEGACY.map(r => (
            <Link
              key={r.href}
              href={r.href}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-white/25 hover:bg-white/[0.06]"
            >
              <div className="mb-1 font-semibold text-gray-100">{r.title}</div>
              <div className="text-[13px] leading-snug text-gray-400">{r.desc}</div>
            </Link>
          ))}
        </div>

        {REPORTS.length === 1 ? (
          <p className="mt-8 text-[12px] leading-relaxed text-gray-500">
            More reports are on the way — revenue and invoicing, clients, sales, crew productivity and job
            profitability. Each one arrives as a ready-made view you can open without any setup.
          </p>
        ) : null}
      </div>
    </div>
  )
}
