'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import SidebarShell, { SidebarGroupHeader, SidebarLinkRow } from './SidebarShell'
import { THEMES as THEME_DEFS } from '@/lib/themes'

type Status = 'available' | 'busy' | 'dnd' | null

const STATUS_OPTIONS: { value: Status; label: string; dot: string }[] = [
  { value: 'available', label: 'Available', dot: 'bg-green-400' },
  { value: 'busy', label: 'Busy', dot: 'bg-yellow-400' },
  { value: 'dnd', label: 'Do Not Disturb', dot: 'bg-red-500' },
  { value: null, label: 'Clear status', dot: 'bg-gray-500' },
]

export default function ProfileSidebar({
  userId,
  displayName,
  userEmail,
  avatarUrl,
  initialStatus,
  textSize,
  onTextSizeChange,
  theme,
  onThemeChange,
  onOpenNotifPrefs,
  onOpenActivity,
  unreadActivity,
  onStatusChanged,
  masterDndOn = false,
  hubDndOn = false,
  dialerDndOn = false,
  onToggleMasterDnd,
  onToggleHubDnd,
  onToggleDialerDnd,
  onClose,
  onDesktopCollapse,
}: {
  userId: string
  displayName: string
  userEmail: string
  avatarUrl?: string | null
  initialStatus: string | null
  textSize?: string
  onTextSizeChange?: (size: string) => void
  theme?: string
  onThemeChange?: (theme: string) => void
  onOpenNotifPrefs?: () => void
  onOpenActivity?: () => void
  unreadActivity?: number
  onStatusChanged?: (status: Status) => void
  masterDndOn?: boolean
  hubDndOn?: boolean
  dialerDndOn?: boolean
  onToggleMasterDnd?: () => void
  onToggleHubDnd?: () => void
  onToggleDialerDnd?: () => void
  onClose?: () => void
  onDesktopCollapse?: () => void
}) {
  const router = useRouter()
  const [status, setStatus] = useState<Status>(initialStatus as Status)
  const [saving, setSaving] = useState(false)

  const firstInitial = (displayName ?? '?').trim().charAt(0).toUpperCase() || '?'

  async function pickStatus(newStatus: Status) {
    setSaving(true)
    const res = await fetch('/api/hub/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    if (res.ok) {
      setStatus(newStatus)
      onStatusChanged?.(newStatus)
    }
    setSaving(false)
  }

  // "Silence everything" mirrors the Do Not Disturb status, so keep the Status
  // section's selection in sync when it's toggled from here. (HubShell does the
  // server writes — master_dnd_enabled + the status dot — inside onToggleMasterDnd.)
  function handleToggleMaster() {
    setStatus(masterDndOn ? 'available' : 'dnd')
    onToggleMasterDnd?.()
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <SidebarShell title="You" onClose={onClose} onDesktopCollapse={onDesktopCollapse}>
      <div className="px-2 mb-2">
        <div className="flex items-center gap-3 px-2 py-3 rounded-lg bg-white/5">
          <div className="w-12 h-12 rounded-full overflow-hidden bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-white text-lg font-bold flex-none">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/profile/avatar/${userId}?v=${encodeURIComponent(avatarUrl)}`} alt="" className="w-full h-full object-cover" />
            ) : (
              firstInitial
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-white truncate">{displayName}</div>
            <div className="text-xs text-white/50 truncate">{userEmail}</div>
          </div>
        </div>
      </div>

      <div>
        <SidebarGroupHeader>Status</SidebarGroupHeader>
        {STATUS_OPTIONS.map(opt => (
          <button
            key={opt.label}
            type="button"
            onClick={() => pickStatus(opt.value)}
            disabled={saving}
            className={`w-full flex items-center gap-2.5 px-2 py-2 md:py-1.5 rounded-lg text-lg md:text-sm transition-colors ${
              status === opt.value
                ? 'bg-sky-500/[0.16] text-white font-semibold ring-1 ring-inset ring-sky-400/30'
                : 'text-white/70 hover:bg-white/[0.06] hover:text-white'
            }`}
          >
            <span className={`w-2.5 h-2.5 rounded-full ${opt.dot} flex-none`} />
            <span className="truncate flex-1 text-left">{opt.label}</span>
          </button>
        ))}
      </div>

      <div>
        <SidebarGroupHeader>Do Not Disturb</SidebarGroupHeader>
        <DndToggleRow
          label="Silence everything"
          description="Mutes all Hub & call alerts"
          on={masterDndOn}
          onToggle={handleToggleMaster}
          tone="red"
        />
        <DndToggleRow
          label="Mute messages"
          description="Silence Hub message alerts"
          on={hubDndOn}
          onToggle={() => onToggleHubDnd?.()}
          tone="amber"
        />
        <DndToggleRow
          label="Mute calls"
          description="Silence inbound call alerts"
          on={dialerDndOn}
          onToggle={() => onToggleDialerDnd?.()}
          tone="amber"
        />
      </div>

      {onTextSizeChange && (
        <div>
          <SidebarGroupHeader>Text size</SidebarGroupHeader>
          <div className="px-2">
            <div className="inline-flex bg-white/10 rounded-lg p-0.5 gap-0.5">
              {(['small', 'default', 'large'] as const).map(size => (
                <button
                  key={size}
                  type="button"
                  onClick={() => onTextSizeChange(size)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    textSize === size ? 'bg-gradient-to-br from-[#38bdf8] to-brand text-white shadow-sm' : 'text-white/60 hover:text-white'
                  }`}
                >
                  {size === 'small' ? 'S' : size === 'default' ? 'M' : 'L'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {onThemeChange && (
        <div>
          <SidebarGroupHeader>Theme</SidebarGroupHeader>
          <div className="px-2 space-y-2">
            <div>
              <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1.5">Dark</p>
              <div className="flex flex-wrap gap-1.5">
                {THEME_DEFS.filter(t => t.dark).map(t => (
                  <button
                    key={t.id}
                    type="button"
                    title={t.label}
                    onClick={() => {
                      onThemeChange(t.id)
                      fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hub_theme: t.id }) })
                    }}
                    className={`w-6 h-6 rounded-full transition-all flex-none ${
                      theme === t.id ? 'ring-2 ring-white ring-offset-1 ring-offset-transparent scale-110' : 'opacity-60 hover:opacity-100'
                    }`}
                    style={{ background: t.accent }}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1.5">Light</p>
              <div className="flex flex-wrap gap-1.5">
                {THEME_DEFS.filter(t => !t.dark).map(t => (
                  <button
                    key={t.id}
                    type="button"
                    title={t.label}
                    onClick={() => {
                      onThemeChange(t.id)
                      fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hub_theme: t.id }) })
                    }}
                    className={`w-6 h-6 rounded-full transition-all flex-none border border-white/20 ${
                      theme === t.id ? 'ring-2 ring-white ring-offset-1 ring-offset-transparent scale-110' : 'opacity-70 hover:opacity-100'
                    }`}
                    style={{ background: t.accent }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div>
        <SidebarGroupHeader>Account</SidebarGroupHeader>
        {onOpenActivity && (
          <button
            type="button"
            onClick={onOpenActivity}
            className="relative w-full flex items-center gap-1.5 px-2 py-2 md:py-1.5 rounded text-lg md:text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors"
          >
            <span className="text-xs flex-none">🔔</span>
            <span className="truncate flex-1 text-left">Activity</span>
            {unreadActivity != null && unreadActivity > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                {unreadActivity > 99 ? '99+' : unreadActivity}
              </span>
            )}
          </button>
        )}
        <SidebarLinkRow href="/hub/settings" icon="⚙️" label="Settings" onClose={onClose} />
        <SidebarLinkRow href="/help" icon="❓" label="Help" onClose={onClose} />
        {onOpenNotifPrefs && (
          <button
            type="button"
            onClick={onOpenNotifPrefs}
            className="w-full flex items-center gap-1.5 px-2 py-2 md:py-1.5 rounded text-lg md:text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors"
          >
            <span className="text-xs flex-none">🛎️</span>
            <span className="truncate flex-1 text-left">Notification settings</span>
          </button>
        )}
        <button
          type="button"
          onClick={handleSignOut}
          className="w-full flex items-center gap-1.5 px-2 py-2 md:py-1.5 rounded text-lg md:text-sm text-rose-300 hover:bg-rose-500/10 hover:text-rose-200 transition-colors"
        >
          <span className="text-xs flex-none">🚪</span>
          <span className="truncate flex-1 text-left">Sign out</span>
        </button>
      </div>
    </SidebarShell>
  )
}

function DndToggleRow({
  label,
  description,
  on,
  onToggle,
  tone,
}: {
  label: string
  description: string
  on: boolean
  onToggle: () => void
  tone: 'red' | 'amber'
}) {
  const onColor = tone === 'red' ? 'bg-red-500' : 'bg-amber-500'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="w-full flex items-center gap-3 px-2 py-2 md:py-1.5 rounded-lg text-left hover:bg-white/[0.06] transition-colors"
    >
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-medium truncate ${on ? 'text-white' : 'text-white/70'}`}>{label}</span>
        <span className="block text-[11px] text-white/40 truncate">{description}</span>
      </span>
      <span
        className={`relative w-9 h-5 rounded-full flex-none transition-colors ${on ? onColor : 'bg-white/15'}`}
        aria-hidden="true"
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  )
}
