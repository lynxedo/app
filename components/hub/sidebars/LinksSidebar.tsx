'use client'

import { useEffect, useState } from 'react'
import SidebarShell, { SidebarLinkRow } from './SidebarShell'
import { Spinner, EmptyState } from '@/components/ui'

type ExternalLink = { id: string; name: string; url: string; icon: string; sort_order: number }

export default function LinksSidebar({ onClose, onDesktopCollapse }: { onClose?: () => void; onDesktopCollapse?: () => void }) {
  const [links, setLinks] = useState<ExternalLink[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/hub/external-links')
      .then(r => r.json())
      .then(d => { if (!cancelled) { setLinks(d.links ?? []); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <SidebarShell title="Links" onClose={onClose} onDesktopCollapse={onDesktopCollapse}>
      {loading && <div className="py-8 text-center"><Spinner size={5} /></div>}
      {!loading && links.length === 0 && (
        <EmptyState size="sm" title="No external links yet." hint="Admins can add them in Admin → Hub." />
      )}
      {links.map(link => (
        <SidebarLinkRow
          key={link.id}
          href={link.url}
          icon={link.icon}
          label={link.name}
          external
          onClose={onClose}
        />
      ))}
    </SidebarShell>
  )
}
