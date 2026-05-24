'use client'

import { useState } from 'react'
import SidebarShell, { SidebarLinkRow } from './SidebarShell'

export default function ToolsSidebar({
  isAdmin,
  canAccessRouting,
  canAccessTracker,
  canAccessLawn,
  canAccessCallLog,
  canAccessBooks,
  canAccessFleet,
  canAccessTimesheet,
  onClose,
}: {
  isAdmin: boolean
  canAccessRouting: boolean
  canAccessTracker: boolean
  canAccessLawn: boolean
  canAccessCallLog: boolean
  canAccessBooks: boolean
  canAccessFleet: boolean
  canAccessTimesheet: boolean
  onClose?: () => void
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    operations: true,
    sales: true,
    communications: true,
    finance: true,
    pages: true,
  })
  const toggle = (k: string) => setOpen(p => ({ ...p, [k]: !p[k] }))

  const hasOperations = canAccessRouting || canAccessFleet || canAccessTimesheet || isAdmin
  const hasSales = canAccessTracker || canAccessLawn
  const hasComms = canAccessCallLog
  const hasFinance = canAccessBooks

  return (
    <SidebarShell title="Tools" onClose={onClose}>
      {hasOperations && (
        <div>
          <button onClick={() => toggle('operations')} className="w-full flex items-center gap-1 px-2 mb-1 group">
            <Chevron open={open.operations} />
            <span className="text-sm md:text-xs font-semibold text-amber-300 uppercase tracking-wider">Operations</span>
          </button>
          {open.operations && (
            <>
              {canAccessRouting && <SidebarLinkRow href="/hub/routing" icon="⚡" label="Routing" prefixMatch onClose={onClose} />}
              {canAccessTimesheet && <SidebarLinkRow href="/hub/timesheet" icon="⏱" label="Timesheet" prefixMatch onClose={onClose} />}
              {canAccessFleet && <SidebarLinkRow href="/hub/fleet" icon="🚛" label="Fleet" prefixMatch onClose={onClose} />}
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
              {canAccessTracker && <SidebarLinkRow href="/hub/tracker" icon="🎯" label="Tracker" prefixMatch onClose={onClose} />}
              {canAccessLawn && <SidebarLinkRow href="/hub/lawn" icon="🌿" label="Lawn Sizer" onClose={onClose} />}
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
              {canAccessCallLog && <SidebarLinkRow href="/hub/call-log" icon="📞" label="Call Log" prefixMatch onClose={onClose} />}
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
              {canAccessBooks && <SidebarLinkRow href="/hub/books" icon="📊" label="Books" prefixMatch onClose={onClose} />}
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
            <SidebarLinkRow href="/hub/pages/company-news" icon="📰" label="Company News" onClose={onClose} />
            <SidebarLinkRow href="/hub/files" icon="📁" label="Files" onClose={onClose} />
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
