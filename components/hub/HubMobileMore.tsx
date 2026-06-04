'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  catalogEntriesFor,
  normalizeRailConfig,
  CatalogIcon,
  type CatalogId,
  type RailConfig,
  type RailPermissions,
} from './railCatalog'

export default function HubMobileMore({
  onClose,
  showAdmin,
  unreadActivity,
  onSearchClick,
  onToolsClick,
  onLinksClick,
  onProfileClick,
  onActivityClick,
  permissions,
  railConfig,
  onSaveConfig,
}: {
  onClose: () => void
  showAdmin: boolean
  unreadActivity?: number
  onSearchClick: () => void
  onToolsClick: () => void
  onLinksClick: () => void
  onProfileClick: () => void
  onActivityClick: () => void
  permissions: RailPermissions
  railConfig: RailConfig | null
  onSaveConfig: (config: RailConfig) => Promise<void>
}) {
  const router = useRouter()
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)

  const config = normalizeRailConfig(railConfig)
  const drawerPins: CatalogId[] = config.drawer_pins ?? []

  const allItems = catalogEntriesFor(permissions)
  // Pinned items sorted to top, then the rest
  const pinnedItems = allItems.filter(i => drawerPins.includes(i.id))
  const unpinnedItems = allItems.filter(i => !drawerPins.includes(i.id))
  const pinCount = pinnedItems.length

  async function togglePin(id: CatalogId) {
    const next = drawerPins.includes(id)
      ? drawerPins.filter(p => p !== id)
      : [...drawerPins, id]
    setSaving(true)
    try {
      await onSaveConfig({ ...config, drawer_pins: next })
    } finally {
      setSaving(false)
    }
  }

  function handleItemClick(id: CatalogId, href: string | undefined) {
    if (editMode) {
      void togglePin(id)
      return
    }
    if (id === 'tools') { onToolsClick(); return }
    if (id === 'links') { onLinksClick(); return }
    if (href) {
      onClose()
      router.push(href)
    }
  }

  const tileClass = (pinned: boolean) =>
    `relative w-full flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl transition-colors ${
      pinned
        ? 'bg-amber-500/15 border border-amber-500/30'
        : editMode
          ? 'bg-white/5 border border-dashed border-white/20 hover:bg-white/10'
          : 'bg-white/5 hover:bg-white/10'
    }`

  function AppTile({ id, label, pinned }: { id: CatalogId; label: string; pinned: boolean }) {
    return (
      <button
        type="button"
        onClick={() => handleItemClick(id, allItems.find(i => i.id === id)?.href)}
        className={tileClass(pinned)}
      >
        <span className={`[&_svg]:w-5 [&_svg]:h-5 ${pinned ? 'text-amber-400' : 'text-white/80'}`}>
          <CatalogIcon id={id} />
        </span>
        <span className={`text-[10px] font-medium text-center leading-tight px-1 ${pinned ? 'text-amber-300' : 'text-white/70'}`}>
          {label}
        </span>
        {/* Pin indicator dot */}
        {editMode && (
          <span className={`absolute top-1.5 right-1.5 w-3 h-3 rounded-full border ${
            pinned ? 'bg-amber-400 border-amber-400' : 'border-white/30 bg-transparent'
          }`} />
        )}
        {!editMode && pinned && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400" />
        )}
      </button>
    )
  }

  return (
    <div
      className="md:hidden fixed inset-0 z-[60] bg-black/70 flex flex-col"
      onClick={!editMode ? onClose : undefined}
    >
      <div
        className="mt-auto bg-[#0F2E47] text-white rounded-t-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: '90vh', paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-none">
          <span className="font-semibold text-base">Apps</span>
          <div className="flex items-center gap-2">
            {saving && <span className="text-xs text-white/40">Saving…</span>}
            <button
              onClick={() => setEditMode(v => !v)}
              className={`text-sm font-medium px-3 py-1 rounded-lg transition-colors ${
                editMode
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              }`}
            >
              {editMode ? 'Done' : 'Edit'}
            </button>
            <button
              onClick={onClose}
              className="text-white/50 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Edit hint */}
        {editMode && (
          <p className="text-xs text-amber-400/80 px-4 py-2 bg-amber-500/10 flex-none border-b border-amber-500/20">
            Tap any app to {pinCount > 0 ? 'pin or unpin it' : 'pin it to the top'}
          </p>
        )}

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-4 py-4">
          {/* Apps grid — pinned first, then rest */}
          <div className="grid grid-cols-4 gap-2.5 mb-4">
            {/* Pinned section label */}
            {!editMode && pinCount > 0 && (
              <p className="col-span-4 text-[10px] font-semibold text-white/30 uppercase tracking-wider mb-0.5">
                Pinned
              </p>
            )}
            {editMode && (
              <p className="col-span-4 text-[10px] font-semibold text-white/30 uppercase tracking-wider mb-0.5">
                All Apps{pinCount > 0 ? ` — ${pinCount} pinned` : ''}
              </p>
            )}

            {/* Pinned items (shown before separator in normal mode; intermixed in edit mode) */}
            {!editMode && pinnedItems.map(item => (
              <AppTile key={item.id} id={item.id} label={item.label} pinned />
            ))}

            {/* "Apps" separator label in normal mode when there are pins */}
            {!editMode && pinCount > 0 && (
              <p className="col-span-4 text-[10px] font-semibold text-white/30 uppercase tracking-wider mt-2 mb-0.5">
                Apps
              </p>
            )}

            {/* Non-pinned items in normal mode; all items (pinned first) in edit mode */}
            {!editMode && unpinnedItems.map(item => (
              <AppTile key={item.id} id={item.id} label={item.label} pinned={false} />
            ))}
            {editMode && [...pinnedItems, ...unpinnedItems].map(item => (
              <AppTile key={item.id} id={item.id} label={item.label} pinned={drawerPins.includes(item.id)} />
            ))}
          </div>

          {/* System section */}
          <div className="h-px bg-white/10 mb-4" />
          <div className="grid grid-cols-3 gap-2">
            <SysTile onClick={onSearchClick} label="Search">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.34-4.34M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </SysTile>
            <SysTile onClick={onActivityClick} label="Activity" badge={unreadActivity}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.16V11a6 6 0 10-12 0v3.16a2 2 0 01-.6 1.44L4 17h5m6 0a3 3 0 11-6 0" />
              </svg>
            </SysTile>
            <SysTile onClick={onProfileClick} label="You">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </SysTile>
            {showAdmin && (
              <SysTileLink href="/hub/admin" label="Admin" onNavigate={onClose}>
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
                </svg>
              </SysTileLink>
            )}
            <SysTileLink href="/hub/settings" label="Settings" onNavigate={onClose}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317a2 2 0 013.35 0l.554.916a2 2 0 002.146.96l1.05-.224a2 2 0 012.39 2.39l-.224 1.05a2 2 0 00.96 2.146l.916.554a2 2 0 010 3.35l-.916.554a2 2 0 00-.96 2.146l.224 1.05a2 2 0 01-2.39 2.39l-1.05-.224a2 2 0 00-2.146.96l-.554.916a2 2 0 01-3.35 0l-.554-.916a2 2 0 00-2.146-.96l-1.05.224a2 2 0 01-2.39-2.39l.224-1.05a2 2 0 00-.96-2.146l-.916-.554a2 2 0 010-3.35l.916-.554a2 2 0 00.96-2.146l-.224-1.05a2 2 0 012.39-2.39l1.05.224a2 2 0 002.146-.96l.554-.916zM15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </SysTileLink>
            <SysTileLink href="/help" label="Help" onNavigate={onClose}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </SysTileLink>
          </div>
        </div>
      </div>
    </div>
  )
}

function SysTile({ onClick, label, badge, children }: {
  onClick: () => void; label: string; badge?: number; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex flex-col items-center justify-center gap-1 py-3.5 rounded-xl bg-white/5 hover:bg-white/10 transition-colors text-white/70 hover:text-white"
    >
      {children}
      <span className="text-xs font-medium">{label}</span>
      {badge != null && badge > 0 && (
        <span className="absolute top-2 right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}

function SysTileLink({ href, label, onNavigate, children }: {
  href: string; label: string; onNavigate: () => void; children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="flex flex-col items-center justify-center gap-1 py-3.5 rounded-xl bg-white/5 hover:bg-white/10 transition-colors text-white/70 hover:text-white"
    >
      {children}
      <span className="text-xs font-medium">{label}</span>
    </Link>
  )
}
