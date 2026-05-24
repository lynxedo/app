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

export function SidebarHeader({ title, action, onClose }: { title: string; action?: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="flex-none px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2">
      <h2 className="text-base font-bold text-white truncate">{title}</h2>
      <div className="flex items-center gap-1 flex-none">
        {action}
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
  const className = `flex items-center gap-1.5 px-2 py-2 md:py-1.5 rounded text-lg md:text-sm transition-colors ${
    isActive
      ? 'bg-[#2E7EB8] text-white font-medium'
      : 'text-white/70 hover:bg-white/10 hover:text-white'
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
  children,
}: {
  title: string
  action?: React.ReactNode
  onClose?: () => void
  children: React.ReactNode
}) {
  return (
    <aside
      className="h-full w-72 bg-[#0F2E47] text-white flex flex-col flex-none border-r border-white/5"
      aria-label={`${title} sidebar`}
    >
      <SidebarHeader title={title} action={action} onClose={onClose} />
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {children}
      </nav>
    </aside>
  )
}
