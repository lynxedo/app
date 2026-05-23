'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import SidebarShell, { SidebarGroupHeader, SidebarLinkRow } from './SidebarShell'

type Status = 'available' | 'busy' | 'dnd' | null

const STATUS_OPTIONS: { value: Status; label: string; dot: string }[] = [
  { value: 'available', label: 'Available', dot: 'bg-green-400' },
  { value: 'busy', label: 'Busy', dot: 'bg-yellow-400' },
  { value: 'dnd', label: 'Do Not Disturb', dot: 'bg-red-500' },
  { value: null, label: 'Clear status', dot: 'bg-gray-500' },
]

export default function ProfileSidebar({
  displayName,
  userEmail,
  initialStatus,
  textSize,
  onTextSizeChange,
  onOpenNotifPrefs,
  onStatusChanged,
  onClose,
}: {
  displayName: string
  userEmail: string
  initialStatus: string | null
  textSize?: string
  onTextSizeChange?: (size: string) => void
  onOpenNotifPrefs?: () => void
  onStatusChanged?: (status: Status) => void
  onClose?: () => void
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

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <SidebarShell title="You">
      <div className="px-2 mb-2">
        <div className="flex items-center gap-3 px-2 py-3 rounded-lg bg-white/5">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-white text-lg font-bold flex-none">
            {firstInitial}
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
            className={`w-full flex items-center gap-2.5 px-2 py-2 md:py-1.5 rounded text-lg md:text-sm transition-colors ${
              status === opt.value
                ? 'bg-[#2E7EB8] text-white font-medium'
                : 'text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            <span className={`w-2.5 h-2.5 rounded-full ${opt.dot} flex-none`} />
            <span className="truncate flex-1 text-left">{opt.label}</span>
          </button>
        ))}
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
                    textSize === size ? 'bg-[#2E7EB8] text-white' : 'text-white/60 hover:text-white'
                  }`}
                >
                  {size === 'small' ? 'S' : size === 'default' ? 'M' : 'L'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div>
        <SidebarGroupHeader>Account</SidebarGroupHeader>
        <SidebarLinkRow href="/hub/settings" icon="⚙️" label="Settings" onClose={onClose} />
        <SidebarLinkRow href="/help" icon="❓" label="Help" onClose={onClose} />
        {onOpenNotifPrefs && (
          <button
            type="button"
            onClick={onOpenNotifPrefs}
            className="w-full flex items-center gap-1.5 px-2 py-2 md:py-1.5 rounded text-lg md:text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors"
          >
            <span className="text-xs flex-none">🔔</span>
            <span className="truncate flex-1 text-left">Notifications</span>
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
