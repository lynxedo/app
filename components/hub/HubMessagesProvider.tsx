'use client'

import { createContext, useContext, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

// #26 — ONE shared realtime subscription for new Hub messages.
//
// Before this, FOUR components (HubShell rail-unread, HubSidebar per-row unread,
// WebChimeNotifier, ElectronNotifier) each opened their OWN postgres_changes
// subscription on the whole `messages` table — so Supabase realtime delivered
// every inserted message to every device FOUR times, and several of them also
// joined the `hub-sidebar-messages` broadcast separately. That fan-out is the
// biggest realtime scaling cost as the team grows.
//
// This provider opens a single channel that listens to BOTH the postgres_changes
// INSERT *and* the `message-inserted` broadcast (the admin-insert backstop the
// messages API fires), and fans events out to any number of in-process
// listeners. Consumers register via useHubMessageInsert(cb) and keep their own
// per-component logic (chime decision, desktop notify, unread set update, rail
// dot). Receiving an insert via realtime AND broadcast stays harmless — exactly
// as before, each consumer already de-dupes / is idempotent.

export type HubMessageEvent = {
  id?: string
  room_id: string | null
  conversation_id: string | null
  sender_id: string | null
  parent_id: string | null
}

type Listener = (msg: HubMessageEvent) => void

const HubMessagesContext = createContext<{ subscribe: (cb: Listener) => () => void } | null>(null)

export function HubMessagesProvider({ children }: { children: React.ReactNode }) {
  const listenersRef = useRef<Set<Listener>>(new Set())

  const subscribe = useCallback((cb: Listener) => {
    listenersRef.current.add(cb)
    return () => { listenersRef.current.delete(cb) }
  }, [])

  useEffect(() => {
    const supabase = createClient()
    const emit = (msg: HubMessageEvent) => {
      // A throwing listener must not stop the others from running.
      for (const cb of [...listenersRef.current]) {
        try { cb(msg) } catch { /* ignore one bad listener */ }
      }
    }

    const channel = supabase
      // Named for the existing broadcast topic so this one channel receives the
      // `message-inserted` broadcast too (postgres_changes is independent of the
      // topic name).
      .channel('hub-sidebar-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const m = payload.new as Record<string, unknown>
        emit({
          id: m.id as string | undefined,
          room_id: (m.room_id as string | null) ?? null,
          conversation_id: (m.conversation_id as string | null) ?? null,
          sender_id: (m.sender_id as string | null) ?? null,
          parent_id: (m.parent_id as string | null) ?? null,
        })
      })
      .on('broadcast', { event: 'message-inserted' }, ({ payload }) => {
        const p = (payload ?? {}) as Record<string, unknown>
        if (!p.sender_id) return
        emit({
          id: p.id as string | undefined,
          room_id: (p.room_id as string | null) ?? null,
          conversation_id: (p.conversation_id as string | null) ?? null,
          sender_id: p.sender_id as string,
          parent_id: (p.parent_id as string | null) ?? null,
        })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  return <HubMessagesContext.Provider value={{ subscribe }}>{children}</HubMessagesContext.Provider>
}

// Register a callback for every new-message event. The latest callback is always
// used (no need to memoize it at the call site) and it's cleaned up on unmount.
export function useHubMessageInsert(cb: Listener) {
  const ctx = useContext(HubMessagesContext)
  const cbRef = useRef(cb)
  cbRef.current = cb
  useEffect(() => {
    if (!ctx) return
    return ctx.subscribe((msg) => cbRef.current(msg))
  }, [ctx])
}
