'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import SidebarShell from './SidebarShell'
import { SCOREBOARDS } from '@/lib/scoreboards/registry'

// Badge accent per board. Presentation-only, so it lives here rather than in the
// registry (which stays pure data). Unknown slugs fall back to a neutral chip, so
// adding a board still renders — give it a color here when you want one.
const BADGE_CLASS: Record<string, string> = {
  '1': 'bg-sky-500/20 text-sky-200',
  '2': 'bg-green-500/20 text-green-200',
  '3': 'bg-teal-500/20 text-teal-200',
  '4': 'bg-amber-500/20 text-amber-200',
}
const BADGE_FALLBACK = 'bg-white/10 text-white/60'

function BoardRow({
  href,
  label,
  badge,
  badgeClass,
  active,
  onClose,
}: {
  href: string
  label: string
  badge?: string
  badgeClass?: string
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
      {badge && (
        <span className={`flex-none rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${badgeClass ?? BADGE_FALLBACK}`}>
          {badge}
        </span>
      )}
      <span className="truncate flex-1">{label}</span>
    </Link>
  )
}

export default function ScoreboardsSidebar({
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
    <SidebarShell title="Scoreboards" onClose={onClose} onDesktopCollapse={onDesktopCollapse}>
      <div className="space-y-1">
        <BoardRow
          href="/hub/scoreboards"
          label="All scoreboards"
          active={pathname === '/hub/scoreboards'}
          onClose={onClose}
        />
      </div>

      <div>
        <div className="px-2 mb-1">
          <span className="text-sm md:text-xs font-semibold text-amber-300 uppercase tracking-wider">Boards</span>
        </div>
        <div className="space-y-1">
          {SCOREBOARDS.map(b => {
            const href = `/hub/scoreboards/${b.slug}`
            return (
              <BoardRow
                key={b.slug}
                href={href}
                label={b.title}
                badge={b.badge}
                badgeClass={BADGE_CLASS[b.slug]}
                active={pathname === href || pathname.startsWith(href + '/')}
                onClose={onClose}
              />
            )
          })}
        </div>
      </div>

      {isAdmin && (
        <div className="pt-2 mt-1 border-t border-white/[0.07]">
          <Link
            href="/hub/admin/scoreboards"
            onClick={() => onClose?.()}
            className="flex items-center gap-2 px-2 py-2 md:py-1.5 rounded-lg text-base md:text-sm text-white/55 hover:bg-white/[0.06] hover:text-white transition-colors"
          >
            <span className="truncate flex-1">Manage scoreboards</span>
            <span className="flex-none text-[10px] text-white/40 border border-white/15 rounded px-1.5 py-0.5">admin</span>
          </Link>
        </div>
      )}
    </SidebarShell>
  )
}
