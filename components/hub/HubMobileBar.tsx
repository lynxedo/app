'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { railFromPath } from './HubRail'

function Icon({ d }: { d: string }) {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}

const ICONS = {
  home: 'M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3v-7h6v7h3a1 1 0 001-1V10',
  chat: 'M21 12c0 4.418-4.03 8-9 8a9.9 9.9 0 01-4-.85L3 21l1.93-4.13A7.94 7.94 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  txt: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M9 14h6M9 18h4',
  activity: 'M15 17h5l-1.4-1.4A2 2 0 0118 14.16V11a6 6 0 10-12 0v3.16a2 2 0 01-.6 1.44L4 17h5m6 0a3 3 0 11-6 0',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
}

export default function HubMobileBar({
  onMoreClick,
  onChatClick,
}: {
  onMoreClick: () => void
  onChatClick: () => void
}) {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const active = railFromPath(pathname)

  function chatHref(): string {
    if (typeof window !== 'undefined') {
      try {
        const last = window.localStorage.getItem('hub_last_chat_route')
        if (last) return last
      } catch {}
    }
    return '/hub'
  }

  function handleChatClick(e: React.MouseEvent) {
    e.preventDefault()
    onChatClick()
    router.push(chatHref())
  }

  const tabs = [
    { id: 'home', label: 'Home', href: '/hub/home', icon: <Icon d={ICONS.home} /> },
    { id: 'chat', label: 'Chat', onClick: handleChatClick, icon: <Icon d={ICONS.chat} /> },
    { id: 'txt', label: 'Txt', href: '/hub/clients', icon: <Icon d={ICONS.txt} /> },
    { id: 'activity', label: 'Activity', href: '/hub/activity', icon: <Icon d={ICONS.activity} /> },
    { id: 'more', label: 'More', onClick: onMoreClick, icon: <Icon d={ICONS.more} /> },
  ] as const

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex items-stretch border-t border-gray-800 bg-gray-950"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
      aria-label="Hub bottom navigation"
    >
      {tabs.map(tab => {
        const isActive = (tab.id === 'more') ? false : active === tab.id
        const cls = `flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors ${
          isActive ? 'text-amber-300' : 'text-white/60 hover:text-white'
        }`
        if ('href' in tab && tab.href) {
          return (
            <Link key={tab.id} href={tab.href} className={cls} aria-current={isActive ? 'page' : undefined}>
              {tab.icon}
              <span>{tab.label}</span>
            </Link>
          )
        }
        return (
          <button key={tab.id} type="button" onClick={tab.onClick} className={cls}>
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
