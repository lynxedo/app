'use client'

// Desktop Dialer Control S2 — "on the phone" presence.
//
// Broadcasts an EPHEMERAL signal that the current user is on a call, and exposes
// the set of teammates currently on a call so any surface can render a purple
// status dot next to their name.
//
// Why Supabase Realtime *Presence* (not a broadcast or a DB column): presence
// auto-expires when a client disconnects. A client only `.track()`s itself while
// in a call, so the set of present keys on the channel IS the set of on-call
// users — and if a tab crashes mid-call the presence is dropped automatically,
// so a purple dot can never get stuck (the failure mode a stored flag would
// have). One channel per company, keyed by user id.
//
// Mounted in HubShell so it sits INSIDE DialerProvider when the user has the
// dialer (reads the shared call state via useDialerContext) but is also mounted
// for non-dialer users (device == null) so they still *see* teammates' purple
// dots — they simply never track themselves.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useDialerContext } from './dialer/DialerProvider'

const OnCallContext = createContext<Set<string>>(new Set())

/** The set of user ids currently on a phone call (company-scoped, ephemeral). */
export function useOnCallUsers(): Set<string> {
  return useContext(OnCallContext)
}

export default function OnCallPresenceProvider({
  companyId,
  currentUserId,
  children,
}: {
  companyId?: string | null
  currentUserId: string
  children: ReactNode
}) {
  const device = useDialerContext()
  const onCall = !!device && (device.state === 'in-call' || device.state === 'placing')

  const [onCallIds, setOnCallIds] = useState<Set<string>>(() => new Set())
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null)
  const subscribedRef = useRef(false)
  // Keep the latest on-call value readable from the async subscribe callback.
  const onCallRef = useRef(onCall)
  onCallRef.current = onCall

  // One presence channel per company. Subscribe to observe everyone's on-call
  // state; track ourselves only while actually on a call (done in the effect
  // below + the SUBSCRIBED callback for the mounted-already-on-a-call case).
  useEffect(() => {
    if (!companyId || !currentUserId) return
    const supabase = createClient()
    const channel = supabase.channel(`hub-on-call:${companyId}`, {
      config: { presence: { key: currentUserId } },
    })
    channelRef.current = channel

    const recompute = () => {
      const state = channel.presenceState() as Record<string, unknown[]>
      setOnCallIds(new Set<string>(Object.keys(state)))
    }

    channel
      .on('presence', { event: 'sync' }, recompute)
      .on('presence', { event: 'join' }, recompute)
      .on('presence', { event: 'leave' }, recompute)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          subscribedRef.current = true
          if (onCallRef.current) channel.track({ user_id: currentUserId })
        }
      })

    return () => {
      subscribedRef.current = false
      try { channel.untrack() } catch { /* ignore */ }
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [companyId, currentUserId])

  // Track / untrack as the local user's call state flips (once subscribed).
  useEffect(() => {
    const channel = channelRef.current
    if (!channel || !subscribedRef.current) return
    if (onCall) channel.track({ user_id: currentUserId })
    else channel.untrack()
  }, [onCall, currentUserId])

  return <OnCallContext.Provider value={onCallIds}>{children}</OnCallContext.Provider>
}
