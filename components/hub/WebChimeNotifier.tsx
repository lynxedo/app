'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isChimeEnabled, playChime, primeChimeAudio, claimChimeForMessage } from '@/lib/hub-chime'

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
  companyId?: string
  rooms: RoomLite[]
}

// Plays a per-device sound whenever a new Hub message arrives, as long as a Hub
// tab is open in this browser — whether the user is looking at Hub or working in
// another tab/app. An audible heads-up for every new message.
//
// It reuses the same Supabase Realtime "messages" stream plus the same
// membership / mute / DND filters as ElectronNotifier and lib/hub-push.ts, so
// the chime fires for exactly the messages the user gets push notifications for.
//
// Scope: regular browsers + PWA only. It is skipped in Electron (the desktop
// app's OS notification already plays a sound) and in the native iOS/Android
// apps (they receive native push with their own sound). On mobile browsers a
// backgrounded tab is suspended by the OS, so it simply never fires there.
export default function WebChimeNotifier({ currentUserId, companyId, rooms }: Props) {
  const roomsRef = useRef<Record<string, RoomLite>>({})
  useEffect(() => {
    const m: Record<string, RoomLite> = {}
    for (const r of rooms) m[r.id] = r
    roomsRef.current = m
  }, [rooms])

  // Notification prefs (mute / DND) + DND status — fetched once. A failed/empty
  // fetch leaves these null, which means "notify" (never silently swallow).
  const globalPrefRef = useRef<PrefRow | null>(null)
  const roomPrefsRef = useRef<Record<string, PrefRow>>({})
  const dndStatusRef = useRef<{ status: string | null; status_until: string | null }>({
    status: null,
    status_until: null,
  })
  const lastPlayedRef = useRef(0)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return

    // Only the web / PWA audience. Electron + native apps have their own sound.
    const ua = navigator.userAgent
    const w = window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean }
      AndroidFcm?: unknown
    }
    const isElectron = ua.includes('Electron')
    const isCapacitorNative = !!w.Capacitor?.isNativePlatform?.()
    const isAndroidNative = !!w.AndroidFcm
    if (isElectron || isCapacitorNative || isAndroidNative) return

    // Unlock the audio context on the first user interaction so background
    // chimes are allowed to play later. Each listener auto-removes after firing.
    const prime = () => primeChimeAudio()
    window.addEventListener('pointerdown', prime, { once: true })
    window.addEventListener('keydown', prime, { once: true })

    // Keep the audio path warm: an installed PWA suspends the AudioContext when
    // the window loses focus, so re-prime whenever we regain it — that's what
    // lets the next background chime play (the PWA case Ben hit in Chrome).
    const keepWarm = () => { if (!document.hidden) primeChimeAudio() }
    document.addEventListener('visibilitychange', keepWarm)
    window.addEventListener('focus', keepWarm)

    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let dlChannel: ReturnType<typeof supabase.channel> | null = null
    let txtChannel: ReturnType<typeof supabase.channel> | null = null
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

    // Mirrors sendHubPush's eligibility filter (isMention=false; isDm bypasses
    // the global "mentions only" level but not muted/DND).
    const isSuppressed = (roomId: string | null, isDm: boolean): boolean => {
      const s = dndStatusRef.current
      const global = globalPrefRef.current
      const roomPref = roomId ? roomPrefsRef.current[roomId] : undefined
      if (s.status === 'dnd' && (!s.status_until || new Date(s.status_until) > new Date())) return true
      if (global?.dnd_enabled) return true
      if (global && inDndWindow(global.dnd_start, global.dnd_end)) return true
      if (global?.level === 'muted') return true
      if (global?.level === 'mentions' && !isDm) return true
      if (roomPref?.level === 'muted') return true
      if (roomPref?.level === 'mentions') return true
      return false
    }

    void (async () => {
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
        .channel('web-chime-messages')
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
            }

            // Skip thread replies and the user's own messages
            if (msg.parent_id || msg.sender_id === currentUserId) return

            // Room-membership gate. DMs are gated by Realtime RLS.
            if (msg.room_id && !roomsRef.current[msg.room_id]) return

            // Respect mute / mentions-only / Do-Not-Disturb
            if (isSuppressed(msg.room_id, msg.conversation_id != null)) return

            // Per-device on/off preference
            if (!isChimeEnabled()) return

            // Ding for any qualifying new message as long as a Hub tab is open —
            // whether the user is looking at Hub or working in another tab/app.
            // De-dupe across multiple open tabs so the same message dings once.
            if (!claimChimeForMessage(msg.id)) return

            // Throttle bursts so a flurry of messages doesn't machine-gun this tab
            const now = Date.now()
            if (now - lastPlayedRef.current < 1500) return
            lastPlayedRef.current = now

            playChime()
          }
        )
        .subscribe()

      // Daily Log v1 updates aren't in the Realtime publication, so the
      // update-posted route fires a company broadcast carrying the recipient
      // list. Chime for the same updates the user is notified for — same
      // mute/DND/per-device gating as a message (treated like a DM).
      if (companyId) {
        dlChannel = supabase
          .channel(`daily-log:${companyId}`)
          .on('broadcast', { event: 'update-inserted' }, ({ payload }) => {
            const p = (payload ?? {}) as { update_id?: string; recipient_ids?: string[]; sender_id?: string }
            if (!p.update_id || p.sender_id === currentUserId) return
            if (!Array.isArray(p.recipient_ids) || !p.recipient_ids.includes(currentUserId)) return
            if (isSuppressed(null, true)) return
            if (!isChimeEnabled()) return
            if (!claimChimeForMessage('dl-' + p.update_id)) return
            const now = Date.now()
            if (now - lastPlayedRef.current < 1500) return
            lastPlayedRef.current = now
            playChime()
          })
          .subscribe()
      }

      // Txt2 inbound texts (a different table than `messages`). The inbound
      // webhook fires a company broadcast on `txt:{companyId}`; chime for it
      // like a DM (customer texts are never the user's own). De-dupe per
      // conversation across tabs via the shared claim window.
      if (companyId) {
        txtChannel = supabase
          .channel(`txt:${companyId}`)
          .on('broadcast', { event: 'inbound' }, ({ payload }) => {
            const p = (payload ?? {}) as { conversation_id?: string }
            if (!p.conversation_id) return
            if (isSuppressed(null, true)) return
            if (!isChimeEnabled()) return
            if (!claimChimeForMessage('txt-' + p.conversation_id)) return
            const now = Date.now()
            if (now - lastPlayedRef.current < 1500) return
            lastPlayedRef.current = now
            playChime()
          })
          .subscribe()
      }

      if (cancelled) {
        if (channel) supabase.removeChannel(channel)
        if (dlChannel) supabase.removeChannel(dlChannel)
        if (txtChannel) supabase.removeChannel(txtChannel)
      }
    })()

    return () => {
      cancelled = true
      window.removeEventListener('pointerdown', prime)
      window.removeEventListener('keydown', prime)
      document.removeEventListener('visibilitychange', keepWarm)
      window.removeEventListener('focus', keepWarm)
      if (channel) supabase.removeChannel(channel)
      if (dlChannel) supabase.removeChannel(dlChannel)
      if (txtChannel) supabase.removeChannel(txtChannel)
    }
  }, [currentUserId, companyId])

  return null
}
