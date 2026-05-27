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
  zone_sizer: boolean
  dialer: boolean
  contacts: boolean
}

const TABS: { href: string; label: string; exact: boolean; grantKey: keyof Grants }[] = [
  { href: '/hub/admin', label: 'People', exact: true, grantKey: 'people' },
  { href: '/hub/admin/hub', label: 'Hub', exact: false, grantKey: 'hub' },
  { href: '/hub/admin/guardian', label: 'Guardian', exact: false, grantKey: 'hub' },
  { href: '/hub/admin/contacts', label: 'Contacts', exact: false, grantKey: 'contacts' },
  { href: '/hub/admin/routing', label: 'Routing', exact: false, grantKey: 'routing' },
  { href: '/hub/admin/timesheet', label: 'Time Records', exact: false, grantKey: 'timesheet' },
  { href: '/hub/admin/fleet', label: 'Fleet', exact: false, grantKey: 'fleet' },
  { href: '/hub/admin/daily-log', label: 'Daily Log', exact: false, grantKey: 'daily_log' },
  { href: '/hub/admin/zone-sizer', label: 'Zone Sizer', exact: false, grantKey: 'zone_sizer' },
  { href: '/hub/admin/dialer', label: 'Dialer', exact: false, grantKey: 'dialer' },
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
