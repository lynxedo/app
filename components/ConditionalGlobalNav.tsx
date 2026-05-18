'use client'

import { usePathname } from 'next/navigation'
import GlobalNav from './GlobalNav'

type NavProfile = {
  role: string
  can_access_hub: boolean
  can_access_routing: boolean
  can_access_timesheet: boolean
  can_access_tracker: boolean
  can_access_call_log: boolean
}

export default function ConditionalGlobalNav({ profile }: { profile: NavProfile }) {
  const pathname = usePathname()
  if (pathname.startsWith('/hub')) return null
  return <GlobalNav profile={profile} />
}
