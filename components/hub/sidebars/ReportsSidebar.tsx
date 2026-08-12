'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import SidebarShell from './SidebarShell'
import { REPORTS, type ReportMeta } from '@/lib/reports/registry'

/**
 * Navigation for the Reports section.
 *
 * Reports are grouped by `section` in the same order the index page uses, so the
 * two never disagree about where a report lives. The grouping is derived from the
 * registry rather than listed here — adding a report to REPORTS puts it in both
 * places with no second edit.
 */

/** Section order. Anything with an unlisted section sorts to the end, still visible. */
const SECTION_ORDER: ReportMeta['section'][] = [
  'Overview', 'Money', 'Customers', 'Sales', 'Operations', 'People',
]

function ReportRow({
  href, icon, label, active, onClose,
}: {
  href: string
  icon: string
  label: string
  active: boolean
  onClose?: () => void
}) {
  return (
    <Link
      href={href}
      onClick={() => onClose?.()}
      className={`flex items-center gap-2 px-2 py-2 md:py-1.5 rounded-lg text-lg md:text-sm transition-colors ${
        active
          ? 'bg-sky-500/[0.16] text-white font-semibold ring-1 ring-inset ring-sky-400/30'
          : 'text-white/70 hover:bg-white/[0.06] hover:text-white'
      }`}
    >
      <span className="flex-none text-base leading-none" aria-hidden>{icon}</span>
      <span className="truncate flex-1">{label}</span>
    </Link>
  )
}

export default function ReportsSidebar({
  onClose,
  onDesktopCollapse,
}: {
  onClose?: () => void
  onDesktopCollapse?: () => void
}) {
  const pathname = usePathname() ?? ''

  const sections = SECTION_ORDER
    .map(name => ({ name, reports: REPORTS.filter(r => r.section === name) }))
    .filter(s => s.reports.length > 0)

  // Anything whose section isn't in SECTION_ORDER still gets a home rather than
  // vanishing — a new section name should look unstyled, not missing.
  const listed = new Set(SECTION_ORDER as string[])
  const orphans = REPORTS.filter(r => !listed.has(r.section))

  return (
    <SidebarShell title="Reports" onClose={onClose} onDesktopCollapse={onDesktopCollapse}>
      <div className="space-y-1">
        <ReportRow
          href="/hub/reports"
          icon="📚"
          label="All reports"
          active={pathname === '/hub/reports'}
          onClose={onClose}
        />
      </div>

      {[...sections, ...(orphans.length ? [{ name: 'Other' as const, reports: orphans }] : [])].map(section => (
        <div key={section.name}>
          <div className="px-2 mb-1">
            <span className="text-sm md:text-xs font-semibold text-[var(--t-heading)] uppercase tracking-wider">
              {section.name}
            </span>
          </div>
          <div className="space-y-1">
            {section.reports.map(r => {
              const href = `/hub/reports/${r.slug}`
              return (
                <ReportRow
                  key={r.slug}
                  href={href}
                  icon={r.icon}
                  label={r.title}
                  // A drill-down page lives under the report, so it keeps its
                  // parent highlighted rather than clearing the whole section.
                  active={pathname === href || pathname.startsWith(href + '/')}
                  onClose={onClose}
                />
              )
            })}
          </div>
        </div>
      ))}
    </SidebarShell>
  )
}
