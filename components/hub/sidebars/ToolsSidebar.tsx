'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import SidebarShell from './SidebarShell'
import { CatalogIcon, type CatalogId } from '../railCatalog'

// Single row helper — renders the catalog SVG glyph + a label, with
// active-state highlighting that matches the Hub sidebar's link rows.
function ToolRow({
  href,
  iconId,
  label,
  prefixMatch,
  onClose,
}: {
  href: string
  iconId: CatalogId
  label: string
  prefixMatch?: boolean
  onClose?: () => void
}) {
  const pathname = usePathname() ?? ''
  // prefixMatch needs the trailing '/' so /hub/daily-log doesn't false-match
  // /hub/daily-log-v2 (and similar sibling-route cases).
  const isActive = prefixMatch
    ? (pathname === href || pathname.startsWith(href + '/'))
    : pathname === href
  return (
    <Link
      href={href}
      onClick={() => onClose?.()}
      className={`flex items-center gap-2 px-2 py-2 md:py-1.5 rounded-lg text-lg md:text-sm transition-colors ${
        isActive
          ? 'bg-sky-500/[0.16] text-white font-semibold ring-1 ring-inset ring-sky-400/30'
          : 'text-white/70 hover:bg-white/[0.06] hover:text-white'
      }`}
    >
      <span className="text-white/70 flex-none w-5 h-5 flex items-center justify-center">
        <CatalogIcon id={iconId} />
      </span>
      <span className="truncate flex-1">{label}</span>
    </Link>
  )
}

export default function ToolsSidebar({
  isAdmin,
  canAccessRouting,
  canAccessTracker,
  canAccessLawn,
  canAccessZoneSizer,
  canAccessCallLog,
  canAccessCallLog2,
  canAccessBooks,
  canAccessFleet,
  canAccessTimesheet,
  canAccessDialer,
  canAccessMarketing,
  canAdminMarketing,
  canAccessForms,
  canAccessScoreboards,
  canAccessPricer,
  onClose,
  onDesktopCollapse,
}: {
  isAdmin: boolean
  canAccessRouting: boolean
  canAccessTracker: boolean
  canAccessLawn: boolean
  canAccessZoneSizer: boolean
  canAccessCallLog: boolean
  canAccessCallLog2?: boolean
  canAccessBooks: boolean
  canAccessFleet: boolean
  canAccessTimesheet: boolean
  canAccessDialer: boolean
  canAccessMarketing: boolean
  canAdminMarketing: boolean
  canAccessForms?: boolean
  canAccessScoreboards?: boolean
  canAccessPricer?: boolean
  onClose?: () => void
  onDesktopCollapse?: () => void
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    operations: true,
    sales: true,
    communications: true,
    finance: true,
    marketing: true,
    pages: true,
  })
  const toggle = (k: string) => setOpen(p => ({ ...p, [k]: !p[k] }))

  const hasOperations = canAccessRouting || canAccessFleet || canAccessTimesheet || canAccessForms || canAccessScoreboards || isAdmin
  const hasSales = canAccessTracker || canAccessLawn || canAccessZoneSizer || canAccessPricer
  const hasComms = true // Contacts is always shown under Communications; Dialer + Call Log gated below
  const hasFinance = canAccessBooks

  return (
    <SidebarShell title="Tools" onClose={onClose} onDesktopCollapse={onDesktopCollapse}>
      {hasOperations && (
        <div>
          <button onClick={() => toggle('operations')} className="w-full flex items-center gap-1 px-2 mb-1 group">
            <Chevron open={open.operations} />
            <span className="text-sm md:text-xs font-semibold text-amber-300 uppercase tracking-wider">Operations</span>
          </button>
          {open.operations && (
            <>
              {canAccessRouting && <ToolRow href="/hub/routing" iconId="routing" label="Routing" prefixMatch onClose={onClose} />}
              {canAccessTimesheet && <ToolRow href="/hub/timesheet" iconId="time-records" label="Timesheet" prefixMatch onClose={onClose} />}
              {canAccessForms && <ToolRow href="/hub/forms" iconId="forms" label="Forms" prefixMatch onClose={onClose} />}
              {canAccessFleet && <ToolRow href="/hub/fleet" iconId="fleet" label="Fleet" prefixMatch onClose={onClose} />}
              {isAdmin && <ToolRow href="/hub/reports" iconId="reports" label="Reports" prefixMatch onClose={onClose} />}
              {canAccessScoreboards && <ToolRow href="/hub/scoreboards" iconId="scoreboards" label="Scoreboards" prefixMatch onClose={onClose} />}
            </>
          )}
        </div>
      )}

      {hasSales && (
        <div>
          <button onClick={() => toggle('sales')} className="w-full flex items-center gap-1 px-2 mb-1 group">
            <Chevron open={open.sales} />
            <span className="text-sm md:text-xs font-semibold text-amber-300 uppercase tracking-wider">Sales</span>
          </button>
          {open.sales && (
            <>
              {canAccessTracker && <ToolRow href="/hub/tracker" iconId="tracker" label="Tracker" prefixMatch onClose={onClose} />}
              {canAccessPricer && <ToolRow href="/hub/pricer" iconId="pricer" label="Pricer" prefixMatch onClose={onClose} />}
              {canAccessLawn && <ToolRow href="/hub/lawn" iconId="lawn" label="Lawn Sizer" onClose={onClose} />}
              {canAccessZoneSizer && <ToolRow href="/hub/zone-sizer" iconId="zone-sizer" label="Zone Sizer" onClose={onClose} />}
            </>
          )}
        </div>
      )}

      {hasComms && (
        <div>
          <button onClick={() => toggle('communications')} className="w-full flex items-center gap-1 px-2 mb-1 group">
            <Chevron open={open.communications} />
            <span className="text-sm md:text-xs font-semibold text-amber-300 uppercase tracking-wider">Communications</span>
          </button>
          {open.communications && (
            <>
              {canAccessDialer && <ToolRow href="/hub/dialer" iconId="dialer" label="Dialer" prefixMatch onClose={onClose} />}
              {canAccessCallLog && <ToolRow href="/hub/call-log" iconId="call-log" label="Call Log" prefixMatch onClose={onClose} />}
              {canAccessCallLog2 && <ToolRow href="/hub/call-log2" iconId="call-log2" label="Call Log 2" prefixMatch onClose={onClose} />}
              <ToolRow href="/hub/contacts" iconId="contacts" label="Contacts" prefixMatch onClose={onClose} />
            </>
          )}
        </div>
      )}

      {hasFinance && (
        <div>
          <button onClick={() => toggle('finance')} className="w-full flex items-center gap-1 px-2 mb-1 group">
            <Chevron open={open.finance} />
            <span className="text-sm md:text-xs font-semibold text-amber-300 uppercase tracking-wider">Finance</span>
          </button>
          {open.finance && (
            <>
              {canAccessBooks && <ToolRow href="/hub/books" iconId="books" label="Books" prefixMatch onClose={onClose} />}
            </>
          )}
        </div>
      )}

      {canAccessMarketing && (
        <div>
          <button onClick={() => toggle('marketing')} className="w-full flex items-center gap-1 px-2 mb-1 group">
            <Chevron open={open.marketing} />
            <span className="text-sm md:text-xs font-semibold text-amber-300 uppercase tracking-wider">Marketing</span>
          </button>
          {open.marketing && (
            <>
              <ToolRow href="/hub/marketing/social" iconId="marketing" label="Social" onClose={onClose} />
              {(isAdmin || canAdminMarketing) && (
                <ToolRow href="/hub/admin/marketing" iconId="marketing" label="Admin: Marketing" onClose={onClose} />
              )}
            </>
          )}
        </div>
      )}

      <div>
        <button onClick={() => toggle('pages')} className="w-full flex items-center gap-1 px-2 mb-1 group">
          <Chevron open={open.pages} />
          <span className="text-sm md:text-xs font-semibold text-amber-300 uppercase tracking-wider">Pages</span>
        </button>
        {open.pages && (
          <>
            <ToolRow href="/hub/pages/company-news" iconId="company-news" label="Company News" onClose={onClose} />
            <ToolRow href="/hub/files" iconId="files" label="Files" onClose={onClose} />
            <ToolRow href="/hub/pesticide-records" iconId="pesticide-records" label="Products Used" prefixMatch onClose={onClose} />
          </>
        )}
      </div>
    </SidebarShell>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3 h-3 text-white/30 transition-transform ${open ? '' : '-rotate-90'}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}
