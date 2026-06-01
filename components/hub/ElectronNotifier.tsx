'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type HubUserLite = { id: string; display_name: string; is_bot?: boolean }
type RoomLite = { id: string; name: string }
type PrefRow = {
  room_id: string | null
  level: string | null
  dnd_enabled: boolean | null
  dnd_start: string | null
  dnd_end: string | null
}

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
//
// Privacy/UX gates (defense-in-depth — must stay in sync with lib/hub-push.ts):
//   1. Room membership — only notify for rooms the user actually belongs to.
//      `rooms` is the user's member-rooms list (Slack-style), so a room missing
//      from it means the user isn't a member. Realtime RLS already blocks private
//      rooms the user can't read, but this also (a) stops public-room over-notify
//      and (b) protects us if Realtime RLS is ever misconfigured.
//   2. Mute / mentions-only / Do-Not-Disturb — mirrors the eligibility filter in
//      sendHubPush so desktop banners respect the same prefs as Web Push/APNs/FCM.
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

  // Notification prefs (mute / DND) — fetched once per user for the suppression
  // check. A failed/empty fetch leaves these null, which means "notify" (the
  // prior behavior), so this never silently swallows notifications.
  const globalPrefRef = useRef<PrefRow | null>(null)
  const roomPrefsRef = useRef<Record<string, PrefRow>>({})
  const dndStatusRef = useRef<{ status: string | null; status_until: string | null }>({
    status: null,
    status_until: null,
  })

  useEffect(() => {
    // Detect Electron
    const isElectron = typeof navigator !== 'undefined' &&
      (navigator.userAgent.includes('Electron') ||
        (typeof window !== 'undefined' && 'process' in window && (window as unknown as { process?: { type?: string } }).process?.type === 'renderer'))
    if (!isElectron) return
    if (typeof Notification === 'undefined') return

    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false

    // Time-of-day DND window check (Texas-local), identical to lib/hub-push.ts.
    const inDndWindow = (start: string | null, end: string | null): boolean => {
      if (!start || !end || start === end) return false
      const nowLocal = new Date().toLocaleTimeString('en-US', {
        timeZone: 'America/Chicago',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
      return start < end
        ? nowLocal >= start && nowLocal < end
        : nowLocal >= start || nowLocal < end
    }

    // Mirrors sendHubPush's eligibility filter with isMention=false (the Electron
    // notifier has no @mention concept). isDm = message is a DM, which bypasses
    // the global "mentions only" level but not muted/DND.
    const isSuppressed = (roomId: string | null, isDm: boolean): boolean => {
      const s = dndStatusRef.current
      const global = globalPrefRef.current
      const roomPref = roomId ? roomPrefsRef.current[roomId] : undefined

      // Status-based DND (hub_users.status)
      if (s.status === 'dnd' && (!s.status_until || new Date(s.status_until) > new Date())) return true
      // Pref-based DND (global row)
      if (global?.dnd_enabled) return true
      // Scheduled DND window (global row)
      if (global && inDndWindow(global.dnd_start, global.dnd_end)) return true
      // Global notification level
      if (global?.level === 'muted') return true
      if (global?.level === 'mentions' && !isDm) return true
      // Per-room level
      if (roomPref?.level === 'muted') return true
      if (roomPref?.level === 'mentions') return true
      return false
    }

    void (async () => {
      // Load mute/DND prefs + DND status before wiring up notifications.
      const [{ data: prefs }, { data: me }] = await Promise.all([
        supabase
          .from('notification_prefs')
          .select('room_id, level, dnd_enabled, dnd_start, dnd_end')
          .eq('user_id', currentUserId),
        supabase
          .from('hub_users')
          .select('status, status_until')
          .eq('id', currentUserId)
          .maybeSingle(),
      ])
      if (cancelled) return

      const roomMap: Record<string, PrefRow> = {}
      for (const p of (prefs ?? []) as PrefRow[]) {
        if (p.room_id) roomMap[p.room_id] = p
        else globalPrefRef.current = p
      }
      roomPrefsRef.current = roomMap
      if (me) {
        const row = me as { status: string | null; status_until: string | null }
        dndStatusRef.current = { status: row.status ?? null, status_until: row.status_until ?? null }
      }

      channel = supabase
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

            // Gate 1 — room membership. Only notify for rooms the user belongs to.
            // (DMs are gated by Realtime RLS via is_conversation_member.)
            if (msg.room_id && !roomsRef.current[msg.room_id]) return

            // Gate 2 — respect mute / mentions-only / Do-Not-Disturb
            if (isSuppressed(msg.room_id, msg.conversation_id != null)) return

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

      // If the component unmounted while we were fetching prefs, tear down.
      if (cancelled && channel) supabase.removeChannel(channel)
    })()

    return () => {
      cancelled = true
      if (channel) supabase.removeChannel(channel)
    }
  }, [currentUserId])

  return null
}
