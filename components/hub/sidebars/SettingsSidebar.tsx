'use client'

import { Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import SidebarShell, { SidebarLinkRow } from './SidebarShell'

// The Settings left sidebar is the single navigation for the Settings page
// (there is no in-page tab bar). Each row links to /hub/settings?tab=<id>;
// app/hub/settings/SettingsForm.tsx derives the visible section from ?tab=.
type SettingsNavItem = { tab: string; icon: string; label: string; betaOnly?: boolean }

const ITEMS: SettingsNavItem[] = [
  { tab: '',              icon: '👤', label: 'Profile' },
  { tab: 'my-hub',        icon: '🎨', label: 'My Hub' },
  { tab: 'notifications', icon: '🔔', label: 'Notifications' },
  { tab: 'extension',     icon: '🧩', label: 'Browser Extension' },
  { tab: 'beta',          icon: '🧪', label: 'Beta Features', betaOnly: true },
  { tab: 'account',       icon: '⚙️', label: 'Account' },
]

// useSearchParams lives here (wrapped in Suspense by the default export) so the
// query read never forces a Suspense requirement up in HubShell.
function SettingsNav({ onClose, canAccessBeta }: { onClose?: () => void; canAccessBeta: boolean }) {
  const pathname = usePathname() ?? ''
  const currentTab = useSearchParams().get('tab') ?? ''
  return (
    <>
      {ITEMS.filter(i => !i.betaOnly || canAccessBeta).map(i => (
        <SidebarLinkRow
          key={i.label}
          href={i.tab ? `/hub/settings?tab=${i.tab}` : '/hub/settings'}
          icon={i.icon}
          label={i.label}
          active={pathname === '/hub/settings' && currentTab === i.tab}
          onClose={onClose}
        />
      ))}
    </>
  )
}

export default function SettingsSidebar({
  onClose,
  onDesktopCollapse,
  canAccessBeta = false,
}: {
  onClose?: () => void
  onDesktopCollapse?: () => void
  canAccessBeta?: boolean
}) {
  return (
    <SidebarShell title="Settings" onClose={onClose} onDesktopCollapse={onDesktopCollapse}>
      <Suspense fallback={null}>
        <SettingsNav onClose={onClose} canAccessBeta={canAccessBeta} />
      </Suspense>
    </SidebarShell>
  )
}
