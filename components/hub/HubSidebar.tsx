'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { HubUser } from './MessageFeed'
import StatusPicker, { StatusDot } from './StatusPicker'
import ClientsSidebar from './ClientsSidebar'
import { CatalogIcon } from './railCatalog'
import {
  getConversationsList,
  saveConversationsList,
  getUnreadState,
  saveUnreadState,
  saveRoomsList,
  saveHubUsers,
  evictMissingConvs,
  evictMissingRooms,
} from '@/lib/hub-cache'

type Room = { id: string; name: string; is_private: boolean }

type Conversation = {
  id: string
  participants: HubUser[]
  last_message?: string
  archived_at?: string | null
  archived?: boolean
}

type Board = { id: string; name: string; is_private: boolean; is_personal: boolean; created_by: string }


type ContextMenu = {
  x: number
  y: number
  id: string
  type: 'room' | 'conv'
}

// Tool catalog — used by Favorites to render pinned tools and by the
// Tools section to render each entry's star button. Pin IDs are
// prefixed with `tool:` and live in the same hub_pinned_ids array as
// room/conversation UUIDs.
type ToolDef = {
  id: string
  label: string
  icon: string
  href: string
  /** When `true`, the link uses startsWith for active-route matching. */
  prefixMatch?: boolean
}

const TOOL_CATALOG: Record<string, ToolDef> = {
  'tool:routing':       { id: 'tool:routing',       label: 'Routing',         icon: '⚡',  href: '/hub/routing',      prefixMatch: true },
  'tool:daily-log':     { id: 'tool:daily-log',     label: 'Daily Log',       icon: '📋', href: '/hub/daily-log',    prefixMatch: true },
  'tool:time-records':  { id: 'tool:time-records',  label: 'Time Records',    icon: '🕐', href: '/admin/timesheet',  prefixMatch: true },
  'tool:tracker':       { id: 'tool:tracker',       label: 'Tracker',         icon: '🎯', href: '/hub/tracker',      prefixMatch: true },
  'tool:lawn':          { id: 'tool:lawn',          label: 'Lawn Sizer',      icon: '🌿', href: '/hub/lawn',         prefixMatch: false },
  'tool:zone-sizer':    { id: 'tool:zone-sizer',    label: 'Zone Sizer',      icon: '💧', href: '/hub/zone-sizer',   prefixMatch: false },
  'tool:dialer':        { id: 'tool:dialer',        label: 'Dialer',          icon: '☎️', href: '/hub/dialer',       prefixMatch: true },
  'tool:call-log':      { id: 'tool:call-log',      label: 'Call Log',        icon: '📞', href: '/hub/call-log',     prefixMatch: true },
  'tool:books':         { id: 'tool:books',         label: 'Books',           icon: '📊', href: '/books',            prefixMatch: true },
  'tool:fleet':         { id: 'tool:fleet',         label: 'Fleet',           icon: '🚛', href: '/hub/fleet',        prefixMatch: true },
}

function convLabel(conv: Conversation, currentUserId: string) {
  const others = conv.participants.filter(p => p.id !== currentUserId)
  if (others.length === 0) {
    const self = conv.participants.find(p => p.id === currentUserId)
    return self?.display_name ?? 'You'
  }
  return others.map(p => p.display_name.split(' ')[0]).join(', ')
}

export default function HubSidebar({
  rooms,
  userEmail,
  currentUserId,
  hubUsers,
  currentUserStatus,
  currentUserDisplayName,
  isAdmin,
  onClose,
  onDesktopCollapse,
  textSize,
  onTextSizeChange,
  initialPinnedIds = [],
  canAccessTracker = false,
  canAccessCallLog = false,
  canAccessLawn = false,
  canAccessZoneSizer = false,
  canAccessDialer = false,
  canAccessTimesheet = false,
  canAccessRouting = false,
  canAccessBooks = false,
  canAccessFleet = false,
  myPresenceMode,
  onOpenTimeClock,
}: {
  rooms: Room[]
  userEmail: string
  currentUserId: string
  hubUsers: HubUser[]
  currentUserStatus?: string | null
  currentUserDisplayName?: string
  isAdmin?: boolean
  onClose?: () => void
  onDesktopCollapse?: () => void
  textSize?: string
  onTextSizeChange?: (size: string) => void
  initialPinnedIds?: string[]
  canAccessTracker?: boolean
  canAccessCallLog?: boolean
  canAccessLawn?: boolean
  canAccessZoneSizer?: boolean
  canAccessDialer?: boolean
  canAccessTimesheet?: boolean
  canAccessRouting?: boolean
  canAccessBooks?: boolean
  canAccessFleet?: boolean
  myPresenceMode?: 'clock' | 'activity'
  onOpenTimeClock?: () => void
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [sidebarRooms, setSidebarRooms] = useState<Room[]>(rooms)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [boards, setBoards] = useState<Board[]>([])
  const [showNewPM, setShowNewPM] = useState(false)
  const [showNewRoom, setShowNewRoom] = useState(false)
  const [showNewBoard, setShowNewBoard] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [allowMemberCreate, setAllowMemberCreate] = useState(true)

  // New room form state
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomDesc, setNewRoomDesc] = useState('')
  const [newRoomPrivate, setNewRoomPrivate] = useState(false)
  const [creatingRoom, setCreatingRoom] = useState(false)
  const [createRoomError, setCreateRoomError] = useState('')

  // Browse rooms state
  const [showBrowseRooms, setShowBrowseRooms] = useState(false)
  const [browseRooms, setBrowseRooms] = useState<{ id: string; name: string; description: string | null; is_member: boolean }[]>([])
  const [browseLoading, setBrowseLoading] = useState(false)
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null)

  // New board form state
  const [newBoardName, setNewBoardName] = useState('')
  const [newBoardType, setNewBoardType] = useState<'public' | 'private' | 'personal'>('public')
  const [creatingBoard, setCreatingBoard] = useState(false)

  // Board settings state
  const [boardSettings, setBoardSettings] = useState<Board | null>(null)
  const [settingsName, setSettingsName] = useState('')
  const [settingsType, setSettingsType] = useState<'public' | 'private' | 'personal'>('public')
  const [settingsMembers, setSettingsMembers] = useState<HubUser[]>([])
  const [settingsMembersLoading, setSettingsMembersLoading] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [addMemberOpen, setAddMemberOpen] = useState(false)

  // Unread state
  const [unreadRoomIds, setUnreadRoomIds] = useState<Set<string>>(new Set())
  const [unreadConvIds, setUnreadConvIds] = useState<Set<string>>(new Set())

  // Favorites / pinning state
  const [pinnedIds, setPinnedIds] = useState<string[]>(initialPinnedIds)

  // Collapsible sections — persisted per-user in localStorage so each section
  // (Favorites, Rooms, DMs, Boards, Tools subcategories, Pages, Links) remembers
  // its expand/collapse state across visits and across devices that share a browser.
  const sectionsStorageKey = `hub-sidebar-sections:${currentUserId}`
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  useEffect(() => {
    try {
      const raw = localStorage.getItem(sectionsStorageKey)
      if (raw) setCollapsed(JSON.parse(raw))
    } catch {}
  }, [sectionsStorageKey])
  const [showArchivedDms, setShowArchivedDms] = useState(false)
  function toggleSection(key: string) {
    setCollapsed(prev => {
      const next = { ...prev, [key]: !prev[key] }
      try { localStorage.setItem(sectionsStorageKey, JSON.stringify(next)) } catch {}
      return next
    })
  }

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  // Long-press tracking
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTargetRef = useRef<{ id: string; type: 'room' | 'conv' } | null>(null)

  // Hold the current pathname in a ref so the realtime-messages effect below
  // doesn't re-subscribe its Supabase channel on every navigation. Re-subbing
  // teardown/handshake is the single biggest source of sidebar nav lag.
  const pathnameRef = useRef(pathname)
  useEffect(() => { pathnameRef.current = pathname }, [pathname])

  const loadConversations = useCallback(() => {
    fetch('/api/hub/conversations')
      .then(r => r.json())
      .then(d => {
        const fresh = (d.conversations ?? []) as Conversation[]
        setConversations(fresh)
        // Write through to cache, then evict any messages cached for convs
        // that fell out of the fresh list (archived elsewhere, left a DM, etc.)
        saveConversationsList(fresh)
        evictMissingConvs(fresh.map(c => c.id))
      })
      .catch(() => {})
  }, [])

  const loadBoards = useCallback(() => {
    fetch('/api/hub/boards')
      .then(r => r.json())
      .then(d => setBoards(d.boards ?? []))
      .catch(() => {})
  }, [])

  // Hydrate sidebar from IndexedDB cache for an instant first paint on cold
  // start, before the network fetches return. Best-effort: if the cache is
  // empty/disabled/unavailable this no-ops and the empty initial state stays
  // until the real fetch lands. Only seed state if it's still in the initial
  // empty form so we don't clobber realtime updates that landed between mount
  // and cache-read resolution.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [cachedConvs, cachedUnread] = await Promise.all([
        getConversationsList(),
        getUnreadState(currentUserId),
      ])
      if (cancelled) return
      if (cachedConvs && cachedConvs.length) {
        setConversations(prev => (prev.length === 0 ? (cachedConvs as Conversation[]) : prev))
      }
      if (cachedUnread) {
        setUnreadRoomIds(prev => (prev.size === 0 ? new Set(cachedUnread.unread_room_ids) : prev))
        setUnreadConvIds(prev => (prev.size === 0 ? new Set(cachedUnread.unread_conv_ids) : prev))
      }
    })()
    return () => { cancelled = true }
  }, [currentUserId])

  // Persist server-rendered rooms + hubUsers to cache. These come from the
  // layout's SSR fetch, so the cache copy is for downstream consumers
  // (MessageFeed mention rendering, future cold-start sidebar paint of rooms).
  // Also evict messages for rooms the user is no longer a member of.
  useEffect(() => {
    saveRoomsList(rooms)
    evictMissingRooms(rooms.map(r => r.id))
  }, [rooms])

  useEffect(() => {
    saveHubUsers(hubUsers)
  }, [hubUsers])

  useEffect(() => { loadConversations() }, [loadConversations])
  useEffect(() => { loadBoards() }, [loadBoards])

  // Refresh conversations when Quick Compose creates a new one
  useEffect(() => {
    window.addEventListener('hub-conversation-created', loadConversations)
    return () => window.removeEventListener('hub-conversation-created', loadConversations)
  }, [loadConversations])

  useEffect(() => {
    fetch('/api/hub/settings')
      .then(r => r.json())
      .then(d => setAllowMemberCreate(d.allow_member_room_creation ?? true))
      .catch(() => {})
  }, [])

  // Load unread status on mount AND poll every 60s. Realtime is the primary
  // path (postgres_changes on `messages`) but is known to drop silently in
  // some cases (admin-client inserts, RLS edge cases — see CLAUDE.md
  // Session 41.5 notes). The poll guarantees the per-row dots in the sidebar
  // match the orange dot on the rail's Hub icon within a minute.
  useEffect(() => {
    let cancelled = false
    function tick() {
      fetch('/api/hub/read-receipts', { cache: 'no-store' })
        .then(r => r.json())
        .then(d => {
          if (cancelled) return
          const roomIds = (d.unread_room_ids ?? []) as string[]
          const convIds = (d.unread_conv_ids ?? []) as string[]
          setUnreadRoomIds(new Set(roomIds))
          setUnreadConvIds(new Set(convIds))
          saveUnreadState(currentUserId, roomIds, convIds)
        })
        .catch(() => {})
    }
    tick()
    const id = setInterval(tick, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [currentUserId])

  // Realtime: mark rooms/convs unread when new messages arrive
  useEffect(() => {
    const supabase = createClient()
    const handleInsert = (msg: { room_id: string | null; conversation_id: string | null; sender_id: string; parent_id: string | null }) => {
      // Ignore thread replies and messages sent by this user
      if (msg.parent_id || msg.sender_id === currentUserId) return
      const currentPath = pathnameRef.current
      const activeRoomMatch = currentPath.match(/^\/hub\/([^/]+)$/)
      const activePmMatch = currentPath.match(/^\/hub\/pm\/([^/]+)$/)
      if (msg.room_id) {
        // Don't mark unread if user is currently viewing this room
        if (activeRoomMatch?.[1] === msg.room_id) return
        setUnreadRoomIds(prev => new Set([...prev, msg.room_id!]))
      } else if (msg.conversation_id) {
        if (activePmMatch?.[1] === msg.conversation_id) return
        setUnreadConvIds(prev => new Set([...prev, msg.conversation_id!]))
        // Refetch so the conversation's archived flag updates from the
        // server-side auto-unarchive hook.
        loadConversations()
      }
    }

    const channel = supabase
      .channel('sidebar-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          handleInsert(payload.new as Parameters<typeof handleInsert>[0])
        }
      )
      .subscribe()

    // Broadcast fallback for admin-client inserts (e.g. Chat Synx inbound from
    // Slack) where postgres_changes silently drops events for unknown reasons
    // — same pattern as Session 43.5 hub_users. The events route fires this.
    const broadcastChannel = supabase
      .channel('hub-sidebar-messages')
      .on('broadcast', { event: 'message-inserted' }, (payload) => {
        const p = (payload.payload ?? {}) as { room_id?: string | null; conversation_id?: string | null; sender_id?: string; parent_id?: string | null }
        if (!p.sender_id) return
        handleInsert({
          room_id: p.room_id ?? null,
          conversation_id: p.conversation_id ?? null,
          sender_id: p.sender_id,
          parent_id: p.parent_id ?? null,
        })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      supabase.removeChannel(broadcastChannel)
    }
    // Intentionally exclude pathname — we read it via pathnameRef so the
    // channel doesn't tear down and re-subscribe on every navigation.
  }, [currentUserId, loadConversations])

  // Realtime: keep sidebar status dots in sync when teammates change status.
  // Uses a Supabase broadcast channel rather than postgres_changes on hub_users.
  // postgres_changes wasn't delivering events for that table for unknown reasons
  // (publication, replica identity FULL, and RLS were all set correctly).
  // The StatusPicker calls onStatusChanged after saving; that handler patches
  // local state for this user's self-DM dot AND broadcasts to all other Hub
  // clients so their sidebars update too.
  const statusChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null)
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('hub-status-broadcast')
      .on(
        'broadcast',
        { event: 'status-changed' },
        ({ payload }: { payload: { user_id: string; status: string | null } }) => {
          // Manual dnd/busy always wins; available/null falls back to the
          // existing effective_status (which the next conversations refetch
          // will refresh based on clock-in / last_active_at).
          // Preserve refs for conversations that don't include the changed
          // user — keeps memoized rows from re-rendering for no reason.
          setConversations(prev => prev.map(c => {
            const i = c.participants.findIndex(p => p.id === payload.user_id)
            if (i === -1) return c
            const oldP = c.participants[i]
            const newStatus = payload.status
            const newEffective = newStatus === 'dnd' || newStatus === 'busy'
              ? newStatus
              : oldP.effective_status ?? newStatus
            if (oldP.status === newStatus && oldP.effective_status === newEffective) return c
            const newParticipants = c.participants.slice()
            newParticipants[i] = { ...oldP, status: newStatus, effective_status: newEffective }
            return { ...c, participants: newParticipants }
          }))
        }
      )
      .on(
        'broadcast',
        { event: 'presence-changed' },
        ({ payload }: { payload: { user_id: string; effective_status: string } }) => {
          // Fires from: clock-in/out (timesheet), client-side 2h idle timer,
          // and the "going-online" page-load broadcast. Patches effective_status
          // only — manual status field is untouched.
          setConversations(prev => prev.map(c => {
            const i = c.participants.findIndex(p => p.id === payload.user_id)
            if (i === -1) return c
            const oldP = c.participants[i]
            if (oldP.effective_status === payload.effective_status) return c
            const newParticipants = c.participants.slice()
            newParticipants[i] = { ...oldP, effective_status: payload.effective_status }
            return { ...c, participants: newParticipants }
          }))
        }
      )
      .subscribe()
    statusChannelRef.current = channel
    return () => { supabase.removeChannel(channel); statusChannelRef.current = null }
  }, [])

  // Client-side 2h idle timer for salaried/activity-path users. Each Hub
  // navigation resets the timer; when it fires, broadcast 'offline' so other
  // people's sidebars drop the user's dot to gray without waiting for a
  // refetch. Skipped for hourly users — their dot is driven by clock state.
  // Manual dnd/busy is unaffected (broadcast handler only patches
  // effective_status, and the next conversations refetch reconciles).
  useEffect(() => {
    if (myPresenceMode !== 'activity') return
    if (!currentUserStatus || currentUserStatus === 'available') {
      // Bump local effective_status to 'available' on every navigation since
      // we know the server just wrote last_active_at. Preserve refs for
      // conversations that don't include the user.
      setConversations(prev => prev.map(c => {
        const i = c.participants.findIndex(p => p.id === currentUserId)
        if (i === -1) return c
        const oldP = c.participants[i]
        const next = oldP.status === 'dnd' || oldP.status === 'busy' ? oldP.status : 'available'
        if (oldP.effective_status === next) return c
        const newParticipants = c.participants.slice()
        newParticipants[i] = { ...oldP, effective_status: next }
        return { ...c, participants: newParticipants }
      }))
    }
    const id = setTimeout(() => {
      // Don't override manual dnd/busy.
      if (currentUserStatus === 'dnd' || currentUserStatus === 'busy') return
      statusChannelRef.current?.send({
        type: 'broadcast',
        event: 'presence-changed',
        payload: { user_id: currentUserId, effective_status: 'offline' },
      })
      setConversations(prev => prev.map(c => {
        const i = c.participants.findIndex(p => p.id === currentUserId)
        if (i === -1) return c
        const oldP = c.participants[i]
        if (oldP.effective_status === 'offline') return c
        const newParticipants = c.participants.slice()
        newParticipants[i] = { ...oldP, effective_status: 'offline' }
        return { ...c, participants: newParticipants }
      }))
    }, 2 * 60 * 60 * 1000)
    return () => clearTimeout(id)
  }, [pathname, currentUserId, currentUserStatus, myPresenceMode])

  const handleOwnStatusChanged = useCallback((newStatus: string | null) => {
    // Patch own conversations state so the self-DM dot flips immediately —
    // broadcasts skip the sender by default in Supabase Realtime. Preserve
    // refs for conversations that don't include the user.
    setConversations(prev => prev.map(c => {
      const i = c.participants.findIndex(p => p.id === currentUserId)
      if (i === -1) return c
      const oldP = c.participants[i]
      const newEffective = newStatus === 'dnd' || newStatus === 'busy'
        ? newStatus
        : oldP.effective_status ?? newStatus
      if (oldP.status === newStatus && oldP.effective_status === newEffective) return c
      const newParticipants = c.participants.slice()
      newParticipants[i] = { ...oldP, status: newStatus, effective_status: newEffective }
      return { ...c, participants: newParticipants }
    }))
    // Fire-and-forget broadcast so other Hub clients update live.
    statusChannelRef.current?.send({
      type: 'broadcast',
      event: 'status-changed',
      payload: { user_id: currentUserId, status: newStatus },
    })
  }, [currentUserId])

  // Mark as read when the user navigates to a room or PM
  useEffect(() => {
    const roomMatch = pathname.match(/^\/hub\/([^/]+)$/)
    const pmMatch = pathname.match(/^\/hub\/pm\/([^/]+)$/)
    if (roomMatch) {
      const roomId = roomMatch[1]
      setUnreadRoomIds(prev => { const next = new Set(prev); next.delete(roomId); return next })
      fetch('/api/hub/read-receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id: roomId }),
      }).catch(() => {})
    } else if (pmMatch) {
      const convId = pmMatch[1]
      setUnreadConvIds(prev => { const next = new Set(prev); next.delete(convId); return next })
      fetch('/api/hub/read-receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: convId }),
      }).catch(() => {})
    }
  }, [pathname])

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    function handleClick(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [contextMenu])

  const canCreateRoom = isAdmin || allowMemberCreate

  async function createConversation() {
    if (selectedIds.length === 0 || creating) return
    setCreating(true)
    const res = await fetch('/api/hub/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participant_ids: selectedIds }),
    })
    const data = await res.json()
    setCreating(false)
    setShowNewPM(false)
    setSelectedIds([])
    if (data.id) {
      loadConversations()
      router.push(`/hub/pm/${data.id}`)
    }
  }

  async function createRoom() {
    if (!newRoomName.trim() || creatingRoom) return
    setCreatingRoom(true)
    setCreateRoomError('')
    const res = await fetch('/api/hub/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newRoomName.trim(), description: newRoomDesc.trim() || null, is_private: newRoomPrivate }),
    })
    const data = await res.json()
    setCreatingRoom(false)
    if (res.ok) {
      const newRoom = { id: data.id, name: data.name, is_private: data.is_private }
      setSidebarRooms(prev => [...prev, newRoom].sort((a, b) => a.name.localeCompare(b.name)))
      setShowNewRoom(false)
      setNewRoomName(''); setNewRoomDesc(''); setNewRoomPrivate(false); setCreateRoomError('')
      router.push(`/hub/${data.id}`)
    } else {
      setCreateRoomError(data.error ?? 'Failed to create room')
    }
  }

  async function leaveRoom(roomId: string, roomName: string) {
    if (!confirm(`Leave #${roomName}? You can rejoin public rooms from Browse Rooms.`)) return
    const res = await fetch(`/api/hub/rooms/${roomId}/leave`, { method: 'DELETE' })
    if (res.ok) {
      setSidebarRooms(prev => prev.filter(r => r.id !== roomId))
      if (pathname === `/hub/${roomId}`) router.push('/hub')
    }
    setContextMenu(null)
  }

  async function loadBrowseRooms() {
    setBrowseLoading(true)
    const res = await fetch('/api/hub/rooms-browse')
    const data = await res.json()
    setBrowseRooms(data.rooms ?? [])
    setBrowseLoading(false)
  }

  async function joinRoom(roomId: string) {
    setJoiningRoomId(roomId)
    const res = await fetch(`/api/hub/rooms/${roomId}/join`, { method: 'POST' })
    const data = await res.json()
    setJoiningRoomId(null)
    if (res.ok) {
      setBrowseRooms(prev => prev.map(r => r.id === roomId ? { ...r, is_member: true } : r))
      setSidebarRooms(prev => {
        if (prev.find(r => r.id === roomId)) return prev
        return [...prev, { id: data.id, name: data.name, is_private: data.is_private }].sort((a, b) => a.name.localeCompare(b.name))
      })
    }
  }

  async function leaveRoomFromBrowse(roomId: string) {
    const res = await fetch(`/api/hub/rooms/${roomId}/leave`, { method: 'DELETE' })
    if (res.ok) {
      setBrowseRooms(prev => prev.map(r => r.id === roomId ? { ...r, is_member: false } : r))
      setSidebarRooms(prev => prev.filter(r => r.id !== roomId))
    }
  }

  async function createBoard() {
    if (!newBoardName.trim() || creatingBoard) return
    setCreatingBoard(true)
    const res = await fetch('/api/hub/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newBoardName.trim(),
        is_private: newBoardType === 'private' || newBoardType === 'personal',
        is_personal: newBoardType === 'personal',
      }),
    })
    const data = await res.json()
    setCreatingBoard(false)
    if (res.ok) {
      setBoards(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setShowNewBoard(false)
      setNewBoardName(''); setNewBoardType('public')
      router.push(`/hub/board/${data.id}`)
    }
  }

  async function openBoardSettings(board: Board) {
    setBoardSettings(board)
    setSettingsName(board.name)
    setSettingsType(board.is_personal ? 'personal' : board.is_private ? 'private' : 'public')
    setSettingsMembers([])
    setAddMemberOpen(false)
    if (board.is_private && !board.is_personal) {
      setSettingsMembersLoading(true)
      const res = await fetch(`/api/hub/boards/${board.id}/members`)
      const data = await res.json()
      setSettingsMembers(data.members ?? [])
      setSettingsMembersLoading(false)
    }
  }

  async function saveBoardSettings() {
    if (!boardSettings || !settingsName.trim() || savingSettings) return
    setSavingSettings(true)
    const res = await fetch(`/api/hub/boards/${boardSettings.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: settingsName.trim(),
        is_private: settingsType === 'private' || settingsType === 'personal',
        is_personal: settingsType === 'personal',
      }),
    })
    const data = await res.json()
    setSavingSettings(false)
    if (res.ok) {
      setBoards(prev => prev.map(b => b.id === boardSettings.id ? { ...b, ...data } : b))
      setBoardSettings(null)
    }
  }

  async function deleteBoardConfirm() {
    if (!boardSettings) return
    if (!confirm(`Delete "${boardSettings.name}"? This will permanently delete all tasks.`)) return
    const res = await fetch(`/api/hub/boards/${boardSettings.id}`, { method: 'DELETE' })
    if (res.ok) {
      setBoards(prev => prev.filter(b => b.id !== boardSettings.id))
      setBoardSettings(null)
      if (pathname === `/hub/board/${boardSettings.id}`) router.push('/hub')
    }
  }

  async function addBoardMember(userId: string) {
    if (!boardSettings) return
    const res = await fetch(`/api/hub/boards/${boardSettings.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    })
    if (res.ok) {
      const user = hubUsers.find(u => u.id === userId)
      if (user && !settingsMembers.find(m => m.id === userId)) {
        setSettingsMembers(prev => [...prev, user])
      }
    }
    setAddMemberOpen(false)
  }

  async function removeBoardMember(userId: string) {
    if (!boardSettings) return
    const res = await fetch(`/api/hub/boards/${boardSettings.id}/members/${userId}`, { method: 'DELETE' })
    if (res.ok) setSettingsMembers(prev => prev.filter(m => m.id !== userId))
  }

  function toggleUser(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  // Pin / unpin
  function togglePin(id: string) {
    setPinnedIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hub_pinned_ids: next }),
      }).catch(() => {})
      return next
    })
    setContextMenu(null)
  }

  async function archiveConversation(convId: string) {
    setContextMenu(null)
    setConversations(prev => prev.map(c =>
      c.id === convId ? { ...c, archived: true, archived_at: new Date().toISOString() } : c
    ))
    await fetch(`/api/hub/conversations/${convId}/archive`, { method: 'POST' }).catch(() => {})
    loadConversations()
  }

  const unarchiveConversation = useCallback(async (convId: string) => {
    setContextMenu(null)
    setConversations(prev => prev.map(c =>
      c.id === convId ? { ...c, archived: false, archived_at: null } : c
    ))
    await fetch(`/api/hub/conversations/${convId}/unarchive`, { method: 'POST' }).catch(() => {})
    loadConversations()
  }, [loadConversations])

  // Context menu trigger
  const openContextMenu = useCallback((e: React.MouseEvent, id: string, type: 'room' | 'conv') => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, id, type })
  }, [])

  // Long press handlers for mobile
  const onTouchStart = useCallback((id: string, type: 'room' | 'conv') => {
    longPressTargetRef.current = { id, type }
    longPressTimerRef.current = setTimeout(() => {
      const target = longPressTargetRef.current
      if (!target) return
      // Show context menu in center of screen for mobile
      setContextMenu({ x: window.innerWidth / 2 - 80, y: window.innerHeight / 2 - 40, id: target.id, type: target.type })
    }, 500)
  }, [])

  const onTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    longPressTargetRef.current = null
  }, [])

  // Include self so the user can pick themselves to open the self-DM (a
  // single-member scratchpad). Bots remain hidden.
  const otherUsers = hubUsers.filter(u => !u.is_bot)
  const displayName = currentUserDisplayName ?? userEmail.split('@')[0]

  // Sort rooms: unread first, then alpha. Memoized so we don't re-sort on
  // every render (status broadcasts, focus events, etc. fire constantly).
  const sortedRooms = useMemo(() => {
    return [...sidebarRooms].sort((a, b) => {
      const aUnread = unreadRoomIds.has(a.id)
      const bUnread = unreadRoomIds.has(b.id)
      if (aUnread && !bUnread) return -1
      if (!aUnread && bUnread) return 1
      return a.name.localeCompare(b.name)
    })
  }, [sidebarRooms, unreadRoomIds])

  // Sort conversations: unread first. Then split into active vs archived.
  // A conv with unread messages always shows as active even if backend
  // computed it archived (auto-archive shouldn't hide something you haven't read).
  const sortedConvs = useMemo(() => {
    return [...conversations].sort((a, b) => {
      const aUnread = unreadConvIds.has(a.id)
      const bUnread = unreadConvIds.has(b.id)
      if (aUnread && !bUnread) return -1
      if (!aUnread && bUnread) return 1
      return 0
    })
  }, [conversations, unreadConvIds])
  const activeConvs = useMemo(
    () => sortedConvs.filter(c => !c.archived || unreadConvIds.has(c.id)),
    [sortedConvs, unreadConvIds]
  )
  const archivedConvs = useMemo(
    () => sortedConvs.filter(c => c.archived && !unreadConvIds.has(c.id)),
    [sortedConvs, unreadConvIds]
  )

  // Build favorites list
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds])
  const favoriteRooms = useMemo(() => sortedRooms.filter(r => pinnedSet.has(r.id)), [sortedRooms, pinnedSet])
  const favoriteConvs = useMemo(() => sortedConvs.filter(c => pinnedSet.has(c.id)), [sortedConvs, pinnedSet])

  // Unread surfacing — rooms and DMs with unread messages also appear in a
  // dedicated section at the top of the sidebar, so they stay visible even
  // when the user has Rooms/DMs sections collapsed.
  const unreadRoomsList = useMemo(() => sortedRooms.filter(r => unreadRoomIds.has(r.id)), [sortedRooms, unreadRoomIds])
  const unreadConvsList = useMemo(() => sortedConvs.filter(c => unreadConvIds.has(c.id)), [sortedConvs, unreadConvIds])
  const hasUnreadItems = unreadRoomsList.length > 0 || unreadConvsList.length > 0

  // Warm the Next.js router cache for the top unread rooms + DMs so the user's
  // first click after a cold start lands instantly (no RSC fetch round-trip).
  // router.prefetch is idempotent and Next dedupes — repeated calls are cheap.
  // Capped at 5 each to avoid hammering the server with prefetches the user
  // may never need.
  useEffect(() => {
    unreadRoomsList.slice(0, 5).forEach(r => router.prefetch(`/hub/${r.id}`))
    unreadConvsList.slice(0, 5).forEach(c => router.prefetch(`/hub/pm/${c.id}`))
  }, [unreadRoomsList, unreadConvsList, router])

  // Pinned tools — filter by current access so a tool the user lost
  // permission to doesn't render a dead link.
  const toolAccess: Record<string, boolean> = {
    'tool:routing':      canAccessRouting,
    'tool:daily-log':    true,
    'tool:time-records': !!isAdmin,
    'tool:tracker':      canAccessTracker,
    'tool:lawn':         canAccessLawn,
    'tool:zone-sizer':   canAccessZoneSizer,
    'tool:dialer':       canAccessDialer,
    'tool:call-log':     canAccessCallLog,
    'tool:books':        canAccessBooks,
    'tool:fleet':        canAccessFleet,
  }
  const favoriteTools: ToolDef[] = pinnedIds
    .filter(id => id.startsWith('tool:') && TOOL_CATALOG[id] && toolAccess[id])
    .map(id => TOOL_CATALOG[id])

  const hasFavorites = favoriteRooms.length > 0 || favoriteConvs.length > 0 || favoriteTools.length > 0

  function renderRoom(room: Room, showPrefix = true) {
    const isActive = pathname === `/hub/${room.id}`
    const hasUnread = unreadRoomIds.has(room.id)
    return (
      <Link
        key={room.id}
        href={`/hub/${room.id}`}
        onClick={() => onClose?.()}
        onContextMenu={e => openContextMenu(e, room.id, 'room')}
        onTouchStart={() => onTouchStart(room.id, 'room')}
        onTouchEnd={onTouchEnd}
        onTouchMove={onTouchEnd}
        className={`flex items-center gap-1.5 px-2 py-2 md:py-1.5 rounded text-lg md:text-sm transition-colors ${
          isActive ? 'bg-[#2E7EB8] text-white font-medium' : 'text-white/70 hover:bg-white/10 hover:text-white'
        }`}
      >
        {showPrefix && <span className="text-white/40 text-xs flex-none">{room.is_private ? '🔒' : '#'}</span>}
        <span className="truncate flex-1">{room.name}</span>
        {hasUnread && !isActive && (
          <span className="flex-none w-2 h-2 rounded-full bg-[#f97316]" />
        )}
      </Link>
    )
  }

  function renderConv(conv: Conversation, showPrefix = true, muted = false) {
    const label = convLabel(conv, currentUserId)
    const isActive = pathname === `/hub/pm/${conv.id}`
    const hasUnread = unreadConvIds.has(conv.id)
    const baseColor = muted
      ? 'text-white/40 hover:bg-white/5 hover:text-white/70'
      : 'text-white/70 hover:bg-white/10 hover:text-white'
    // Solo prefix = StatusDot for the one person on the other end (or self for self-DM).
    // Group prefix (3+ people) keeps 💬 since no single status applies.
    const others = conv.participants.filter(p => p.id !== currentUserId)
    const soloPerson =
      others.length === 1 ? others[0]
      : others.length === 0 && conv.participants.length === 1 ? conv.participants[0]
      : null
    return (
      <div key={conv.id} className="group/conv flex items-center">
        <Link
          href={`/hub/pm/${conv.id}`}
          onClick={() => onClose?.()}
          onContextMenu={e => openContextMenu(e, conv.id, 'conv')}
          onTouchStart={() => onTouchStart(conv.id, 'conv')}
          onTouchEnd={onTouchEnd}
          onTouchMove={onTouchEnd}
          className={`flex items-center gap-1.5 px-2 py-2 md:py-1.5 rounded text-lg md:text-sm transition-colors flex-1 min-w-0 ${
            isActive ? 'bg-[#2E7EB8] text-white font-medium' : baseColor
          }`}
        >
          {soloPerson ? (
            <StatusDot status={soloPerson.effective_status ?? soloPerson.status ?? null} />
          ) : showPrefix ? (
            <span className={`text-xs flex-none ${muted ? 'text-white/20' : 'text-white/30'}`}>💬</span>
          ) : null}
          <span className="truncate flex-1">{label}</span>
          {hasUnread && !isActive && (
            <span className="flex-none w-2 h-2 rounded-full bg-[#f97316]" />
          )}
        </Link>
        {muted && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); unarchiveConversation(conv.id) }}
            className="p-1.5 text-white/30 hover:text-white/70 transition-opacity flex-none"
            title="Unarchive"
            aria-label="Unarchive conversation"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2v-9a2 2 0 00-2-2M5 8V5a2 2 0 012-2h10a2 2 0 012 2v3M9 12l3-3m0 0l3 3m-3-3v9" />
            </svg>
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      <aside className="w-screen md:w-72 flex-none bg-[#1A3D5C] flex flex-col h-full">
        {/* Workspace header */}
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
          <div className="font-bold text-white text-lg md:text-sm tracking-wide min-w-0 truncate">Hub</div>
          <div className="flex items-center gap-1 flex-none">
            {onDesktopCollapse && (
              <button
                onClick={onDesktopCollapse}
                className="hidden md:flex items-center justify-center text-white/40 hover:text-white/80 transition-colors p-1 rounded"
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="md:hidden text-white/40 hover:text-white/70 transition-colors p-1 rounded"
                aria-label="Close sidebar"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">

          {/* My Time Clock — backup access in case the user bypassed the
              landing page (where the full Time Clock card lives). */}
          {(canAccessTimesheet || isAdmin) && (
            <div className="space-y-0.5">
              <button
                onClick={() => onOpenTimeClock?.()}
                className="w-full flex items-center gap-2 px-2 py-2 md:py-1.5 rounded text-lg md:text-sm transition-colors text-white/70 hover:bg-white/10 hover:text-white"
              >
                <span className="flex-none w-5 h-5 flex items-center justify-center"><CatalogIcon id="time-clock" /></span>
                <span className="truncate flex-1 text-left">My Time Clock</span>
              </button>
            </div>
          )}

          {/* Daily Log — second priority entry. */}
          <div className="space-y-0.5">
            <Link
              href="/hub/daily-log"
              onClick={() => onClose?.()}
              className={`flex items-center gap-2 px-2 py-2 md:py-1.5 rounded text-lg md:text-sm transition-colors ${
                pathname.startsWith('/hub/daily-log') ? 'bg-[#2E7EB8] text-white font-medium' : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className="flex-none w-5 h-5 flex items-center justify-center"><CatalogIcon id="daily-log" /></span>
              <span className="truncate flex-1">Daily Log</span>
            </Link>
          </div>

          {/* Unread — surfaces any room or DM with unread messages. Hides
              entirely when nothing is unread. */}
          {hasUnreadItems && (
            <div>
              <div className="px-2 mb-1">
                <span className="text-sm md:text-xs font-semibold text-orange-300 uppercase tracking-wider">Unread</span>
              </div>
              {unreadConvsList.map(conv => renderConv(conv))}
              {unreadRoomsList.map(room => renderRoom(room))}
            </div>
          )}

          {/* Favorites */}
          {hasFavorites && (
            <div>
              <button onClick={() => toggleSection('favorites')} className="w-full flex items-center justify-between px-2 mb-1 group">
                <span className="text-sm md:text-xs font-semibold text-amber-300 uppercase tracking-wider group-hover:text-amber-200">Favorites</span>
                <svg className={`w-3 h-3 text-white/30 transition-transform ${collapsed.favorites ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
              </button>
              {!collapsed.favorites && (
                <>
                  {favoriteRooms.map(room => renderRoom(room, false))}
                  {favoriteConvs.map(conv => renderConv(conv, false))}
                  {favoriteTools.map(tool => {
                    const isActive = tool.prefixMatch ? pathname.startsWith(tool.href) : pathname === tool.href
                    return (
                      <div key={tool.id} className="group/fav flex items-center">
                        <Link
                          href={tool.href}
                          onClick={() => onClose?.()}
                          className={`flex items-center gap-1.5 px-2 py-2 md:py-1.5 rounded text-lg md:text-sm transition-colors flex-1 ${
                            isActive ? 'bg-[#2E7EB8] text-white font-medium' : 'text-white/70 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <span className="text-xs flex-none">{tool.icon}</span>
                          <span className="truncate flex-1">{tool.label}</span>
                        </Link>
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePin(tool.id) }}
                          className="p-1.5 opacity-0 group-hover/fav:opacity-100 text-yellow-400 hover:text-yellow-300 transition-opacity"
                          title="Unpin from Favorites"
                          aria-label="Unpin from Favorites"
                        >
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                        </button>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          )}

          {/* Rooms */}
          <div>
            <div className="flex items-center justify-between px-2 mb-1">
              <button onClick={() => toggleSection('rooms')} className="flex items-center gap-1 group">
                <svg className={`w-3 h-3 text-white/30 transition-transform ${collapsed.rooms ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                <span className="text-sm md:text-xs font-semibold text-amber-300 uppercase tracking-wider group-hover:text-amber-200">Rooms</span>
              </button>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setShowBrowseRooms(true); loadBrowseRooms() }}
                  className="text-white/40 hover:text-white/70 transition-colors text-xs px-1 py-0.5 rounded"
                  title="Browse rooms"
                >
                  Browse
                </button>
                {canCreateRoom && (
                  <button
                    onClick={() => { setShowNewRoom(true); setNewRoomName(''); setNewRoomDesc(''); setNewRoomPrivate(false); setCreateRoomError('') }}
                    className="text-white/40 hover:text-white/70 transition-colors text-lg leading-none"
                    title="New room"
                  >
                    +
                  </button>
                )}
              </div>
            </div>
            {!collapsed.rooms && sortedRooms.map(room => renderRoom(room))}
          </div>

          {/* Direct Messages */}
          <div>
            <div className="flex items-center justify-between px-2 mb-1">
              <button onClick={() => toggleSection('dms')} className="flex items-center gap-1 group">
                <svg className={`w-3 h-3 text-white/30 transition-transform ${collapsed.dms ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                <span className="text-sm md:text-xs font-semibold text-amber-300 uppercase tracking-wider group-hover:text-amber-200">Direct Messages</span>
              </button>
              <button
                onClick={() => { setShowNewPM(true); setSelectedIds([]) }}
                className="text-white/40 hover:text-white/70 transition-colors text-lg leading-none"
                title="New direct message"
              >
                +
              </button>
            </div>
            {!collapsed.dms && conversations.length === 0 && (
              <p className="text-xs text-white/30 px-2 py-1">No messages yet</p>
            )}
            {!collapsed.dms && activeConvs.map(conv => renderConv(conv))}
            {!collapsed.dms && archivedConvs.length > 0 && (
              <>
                <button
                  onClick={() => setShowArchivedDms(v => !v)}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 mt-1 rounded text-xs text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
                >
                  <svg className={`w-3 h-3 transition-transform ${showArchivedDms ? '' : '-rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  <span className="truncate">{showArchivedDms ? 'Hide archived' : `Show ${archivedConvs.length} archived`}</span>
                </button>
                {showArchivedDms && archivedConvs.map(conv => renderConv(conv, true, true))}
              </>
            )}
          </div>

          {/* Boards */}
          <div>
            <div className="flex items-center justify-between px-2 mb-1">
              <button onClick={() => toggleSection('boards')} className="flex items-center gap-1 group">
                <svg className={`w-3 h-3 text-white/30 transition-transform ${collapsed.boards ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                <span className="text-sm md:text-xs font-semibold text-amber-300 uppercase tracking-wider group-hover:text-amber-200">Boards</span>
              </button>
              <button
                onClick={() => { setShowNewBoard(true); setNewBoardName(''); setNewBoardType('public') }}
                className="text-white/40 hover:text-white/70 transition-colors text-lg leading-none"
                title="New board"
              >
                +
              </button>
            </div>
            {!collapsed.boards && boards.length === 0 && (
              <p className="text-xs text-white/30 px-2 py-1">No boards yet</p>
            )}
            {!collapsed.boards && boards.map(board => {
              const isActive = pathname === `/hub/board/${board.id}`
              const isOwner = board.created_by === currentUserId
              return (
                <div key={board.id} className="flex items-center group/board">
                  <Link
                    href={`/hub/board/${board.id}`}
                    onClick={() => onClose?.()}
                    className={`flex items-center gap-1.5 px-2 py-2 md:py-1.5 rounded text-lg md:text-sm transition-colors flex-1 min-w-0 ${
                      isActive ? 'bg-[#2E7EB8] text-white font-medium' : 'text-white/70 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <span className="text-white/40 text-xs flex-none">
                      {board.is_personal ? '👤' : board.is_private ? '🔒' : '☑'}
                    </span>
                    <span className="truncate flex-1">{board.name}</span>
                  </Link>
                  {isOwner && (
                    <button
                      onClick={e => { e.stopPropagation(); openBoardSettings(board) }}
                      className="opacity-0 group-hover/board:opacity-100 p-1 mr-1 text-white/30 hover:text-white/60 transition-all flex-none rounded"
                      title="Board settings"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </button>
                  )}
                </div>
              )
            })}
          </div>


        </nav>
      </aside>

      {/* Context menu for pin/unpin */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-[100] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => togglePin(contextMenu.id)}
            className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-800 transition-colors flex items-center gap-2"
          >
            {pinnedSet.has(contextMenu.id) ? (
              <>
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Remove from Favorites
              </>
            ) : (
              <>
                <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
                Add to Favorites
              </>
            )}
          </button>
          {contextMenu.type === 'room' && (() => {
            const room = sidebarRooms.find(r => r.id === contextMenu.id)
            return room ? (
              <button
                onClick={() => leaveRoom(room.id, room.name)}
                className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-gray-800 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Leave room
              </button>
            ) : null
          })()}
          {contextMenu.type === 'conv' && (() => {
            const conv = conversations.find(c => c.id === contextMenu.id)
            if (!conv) return null
            return conv.archived ? (
              <button
                onClick={() => unarchiveConversation(conv.id)}
                className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-800 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2v-9a2 2 0 00-2-2M5 8V5a2 2 0 012-2h10a2 2 0 012 2v3M9 12l3-3m0 0l3 3m-3-3v9" />
                </svg>
                Unarchive conversation
              </button>
            ) : (
              <button
                onClick={() => archiveConversation(conv.id)}
                className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-800 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2v-9a2 2 0 00-2-2M5 8V5a2 2 0 012-2h10a2 2 0 012 2v3M9 12l3 3m0 0l3-3m-3 3V9" />
                </svg>
                Archive conversation
              </button>
            )
          })()}
        </div>
      )}

      {/* New Room modal */}
      {showNewRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="font-semibold text-white">New Room</h2>
              <button onClick={() => setShowNewRoom(false)} className="text-gray-500 hover:text-gray-300 transition-colors">✕</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <input
                autoFocus
                value={newRoomName}
                onChange={e => setNewRoomName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createRoom()}
                placeholder="Room name"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
              />
              <input
                value={newRoomDesc}
                onChange={e => setNewRoomDesc(e.target.value)}
                placeholder="Description (optional)"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
              />
              <label className="flex items-center gap-2.5 text-sm text-gray-300 cursor-pointer select-none">
                <div
                  onClick={() => setNewRoomPrivate(v => !v)}
                  className={`w-9 h-5 rounded-full transition-colors relative flex-none cursor-pointer ${newRoomPrivate ? 'bg-[#2E7EB8]' : 'bg-gray-700'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${newRoomPrivate ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
                Private room
              </label>
              {createRoomError && <p className="text-xs text-red-400">{createRoomError}</p>}
            </div>
            <div className="px-5 py-4 border-t border-gray-800 flex gap-3">
              <button
                onClick={() => setShowNewRoom(false)}
                className="flex-1 py-2 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createRoom}
                disabled={!newRoomName.trim() || creatingRoom}
                className="flex-1 py-2 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
              >
                {creatingRoom ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Board modal */}
      {showNewBoard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="font-semibold text-white">New Board</h2>
              <button onClick={() => setShowNewBoard(false)} className="text-gray-500 hover:text-gray-300 transition-colors">✕</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <input
                autoFocus
                value={newBoardName}
                onChange={e => setNewBoardName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createBoard()}
                placeholder="Board name"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
              />
              <div>
                <div className="text-xs text-white/50 mb-1.5">Visibility</div>
                <div className="flex rounded-xl overflow-hidden border border-gray-700">
                  {(['public', 'private', 'personal'] as const).map((type, i) => (
                    <button
                      key={type}
                      onClick={() => setNewBoardType(type)}
                      className={`flex-1 py-2 text-xs font-medium transition-colors ${i > 0 ? 'border-l border-gray-700' : ''} ${newBoardType === type ? 'bg-[#2E7EB8] text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                    >
                      {type === 'public' ? '🌐 Public' : type === 'private' ? '🔒 Private' : '👤 Personal'}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-white/30 mt-1.5 px-0.5">
                  {newBoardType === 'public' && 'Visible to everyone on the team'}
                  {newBoardType === 'private' && 'Invite only — you choose who can see it'}
                  {newBoardType === 'personal' && 'Only visible to you'}
                </p>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-800 flex gap-3">
              <button
                onClick={() => setShowNewBoard(false)}
                className="flex-1 py-2 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createBoard}
                disabled={!newBoardName.trim() || creatingBoard}
                className="flex-1 py-2 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
              >
                {creatingBoard ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Board Settings modal */}
      {boardSettings && (() => {
        const nonSelfMembers = settingsMembers.filter(m => m.id !== boardSettings.created_by)
        const eligibleToAdd = hubUsers.filter(u => !u.is_bot && u.id !== currentUserId && !settingsMembers.find(m => m.id === u.id))
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm mx-4 flex flex-col max-h-[85vh]">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 flex-none">
                <h2 className="font-semibold text-white">Board Settings</h2>
                <button onClick={() => setBoardSettings(null)} className="text-gray-500 hover:text-gray-300 transition-colors">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                {/* Name */}
                <div>
                  <label className="text-xs text-white/50 block mb-1.5">Board name</label>
                  <input
                    value={settingsName}
                    onChange={e => setSettingsName(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-[#2E7EB8]"
                  />
                </div>
                {/* Type */}
                <div>
                  <label className="text-xs text-white/50 block mb-1.5">Visibility</label>
                  <div className="flex rounded-xl overflow-hidden border border-gray-700">
                    {(['public', 'private', 'personal'] as const).map((type, i) => (
                      <button
                        key={type}
                        onClick={() => setSettingsType(type)}
                        className={`flex-1 py-2 text-xs font-medium transition-colors ${i > 0 ? 'border-l border-gray-700' : ''} ${settingsType === type ? 'bg-[#2E7EB8] text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                      >
                        {type === 'public' ? '🌐 Public' : type === 'private' ? '🔒 Private' : '👤 Personal'}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Members — only for private boards */}
                {settingsType === 'private' && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-white/50">Members</label>
                      <button
                        onClick={() => setAddMemberOpen(v => !v)}
                        className="text-xs text-[#2E7EB8] hover:text-white transition-colors"
                      >
                        + Add
                      </button>
                    </div>
                    {addMemberOpen && eligibleToAdd.length > 0 && (
                      <div className="bg-gray-800 rounded-xl border border-gray-700 mb-2 max-h-36 overflow-y-auto">
                        {eligibleToAdd.map(u => (
                          <button
                            key={u.id}
                            onClick={() => addBoardMember(u.id)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 text-left"
                          >
                            <div className="w-6 h-6 rounded-full bg-gray-600 flex items-center justify-center text-xs font-bold text-white flex-none">
                              {u.display_name.slice(0, 1).toUpperCase()}
                            </div>
                            {u.display_name}
                          </button>
                        ))}
                        {eligibleToAdd.length === 0 && <p className="text-xs text-gray-500 px-3 py-2">Everyone is already a member.</p>}
                      </div>
                    )}
                    {settingsMembersLoading ? (
                      <p className="text-xs text-white/30 py-1">Loading…</p>
                    ) : settingsMembers.length === 0 ? (
                      <p className="text-xs text-white/30 py-1">No members yet.</p>
                    ) : (
                      <div className="space-y-1">
                        {settingsMembers.map(m => (
                          <div key={m.id} className="flex items-center gap-2 py-1">
                            <div className="w-6 h-6 rounded-full bg-gray-600 flex items-center justify-center text-xs font-bold text-white flex-none">
                              {m.display_name.slice(0, 1).toUpperCase()}
                            </div>
                            <span className="text-sm text-gray-300 flex-1 truncate">{m.display_name}</span>
                            {m.id === boardSettings.created_by ? (
                              <span className="text-xs text-white/30">Owner</span>
                            ) : (
                              <button
                                onClick={() => removeBoardMember(m.id)}
                                className="text-xs text-white/30 hover:text-red-400 transition-colors px-1.5 py-0.5 rounded"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="px-5 py-4 border-t border-gray-800 flex-none flex items-center gap-3">
                <button
                  onClick={deleteBoardConfirm}
                  className="py-2 px-3 rounded-xl border border-red-500/30 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  Delete
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => setBoardSettings(null)}
                  className="py-2 px-4 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveBoardSettings}
                  disabled={!settingsName.trim() || savingSettings}
                  className="py-2 px-4 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
                >
                  {savingSettings ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Browse Rooms modal */}
      {showBrowseRooms && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm mx-4 flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 flex-none">
              <h2 className="font-semibold text-white">Browse Rooms</h2>
              <button onClick={() => setShowBrowseRooms(false)} className="text-gray-500 hover:text-gray-300 transition-colors">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
              {browseLoading ? (
                <p className="text-sm text-gray-500 py-4 text-center">Loading…</p>
              ) : browseRooms.length === 0 ? (
                <p className="text-sm text-gray-500 py-4 text-center">No public rooms found.</p>
              ) : browseRooms.map(room => (
                <div key={room.id} className="flex items-center justify-between bg-gray-800 rounded-xl px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500 text-xs">#</span>
                      <span className="text-sm text-white font-medium truncate">{room.name}</span>
                    </div>
                    {room.description && <p className="text-xs text-gray-500 mt-0.5 truncate">{room.description}</p>}
                  </div>
                  {room.is_member ? (
                    <button
                      onClick={() => leaveRoomFromBrowse(room.id)}
                      className="flex-none ml-3 text-xs text-gray-400 hover:text-red-400 px-2 py-1 rounded border border-gray-600 hover:border-red-500/40 transition-colors"
                    >
                      Leave
                    </button>
                  ) : (
                    <button
                      onClick={() => joinRoom(room.id)}
                      disabled={joiningRoomId === room.id}
                      className="flex-none ml-3 text-xs text-white bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-50 px-3 py-1 rounded transition-colors"
                    >
                      {joiningRoomId === room.id ? '…' : 'Join'}
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-gray-800 flex-none">
              <p className="text-xs text-gray-600">Private rooms are by invitation only — ask an admin.</p>
            </div>
          </div>
        </div>
      )}

      {/* New DM modal */}
      {showNewPM && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="font-semibold text-white">New Direct Message</h2>
              <button onClick={() => setShowNewPM(false)} className="text-gray-500 hover:text-gray-300 transition-colors">✕</button>
            </div>
            <div className="px-5 py-4 max-h-72 overflow-y-auto space-y-1">
              {otherUsers.length === 0 && <p className="text-sm text-gray-500">No other team members found.</p>}
              {otherUsers.map(user => {
                const checked = selectedIds.includes(user.id)
                return (
                  <button
                    key={user.id}
                    onClick={() => toggleUser(user.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                      checked ? 'bg-[#2E7EB8]/20 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded border flex items-center justify-center flex-none transition-colors ${
                      checked ? 'bg-[#2E7EB8] border-[#2E7EB8]' : 'border-gray-600'
                    }`}>
                      {checked && <span className="text-white text-xs">✓</span>}
                    </div>
                    <div className="w-7 h-7 rounded-full bg-gray-600 flex items-center justify-center text-xs font-bold text-white flex-none">
                      {user.display_name.slice(0, 1).toUpperCase()}
                    </div>
                    <span className="truncate">{user.display_name}</span>
                  </button>
                )
              })}
            </div>
            <div className="px-5 py-4 border-t border-gray-800 flex gap-3">
              <button
                onClick={() => setShowNewPM(false)}
                className="flex-1 py-2 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createConversation}
                disabled={selectedIds.length === 0 || creating}
                className="flex-1 py-2 rounded-xl bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-40 text-sm text-white font-medium transition-colors"
              >
                {creating ? 'Opening…' : 'Open'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
