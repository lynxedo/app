'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import SidebarShell from './SidebarShell'

function Row({
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

// The Marketing section sidebar — Email, Social, and (soon) Txt all under one
// roof. Channels mirror the cards on the /hub/marketing landing page; keep the
// two in sync when a channel is added.
export default function MarketingSidebar({
  isAdmin,
  canAccessMarketing,
  canAccessEmail,
  canManageDrip,
  canAdminMarketing,
  canAdminEmail,
  onClose,
  onDesktopCollapse,
}: {
  isAdmin?: boolean
  canAccessMarketing?: boolean
  canAccessEmail?: boolean
  canManageDrip?: boolean
  canAdminMarketing?: boolean
  canAdminEmail?: boolean
  onClose?: () => void
  onDesktopCollapse?: () => void
}) {
  const pathname = usePathname() ?? ''
  const showSocialAdmin = !!isAdmin || !!canAdminMarketing
  const showEmailAdmin = !!isAdmin || !!canAdminEmail

  return (
    <SidebarShell title="Marketing" onClose={onClose} onDesktopCollapse={onDesktopCollapse}>
      <div className="space-y-1">
        <Row
          href="/hub/marketing"
          label="Overview"
          active={pathname === '/hub/marketing'}
          onClose={onClose}
        />
      </div>

      <div>
        <div className="px-2 mb-1">
          <span className="text-sm md:text-xs font-semibold text-[var(--t-heading)] uppercase tracking-wider">Channels</span>
        </div>
        <div className="space-y-1">
          {canAccessEmail && (
            <Row
              href="/hub/marketing/email"
              label="Email"
              icon="📧"
              active={pathname === '/hub/marketing/email' || pathname.startsWith('/hub/marketing/email/')}
              onClose={onClose}
            />
          )}
          {canAccessMarketing && (
            <Row
              href="/hub/marketing/social"
              label="Social"
              icon="📣"
              active={pathname === '/hub/marketing/social' || pathname.startsWith('/hub/marketing/social/')}
              onClose={onClose}
            />
          )}
          {/* Drip — speed-to-lead nurture over SMS (the Email engine's sibling). */}
          {canManageDrip && (
            <Row
              href="/hub/marketing/drip"
              label="Drip"
              icon="💧"
              active={pathname === '/hub/marketing/drip' || pathname.startsWith('/hub/marketing/drip/')}
              onClose={onClose}
            />
          )}
        </div>
      </div>

      {(showEmailAdmin || showSocialAdmin) && (
        <div className="pt-2 mt-1 border-t border-white/[0.07] space-y-1">
          {showEmailAdmin && (
            <Link
              href="/hub/admin/email"
              onClick={() => onClose?.()}
              className="flex items-center gap-2 px-2 py-2 md:py-1.5 rounded-lg text-base md:text-sm text-white/55 hover:bg-white/[0.06] hover:text-white transition-colors"
            >
              <span className="truncate flex-1">Email settings</span>
              <span className="flex-none text-[10px] text-white/40 border border-white/15 rounded px-1.5 py-0.5">admin</span>
            </Link>
          )}
          {showSocialAdmin && (
            <Link
              href="/hub/admin/marketing"
              onClick={() => onClose?.()}
              className="flex items-center gap-2 px-2 py-2 md:py-1.5 rounded-lg text-base md:text-sm text-white/55 hover:bg-white/[0.06] hover:text-white transition-colors"
            >
              <span className="truncate flex-1">Social settings</span>
              <span className="flex-none text-[10px] text-white/40 border border-white/15 rounded px-1.5 py-0.5">admin</span>
            </Link>
          )}
        </div>
      )}
    </SidebarShell>
  )
}
