'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Grants = {
  people: boolean
  hub: boolean
  routing: boolean
  timesheet: boolean
  fleet: boolean
  daily_log: boolean
}

const TABS: { href: string; label: string; exact: boolean; grantKey: keyof Grants }[] = [
  { href: '/admin', label: 'People', exact: true, grantKey: 'people' },
  { href: '/admin/hub', label: 'Hub', exact: false, grantKey: 'hub' },
  { href: '/admin/routing', label: 'Routing', exact: false, grantKey: 'routing' },
  { href: '/admin/timesheet', label: 'Time Records', exact: false, grantKey: 'timesheet' },
  { href: '/admin/fleet', label: 'Fleet', exact: false, grantKey: 'fleet' },
  { href: '/admin/daily-log', label: 'Daily Log', exact: false, grantKey: 'daily_log' },
]

export default function AdminTabNav({
  isSuperAdmin = true,
  grants,
}: {
  isSuperAdmin?: boolean
  grants?: Grants
}) {
  const pathname = usePathname()
  const visibleTabs = isSuperAdmin ? TABS : TABS.filter(t => grants?.[t.grantKey])

  return (
    <nav className="flex gap-0 -mb-px">
      {visibleTabs.map(tab => {
        const isActive = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              isActive
                ? 'border-[#2E7EB8] text-white'
                : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
