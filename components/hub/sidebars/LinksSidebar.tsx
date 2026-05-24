'use client'

import { useEffect, useState } from 'react'
import SidebarShell, { SidebarLinkRow } from './SidebarShell'

type ExternalLink = { id: string; name: string; url: string; icon: string; sort_order: number }

export default function LinksSidebar({ onClose }: { onClose?: () => void }) {
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
    <SidebarShell title="Links" onClose={onClose}>
      {loading && <p className="text-xs text-white/30 px-2 py-1">Loading…</p>}
      {!loading && links.length === 0 && (
        <p className="text-xs text-white/30 px-2 py-1">No external links yet. Admins can add them in Admin → Hub.</p>
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
