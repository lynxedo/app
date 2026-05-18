'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/admin', label: 'People', exact: true },
  { href: '/admin/hub', label: 'Hub', exact: false },
  { href: '/admin/timesheet', label: 'Time Records', exact: false },
]

export default function AdminTabNav() {
  const pathname = usePathname()
  return (
    <nav className="flex gap-0 -mb-px">
      {TABS.map(tab => {
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
