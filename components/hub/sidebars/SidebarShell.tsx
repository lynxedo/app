'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export type SidebarItem = {
  href: string
  icon: string
  label: string
  prefixMatch?: boolean
  onClose?: () => void
  external?: boolean
  badge?: string | number
}

export function SidebarHeader({
  title,
  action,
  onClose,
  onDesktopCollapse,
}: {
  title: string
  action?: React.ReactNode
  onClose?: () => void
  onDesktopCollapse?: () => void
}) {
  return (
    <div
      className="flex-none px-4 py-3 border-b border-white/[0.07] flex items-center justify-between gap-2"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
    >
      <h2 className="text-base font-bold text-white truncate">{title}</h2>
      <div className="flex items-center gap-1 flex-none">
        {action}
        {onDesktopCollapse && (
          <button
            type="button"
            onClick={onDesktopCollapse}
            className="hidden md:flex items-center justify-center text-white/40 hover:text-white/80 transition-colors p-1 rounded"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="md:hidden text-white/50 hover:text-white p-1 rounded"
            aria-label="Close sidebar"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

export function SidebarGroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 mb-1">
      <span className="text-sm md:text-xs font-semibold text-amber-300 uppercase tracking-wider">
        {children}
      </span>
    </div>
  )
}

export function SidebarLinkRow({
  href,
  icon,
  label,
  prefixMatch,
  external,
  onClose,
}: SidebarItem) {
  const pathname = usePathname() ?? ''
  const isActive = !external && (prefixMatch ? pathname.startsWith(href) : pathname === href)
  const className = `flex items-center gap-1.5 px-2 py-2 md:py-1.5 rounded-lg text-lg md:text-sm transition-colors ${
    isActive
      ? 'bg-sky-500/[0.16] text-white font-semibold ring-1 ring-inset ring-sky-400/30'
      : 'text-white/70 hover:bg-white/[0.06] hover:text-white'
  }`
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        title={href}
      >
        <span className="text-xs flex-none">{icon}</span>
        <span className="truncate flex-1">{label}</span>
      </a>
    )
  }
  return (
    <Link href={href} onClick={() => onClose?.()} className={className}>
      <span className="text-xs flex-none">{icon}</span>
      <span className="truncate flex-1">{label}</span>
    </Link>
  )
}

export default function SidebarShell({
  title,
  action,
  onClose,
  onDesktopCollapse,
  children,
}: {
  title: string
  action?: React.ReactNode
  onClose?: () => void
  onDesktopCollapse?: () => void
  children: React.ReactNode
}) {
  return (
    <aside
      className="h-full w-72 text-white flex flex-col flex-none"
      style={{ background: 'linear-gradient(180deg,var(--t-well),var(--t-rail))', borderRight: '1px solid rgba(255,255,255,.06)' }}
      aria-label={`${title} sidebar`}
    >
      <SidebarHeader title={title} action={action} onClose={onClose} onDesktopCollapse={onDesktopCollapse} />
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {children}
      </nav>
    </aside>
  )
}
