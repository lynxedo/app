'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import SidebarShell from './SidebarShell'

// Boards inside the Tracker section. Mirrors the boards-menu page at
// /hub/tracker — keep the two in sync when boards are added.
const BOARDS: { id: string; title: string; href: string; icon: string }[] = [
  { id: 'leads', title: 'Lead Tracker', href: '/hub/tracker/leads', icon: '🎯' },
  { id: 'recurring', title: 'Recurring Services', href: '/hub/tracker/recurring', icon: '🔁' },
  { id: 'route-capacity', title: 'Route Capacity', href: '/hub/tracker/route-capacity', icon: '🚐' },
]

function BoardRow({
  href,
  label,
  icon,
  active,
  onClose,
}: {
  href: string
  label: string
  icon?: string
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
      {icon && <span className="flex-none text-base leading-none">{icon}</span>}
      <span className="truncate flex-1">{label}</span>
    </Link>
  )
}

export default function TrackerSidebar({
  isAdmin,
  onClose,
  onDesktopCollapse,
}: {
  isAdmin?: boolean
  onClose?: () => void
  onDesktopCollapse?: () => void
}) {
  const pathname = usePathname() ?? ''

  return (
    <SidebarShell title="Trackers" onClose={onClose} onDesktopCollapse={onDesktopCollapse}>
      <div className="space-y-1">
        <BoardRow
          href="/hub/tracker"
          label="All trackers"
          active={pathname === '/hub/tracker'}
          onClose={onClose}
        />
      </div>

      <div>
        <div className="px-2 mb-1">
          <span className="text-sm md:text-xs font-semibold text-amber-300 uppercase tracking-wider">Boards</span>
        </div>
        <div className="space-y-1">
          {BOARDS.map(b => (
            <BoardRow
              key={b.id}
              href={b.href}
              label={b.title}
              icon={b.icon}
              active={pathname === b.href || pathname.startsWith(b.href + '/')}
              onClose={onClose}
            />
          ))}
        </div>
      </div>

      {isAdmin && (
        <div className="pt-2 mt-1 border-t border-white/[0.07]">
          <Link
            href="/hub/tracker/settings"
            onClick={() => onClose?.()}
            className="flex items-center gap-2 px-2 py-2 md:py-1.5 rounded-lg text-base md:text-sm text-white/55 hover:bg-white/[0.06] hover:text-white transition-colors"
          >
            <span className="truncate flex-1">Tracker settings</span>
            <span className="flex-none text-[10px] text-white/40 border border-white/15 rounded px-1.5 py-0.5">admin</span>
          </Link>
        </div>
      )}
    </SidebarShell>
  )
}
