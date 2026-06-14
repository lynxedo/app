'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useHubMessageInsert, type HubMessageEvent } from './HubMessagesProvider'
import { isChimeEnabled, playChime, primeChimeAudio, claimChimeForMessage } from '@/lib/hub-chime'
import { isHubMessagingDndNow, type DndSchedule } from '@/lib/dnd-schedule'

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
  // NT1 — the new three-tier DND (Master / Hub) lives on user_profiles.
  const newDndRef = useRef<{
    master_dnd_enabled: boolean | null
    master_dnd_schedule: DndSchedule | null
    hub_dnd_enabled: boolean | null
    hub_dnd_schedule: DndSchedule | null
  }>({ master_dnd_enabled: null, master_dnd_schedule: null, hub_dnd_enabled: null, hub_dnd_schedule: null })
  const lastPlayedRef = useRef(0)
  // #26 — message events arrive via the shared HubMessagesProvider subscription.
  // The effect below assigns the real handler (which closes over the DND/pref
  // refs); this hook just forwards each event to it. Treated as broadcast-source
  // (stricter DM membership gate) since the shared stream doesn't tag the origin
  // — `claimChimeForMessage` de-dupes the realtime + broadcast double-delivery.
  const messageHandlerRef = useRef<((m: HubMessageEvent) => void) | null>(null)
  useHubMessageInsert((msg) => messageHandlerRef.current?.(msg))
  // The user's DM conversation ids — used to gate broadcast-sourced DM chimes
  // (the hub-sidebar-messages broadcast isn't RLS-scoped, unlike postgres_changes).
  const myConvIdsRef = useRef<Set<string>>(new Set())

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
    let dlChannel: ReturnType<typeof supabase.channel> | null = null
    let txtChannel: ReturnType<typeof supabase.channel> | null = null
    let convTimer: ReturnType<typeof setInterval> | null = null
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
      // NT1 — new three-tier DND: Master (kills all) or Hub (messages) silences the chime.
      if (isHubMessagingDndNow(newDndRef.current)) return true
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
      const [{ data: prefs }, { data: me }, { data: prof }] = await Promise.all([
        supabase
          .from('notification_prefs')
          .select('room_id, level, dnd_enabled, dnd_start, dnd_end')
          .eq('user_id', currentUserId),
        supabase
          .from('hub_users')
          .select('status, status_until')
          .eq('id', currentUserId)
          .maybeSingle(),
        supabase
          .from('user_profiles')
          .select('master_dnd_enabled, master_dnd_schedule, hub_dnd_enabled, hub_dnd_schedule')
          .eq('id', currentUserId)
          .maybeSingle(),
      ])
      if (cancelled) return

      if (prof) {
        const pr = prof as {
          master_dnd_enabled: boolean | null; master_dnd_schedule: DndSchedule | null
          hub_dnd_enabled: boolean | null; hub_dnd_schedule: DndSchedule | null
        }
        newDndRef.current = {
          master_dnd_enabled: pr.master_dnd_enabled ?? null,
          master_dnd_schedule: pr.master_dnd_schedule ?? null,
          hub_dnd_enabled: pr.hub_dnd_enabled ?? null,
          hub_dnd_schedule: pr.hub_dnd_schedule ?? null,
        }
      }

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

      // The user's DM conversation ids, refreshed periodically so a broadcast-
      // sourced DM chime only fires for conversations the user is actually in
      // (the broadcast channel below isn't RLS-scoped). A brand-new DM rings via
      // the RLS-scoped postgres_changes path until the next refresh picks it up.
      const loadConvIds = async () => {
        const { data } = await supabase
          .from('conversation_members')
          .select('conversation_id')
          .eq('user_id', currentUserId)
        if (cancelled) return
        myConvIdsRef.current = new Set((data ?? []).map((r) => r.conversation_id as string))
      }
      await loadConvIds()
      if (!cancelled) convTimer = setInterval(() => { void loadConvIds() }, 120_000)

      type MsgLite = {
        id: string
        room_id: string | null
        conversation_id: string | null
        sender_id: string
        parent_id: string | null
      }

      // Shared by the (flaky) postgres_changes stream and the reliable
      // `hub-sidebar-messages` broadcast the messages API fires on every insert.
      // `fromBroadcast` tightens DM gating: postgres_changes is RLS-scoped (only
      // delivers the user's own messages), but the broadcast is company-wide, so
      // a broadcast DM event must match a known membership. De-dupe by id so the
      // two paths never double-ding.
      const handleMessage = (msg: MsgLite | null, fromBroadcast: boolean) => {
        if (!msg?.id) return
        // Skip thread replies and the user's own messages
        if (msg.parent_id || msg.sender_id === currentUserId) return
        if (msg.room_id) {
          // Room-membership gate (both paths — accurate from the rooms prop).
          if (!roomsRef.current[msg.room_id]) return
        } else if (msg.conversation_id) {
          // DMs: trust RLS on the postgres_changes path; require known
          // membership on the un-RLS'd broadcast path so we never ding for a
          // DM between other people.
          if (fromBroadcast && !myConvIdsRef.current.has(msg.conversation_id)) return
        } else {
          return
        }
        // Respect mute / mentions-only / Do-Not-Disturb
        if (isSuppressed(msg.room_id, msg.conversation_id != null)) return
        // Per-device on/off preference
        if (!isChimeEnabled()) return
        // Ding once per message across all open tabs in this browser.
        if (!claimChimeForMessage(msg.id)) return
        // Throttle bursts so a flurry of messages doesn't machine-gun this tab.
        const now = Date.now()
        if (now - lastPlayedRef.current < 1500) return
        lastPlayedRef.current = now
        playChime()
      }

      // Hub message chimes now ride the single shared HubMessagesProvider
      // subscription (one whole-table `messages` channel + the `message-inserted`
      // broadcast backstop for the entire Hub) instead of this component opening
      // its own postgres_changes + broadcast pair. We expose handleMessage via a
      // ref the top-level hook forwards to; all shared-stream events use the
      // stricter broadcast-source DM gate.
      messageHandlerRef.current = (m: HubMessageEvent) => handleMessage(
        {
          id: m.id ?? '',
          room_id: m.room_id,
          conversation_id: m.conversation_id,
          sender_id: m.sender_id ?? '',
          parent_id: m.parent_id,
        },
        true,
      )

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
            const p = (payload ?? {}) as { conversation_id?: string; recipient_ids?: string[] }
            if (!p.conversation_id) return
            // Only chime for this thread's owner + members (assigned) or the
            // Queue audience (unassigned) — the same list the inbound webhook
            // pushes to. Never ding a manager about a thread someone else has
            // already claimed. (Absent list = older payload → fall back to ring.)
            if (Array.isArray(p.recipient_ids) && !p.recipient_ids.includes(currentUserId)) return
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
        if (convTimer) clearInterval(convTimer)
        messageHandlerRef.current = null
        if (dlChannel) supabase.removeChannel(dlChannel)
        if (txtChannel) supabase.removeChannel(txtChannel)
      }
    })()

    return () => {
      cancelled = true
      if (convTimer) clearInterval(convTimer)
      messageHandlerRef.current = null
      window.removeEventListener('pointerdown', prime)
      window.removeEventListener('keydown', prime)
      document.removeEventListener('visibilitychange', keepWarm)
      window.removeEventListener('focus', keepWarm)
      if (dlChannel) supabase.removeChannel(dlChannel)
      if (txtChannel) supabase.removeChannel(txtChannel)
    }
  }, [currentUserId, companyId])

  return null
}
