'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type NavProfile = {
  role: string
  can_access_hub: boolean
  can_access_routing: boolean
  can_access_timesheet: boolean
  can_access_tracker: boolean
  can_access_call_log: boolean
}

function IconHub() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  )
}

function IconRouting() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
    </svg>
  )
}

function IconTimesheet() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function IconTracker() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  )
}

function IconCalls() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  )
}

function IconBooks() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  )
}

function IconDashboard() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  )
}

type NavItem = { href: string; label: string; icon: React.ReactNode }

export default function GlobalNav({ profile }: { profile: NavProfile }) {
  const pathname = usePathname()

  const items: NavItem[] = [
    profile.can_access_hub && { href: '/hub', label: 'Hub', icon: <IconHub /> },
    profile.can_access_routing && { href: '/hub/routing', label: 'Routing', icon: <IconRouting /> },
    profile.can_access_timesheet && { href: '/timesheet', label: 'Timesheet', icon: <IconTimesheet /> },
    profile.can_access_tracker && { href: '/hub/tracker', label: 'Tracker', icon: <IconTracker /> },
    profile.can_access_call_log && { href: '/hub/call-log', label: 'Calls', icon: <IconCalls /> },
    profile.role === 'admin' && { href: '/hub/books', label: 'Books', icon: <IconBooks /> },
    { href: '/dashboard', label: 'Dashboard', icon: <IconDashboard /> },
  ].filter(Boolean) as NavItem[]

  function isActive(href: string) {
    if (href === '/hub') return pathname === '/hub' || (pathname.startsWith('/hub') && !pathname.startsWith('/hub/clients'))
    return pathname === href || pathname.startsWith(href + '/')
  }

  const mobileItems = items.slice(0, 5)

  return (
    <>
      {/* Mobile safe-area spacer — pushes every non-Hub page below the
          iPhone status bar / Dynamic Island. GlobalNav is the only thing
          rendered above page content on non-Hub routes (the mobile nav
          itself is fixed at the bottom), so this is the single place we
          can compensate for env(safe-area-inset-top) globally. */}
      <div
        className="md:hidden flex-none"
        style={{ height: 'env(safe-area-inset-top)' }}
        aria-hidden="true"
      />

      {/* Desktop top bar */}
      <nav className="hidden md:flex flex-none h-12 bg-gray-900 border-b border-gray-800 items-center px-4 gap-1 z-30">
        <span className="text-xs font-bold text-brand tracking-widest uppercase mr-3 select-none">Lynxedo</span>
        {items.map(item => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                active
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              <span className={active ? 'text-brand' : ''}>{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Mobile bottom bar */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-gray-800 flex items-stretch"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {mobileItems.map(item => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                active ? 'text-brand' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
