'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { StatusDot } from './StatusPicker'
import { useOnCallUsers } from './OnCallPresenceProvider'
import PopoutButton from './popout/PopoutButton'

// Live DM-header dot + title. Subscribes to the same hub-status-broadcast
// channel HubSidebar uses so the colored dot at the top of a DM flips the
// moment the other person changes status, clocks in/out, or goes idle —
// instead of waiting for a page navigation.
//
// - `solo` is the user whose dot to display (the other person in a 1-on-1,
//   or self in a self-DM). For group DMs (3+) pass null; we render 💬.
// - `initialEffectiveStatus` is the dot's starting color from server render.
// - `othersCount` drives the small "N people" pill for groups.
export default function DMHeader({
  solo,
  initialEffectiveStatus,
  initialManualStatus,
  convTitle,
  othersCount,
  conversationId,
  currentUserId,
}: {
  solo: { id: string } | null
  initialEffectiveStatus: string | null
  initialManualStatus: string | null
  convTitle: string
  othersCount: number
  conversationId: string
  currentUserId: string
}) {
  const [effectiveStatus, setEffectiveStatus] = useState<string | null>(initialEffectiveStatus)
  const [manualStatus, setManualStatus] = useState<string | null>(initialManualStatus)
  const onCallUsers = useOnCallUsers()

  useEffect(() => {
    if (!solo) return
    const supabase = createClient()
    const channel = supabase
      .channel('hub-status-broadcast')
      .on(
        'broadcast',
        { event: 'status-changed' },
        ({ payload }: { payload: { user_id: string; status: string | null } }) => {
          if (payload.user_id !== solo.id) return
          setManualStatus(payload.status)
          // Manual dnd/busy wins outright; available/null falls back to the
          // existing effective_status (next refetch reconciles).
          if (payload.status === 'dnd' || payload.status === 'busy') {
            setEffectiveStatus(payload.status)
          }
        }
      )
      .on(
        'broadcast',
        { event: 'presence-changed' },
        ({ payload }: { payload: { user_id: string; effective_status: string } }) => {
          if (payload.user_id !== solo.id) return
          setEffectiveStatus(payload.effective_status)
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [solo])

  return (
    <header data-hide-on-keyboard className="flex-none border-b border-gray-800 px-5 py-3 flex items-center gap-3">
      {solo ? (
        <StatusDot status={effectiveStatus ?? manualStatus ?? null} onCall={onCallUsers.has(solo.id)} />
      ) : (
        <span className="text-gray-400">💬</span>
      )}
      <h1 className="font-semibold text-white">{convTitle}</h1>
      {othersCount > 1 && (
        <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">{othersCount + 1} people</span>
      )}
      <div className="ml-auto">
        <PopoutButton
          target={{ kind: 'dm', conversationId, title: convTitle, currentUserId }}
        />
      </div>
    </header>
  )
}
