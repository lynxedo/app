'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/tracker', label: 'Tracker', exact: true },
  { href: '/tracker/dashboard', label: 'Dashboard', exact: false },
  { href: '/tracker/import', label: 'Import', exact: false, adminOnly: false },
  { href: '/tracker/settings', label: 'Settings', exact: false, adminOnly: true },
]

export default function TrackerNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()

  return (
    <div className="border-b border-gray-800 px-6">
      <nav className="flex">
        {TABS.filter(t => !t.adminOnly || isAdmin).map(tab => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                active
                  ? 'border-indigo-500 text-white'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
