'use client'

import Link from 'next/link'

export default function HubMobileMore({
  onClose,
  showAdmin,
  onSearchClick,
  onToolsClick,
  onLinksClick,
  onProfileClick,
}: {
  onClose: () => void
  showAdmin: boolean
  onSearchClick: () => void
  onToolsClick: () => void
  onLinksClick: () => void
  onProfileClick: () => void
}) {
  return (
    <div
      className="md:hidden fixed inset-0 z-[60] bg-black/70 flex flex-col"
      onClick={onClose}
    >
      <div
        className="mt-auto bg-[#0F2E47] text-white rounded-t-2xl p-4 max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0) + 1rem)' }}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold">More</h2>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white p-1.5 rounded"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Tile icon="🔍" label="Search" onClick={onSearchClick} />
          <Tile icon="🧰" label="Tools" onClick={onToolsClick} />
          <Tile icon="🔗" label="Links" onClick={onLinksClick} />
          {showAdmin && (
            <TileLink icon="🛡️" label="Admin" href="/hub/admin" onNavigate={onClose} />
          )}
          <TileLink icon="⚙️" label="Settings" href="/hub/settings" onNavigate={onClose} />
          <TileLink icon="❓" label="Help" href="/help" onNavigate={onClose} />
          <Tile icon="👤" label="You" onClick={onProfileClick} />
        </div>
      </div>
    </div>
  )
}

function Tile({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1 py-4 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
    >
      <span className="text-2xl">{icon}</span>
      <span className="text-xs font-medium text-white/80">{label}</span>
    </button>
  )
}

function TileLink({ icon, label, href, onNavigate }: { icon: string; label: string; href: string; onNavigate: () => void }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="flex flex-col items-center justify-center gap-1 py-4 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
    >
      <span className="text-2xl">{icon}</span>
      <span className="text-xs font-medium text-white/80">{label}</span>
    </Link>
  )
}
