'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type HubUserLite = { id: string; display_name: string; is_bot?: boolean }
type RoomLite = { id: string; name: string }

interface Props {
  currentUserId: string
  hubUsers: HubUserLite[]
  rooms: RoomLite[]
}

// In Electron, the web-push API (pushManager.subscribe) doesn't work because
// Chromium in Electron has no push service backend. So we fall back to using
// the existing Supabase Realtime stream to detect new messages and call
// `new Notification(...)` directly from the renderer — same approach Slack,
// Discord, etc. use. The Electron main process auto-grants notification
// permission via setPermissionRequestHandler in main.js, so `new Notification`
// just works without prompting.
export default function ElectronNotifier({ currentUserId, hubUsers, rooms }: Props) {
  const pathname = usePathname()
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname

  // Build lookup maps once; updated when the underlying arrays change
  const usersRef = useRef<Record<string, HubUserLite>>({})
  const roomsRef = useRef<Record<string, RoomLite>>({})
  useEffect(() => {
    const m: Record<string, HubUserLite> = {}
    for (const u of hubUsers) m[u.id] = u
    usersRef.current = m
  }, [hubUsers])
  useEffect(() => {
    const m: Record<string, RoomLite> = {}
    for (const r of rooms) m[r.id] = r
    roomsRef.current = m
  }, [rooms])

  useEffect(() => {
    // Detect Electron
    const isElectron = typeof navigator !== 'undefined' &&
      (navigator.userAgent.includes('Electron') ||
        (typeof window !== 'undefined' && 'process' in window && (window as unknown as { process?: { type?: string } }).process?.type === 'renderer'))
    if (!isElectron) return
    if (typeof Notification === 'undefined') return

    const supabase = createClient()
    const channel = supabase
      .channel('electron-notifier-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const msg = payload.new as {
            id: string
            room_id: string | null
            conversation_id: string | null
            sender_id: string
            parent_id: string | null
            content: string | null
          }

          // Skip thread replies and own messages
          if (msg.parent_id || msg.sender_id === currentUserId) return

          // Skip if user is currently viewing this room/conv (don't double-notify)
          const path = pathnameRef.current ?? ''
          const activeRoom = path.match(/^\/hub\/([^/]+)$/)?.[1]
          const activePm = path.match(/^\/hub\/pm\/([^/]+)$/)?.[1]
          if (msg.room_id && activeRoom === msg.room_id) return
          if (msg.conversation_id && activePm === msg.conversation_id) return

          // Skip if window is focused AND we're somewhere in /hub (user is engaged)
          // Allow notification if focused but on a non-hub page (rare but possible)
          if (typeof document !== 'undefined' && document.hasFocus() && path.startsWith('/hub')) {
            return
          }

          const sender = usersRef.current[msg.sender_id]
          const senderName = sender?.display_name ?? 'Someone'
          const body = msg.content?.trim().slice(0, 200) || '📎 Sent an attachment'

          let title: string
          let url: string
          if (msg.room_id) {
            const room = roomsRef.current[msg.room_id]
            title = `#${room?.name ?? 'room'} — ${senderName}`
            url = `/hub/${msg.room_id}`
          } else if (msg.conversation_id) {
            title = senderName
            url = `/hub/pm/${msg.conversation_id}`
          } else {
            return
          }

          try {
            const n = new Notification(title, {
              body,
              icon: '/icons/icon-192.png',
              tag: msg.id, // dedupe if same message somehow fires twice
            })
            n.onclick = () => {
              try { window.focus() } catch { /* */ }
              window.location.href = url
              n.close()
            }
          } catch (e) {
            console.error('[ElectronNotifier] Notification failed:', e)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentUserId])

  return null
}
