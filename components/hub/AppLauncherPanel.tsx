'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CatalogIcon, normalizeRailConfig, type CatalogEntry, type CatalogId, type RailConfig } from './railCatalog'

export default function AppLauncherPanel({
  items,
  railConfig,
  onSaveConfig,
  onClose,
  onSearch,
  onActivity,
  onProfile,
  onTools,
  onLinks,
  showAdmin,
}: {
  items: CatalogEntry[]
  railConfig: RailConfig | null
  onSaveConfig: (config: RailConfig) => Promise<void>
  onClose: () => void
  onSearch: () => void
  onActivity: () => void
  onProfile: () => void
  onTools: () => void
  onLinks: () => void
  showAdmin: boolean
}) {
  const router = useRouter()
  const config = normalizeRailConfig(railConfig)
  const railSlots = config.desktop
  const pinned = railSlots.filter((s): s is CatalogId => typeof s === 'string' && s !== null)
  const railFull = pinned.length >= 4

  function togglePin(id: CatalogId) {
    if (pinned.includes(id)) {
      const newDesktop = railSlots.map(s => s === id ? null : s)
      void onSaveConfig({ ...config, desktop: newDesktop })
    } else if (!railFull) {
      const newDesktop = [...railSlots]
      const emptyIdx = newDesktop.findIndex(s => !s)
      if (emptyIdx >= 0) {
        newDesktop[emptyIdx] = id
        void onSaveConfig({ ...config, desktop: newDesktop })
      }
    }
  }

  function handleNavigate(href: string) {
    onClose()
    router.push(href)
  }

  // Split catalog items: tools/links handled specially (open sidebar, not navigate)
  const catalogItems = items.filter(i => i.id !== 'tools' && i.id !== 'links')

  return (
    <>
      {/* Backdrop */}
      <div
        className="hidden md:block fixed inset-0 z-[49]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel — slides in to the right of the 64px rail */}
      <div className="hidden md:flex fixed left-16 top-0 bottom-0 z-50 w-72 bg-[#0a1f33] border-r border-white/10 flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-none"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0) + 0.75rem)' }}
        >
          <span className="font-semibold text-sm text-white">All Apps</span>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white p-1 rounded transition-colors"
            aria-label="Close app launcher"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* On Rail chips */}
        {pinned.length > 0 && (
          <div className="px-4 pt-3 pb-2 flex-none border-b border-white/5">
            <p className="text-[10px] font-semibold text-white/35 uppercase tracking-wider mb-2">On Rail</p>
            <div className="flex flex-wrap gap-1.5">
              {pinned.map(id => {
                const item = items.find(i => i.id === id)
                if (!item) return null
                return (
                  <div key={id} className="flex items-center gap-1.5 bg-amber-500/20 border border-amber-500/30 rounded-lg px-2 py-1">
                    <span className="text-amber-400 [&_svg]:w-3.5 [&_svg]:h-3.5">
                      <CatalogIcon id={id} />
                    </span>
                    <span className="text-xs text-amber-300 leading-none">{item.label}</span>
                    <button
                      onClick={() => togglePin(id)}
                      className="text-amber-400/50 hover:text-amber-300 ml-0.5 transition-colors"
                      aria-label={`Remove ${item.label} from rail`}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )
              })}
            </div>
            {railFull && (
              <p className="text-[10px] text-amber-400/50 mt-1.5">Rail is full — remove an item to add another.</p>
            )}
          </div>
        )}

        {/* Apps grid — scrollable */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <p className="text-[10px] font-semibold text-white/35 uppercase tracking-wider mb-3">Apps</p>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {catalogItems.map(item => {
              const isOnRail = pinned.includes(item.id)
              const href = item.href

              const tileBase = `relative group flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl transition-colors cursor-pointer ${
                isOnRail ? 'bg-amber-500/15 hover:bg-amber-500/25' : 'bg-white/5 hover:bg-white/10'
              }`

              const inner = (
                <>
                  <span className={`[&_svg]:w-5 [&_svg]:h-5 ${isOnRail ? 'text-amber-400' : 'text-white/75'}`}>
                    <CatalogIcon id={item.id} />
                  </span>
                  <span className={`text-[10px] font-medium text-center leading-tight ${isOnRail ? 'text-amber-300' : 'text-white/65'}`}>
                    {item.label}
                  </span>
                  {/* Pin toggle — visible on hover */}
                  <button
                    onClick={e => { e.preventDefault(); e.stopPropagation(); togglePin(item.id) }}
                    className={`absolute top-1 right-1 w-5 h-5 rounded flex items-center justify-center transition-all ${
                      isOnRail
                        ? 'opacity-100 bg-amber-500/30 text-amber-400 hover:bg-amber-500/50'
                        : `opacity-0 group-hover:opacity-100 ${!railFull ? 'bg-white/10 text-white/60 hover:text-white hover:bg-white/20' : 'bg-white/5 text-white/20 cursor-not-allowed'}`
                    }`}
                    title={isOnRail ? `Remove from rail` : railFull ? 'Rail full' : `Pin to rail`}
                    disabled={!isOnRail && railFull}
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      {isOnRail
                        ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        : <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      }
                    </svg>
                  </button>
                </>
              )

              if (href) {
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(href)}
                    className={tileBase}
                    title={item.label}
                  >
                    {inner}
                  </button>
                )
              }
              return <div key={item.id} className={tileBase}>{inner}</div>
            })}

            {/* Tools + Links as sidebar-opening tiles */}
            <button
              type="button"
              onClick={() => { onClose(); onTools() }}
              className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
            >
              <span className="text-white/75 [&_svg]:w-5 [&_svg]:h-5"><CatalogIcon id="tools" /></span>
              <span className="text-[10px] font-medium text-white/65">Tools</span>
            </button>
            <button
              type="button"
              onClick={() => { onClose(); onLinks() }}
              className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
            >
              <span className="text-white/75 [&_svg]:w-5 [&_svg]:h-5"><CatalogIcon id="links" /></span>
              <span className="text-[10px] font-medium text-white/65">Links</span>
            </button>
          </div>
        </div>

        {/* System footer */}
        <div className="flex-none border-t border-white/10 px-4 py-3">
          <div className="grid grid-cols-3 gap-2">
            <SysBtn onClick={() => { onClose(); onSearch() }} label="Search">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.34-4.34M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </SysBtn>
            <SysBtn onClick={() => { onClose(); onActivity() }} label="Activity">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.16V11a6 6 0 10-12 0v3.16a2 2 0 01-.6 1.44L4 17h5m6 0a3 3 0 11-6 0" />
              </svg>
            </SysBtn>
            <SysBtn onClick={() => { onClose(); onProfile() }} label="You">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </SysBtn>
            {showAdmin && (
              <SysBtnLink href="/hub/admin" label="Admin" onNavigate={onClose}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
                </svg>
              </SysBtnLink>
            )}
            <SysBtnLink href="/hub/settings" label="Settings" onNavigate={onClose}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317a2 2 0 013.35 0l.554.916a2 2 0 002.146.96l1.05-.224a2 2 0 012.39 2.39l-.224 1.05a2 2 0 00.96 2.146l.916.554a2 2 0 010 3.35l-.916.554a2 2 0 00-.96 2.146l.224 1.05a2 2 0 01-2.39 2.39l-1.05-.224a2 2 0 00-2.146.96l-.554.916a2 2 0 01-3.35 0l-.554-.916a2 2 0 00-2.146-.96l-1.05.224a2 2 0 01-2.39-2.39l.224-1.05a2 2 0 00-.96-2.146l-.916-.554a2 2 0 010-3.35l.916-.554a2 2 0 00.96-2.146l-.224-1.05a2 2 0 012.39-2.39l1.05.224a2 2 0 002.146-.96l.554-.916zM15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </SysBtnLink>
          </div>
        </div>
      </div>
    </>
  )
}

function SysBtn({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-white/55 hover:text-white"
    >
      {children}
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  )
}

function SysBtnLink({ href, label, onNavigate, children }: { href: string; label: string; onNavigate: () => void; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-white/55 hover:text-white"
    >
      {children}
      <span className="text-[10px] font-medium">{label}</span>
    </Link>
  )
}
