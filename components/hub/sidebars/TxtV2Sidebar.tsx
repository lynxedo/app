'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SidebarHeader } from './SidebarShell'
import { createClient } from '@/lib/supabase/client'
import SidebarContactsList from './SidebarContactsList'
import { Spinner, EmptyState, useToast } from '@/components/ui'
import ContactModal from '@/components/hub/txt/ContactModal'
import TxtGroupComposer from '@/components/hub/txt/TxtGroupComposer'
import TxtBroadcastComposer from '@/components/hub/txt/TxtBroadcastComposer'
import { formatPhone } from '@/lib/format'

type Conversation = {
  id: string
  kind?: 'direct' | 'group'
  status: 'unassigned' | 'assigned' | 'archived'
  source?: string | null
  assigned_to: string | null
  last_message_at: string | null
  last_inbound_at: string | null
  last_message_preview: string | null
  last_message_direction: 'inbound' | 'outbound' | null
  created_at: string
  contact: { id: string; name: string; phone: string; do_not_text: boolean } | null
  assignee: { id: string; display_name: string } | null
  members?: Array<{ user_id: string; role?: string | null }>
  group_contacts?: Array<{ contact: { id: string; name: string; phone: string } | { id: string; name: string; phone: string }[] | null }>
  phone_number_id?: string | null
  number?: { label: string | null; twilio_number: string } | { label: string | null; twilio_number: string }[] | null
  // Unified Inbox (Session 3) — present only when can_access_unified_inbox.
  last_call_at?: string | null
  last_voicemail_at?: string | null
  last_activity_at?: string | null
  last_activity_type?: 'text' | 'call' | 'voicemail' | null
  has_missed_call?: boolean
  has_voicemail?: boolean
  has_unheard_voicemail?: boolean
  last_inbound_activity_at?: string | null
}

type Scope = 'mine' | 'all' | 'archived' | 'contacts'
type ViewFilter = 'all' | 'unread' | 'missed' | 'voicemails'

// Last-activity-type icon for the rail (one icon per row, not a per-channel
// badge — PRD §3.2). Matches the marker emoji used in TimelineMarkers.tsx.
const ACTIVITY_ICON: Record<'text' | 'call' | 'voicemail', string> = {
  text: '💬',
  call: '📞',
  voicemail: '🎙',
}

type SimpleUser = { id: string; display_name: string }

function formatRelative(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60) return 'now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (d.toDateString() === now.toDateString()) return 'today'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function displayNameFor(c: Conversation) {
  const isGroup = c.kind === 'group'
  if (!isGroup) return c.contact?.name || 'Unknown'
  const groupNames = (c.group_contacts ?? [])
    .map((gc) => {
      const inner = Array.isArray(gc.contact) ? gc.contact[0] : gc.contact
      return inner?.name || null
    })
    .filter(Boolean) as string[]
  return groupNames.length > 0
    ? `👥 ${groupNames.slice(0, 2).join(', ')}${groupNames.length > 2 ? ` +${groupNames.length - 2}` : ''}`
    : '👥 Group'
}

function sublineFor(c: Conversation) {
  const isGroup = c.kind === 'group'
  if (isGroup) {
    const n = (c.group_contacts ?? []).length
    return `${n} people`
  }
  return c.contact?.phone ? formatPhone(c.contact.phone) : ''
}

export default function TxtV2Sidebar({
  onClose,
  onDesktopCollapse,
  canManage,
  canCall = false,
  canAccessUnifiedInbox = false,
  betaBroadcasts = false,
  betaGroups = false,
  currentUserId,
  companyId,
}: {
  onClose?: () => void
  onDesktopCollapse?: () => void
  /** Manager powers: see the unassigned Queue + Responder tab + send Broadcasts. */
  canManage: boolean
  /** Show the 📞 Call button on contact rows (user has dialer access). */
  canCall?: boolean
  /** Unified inbox: rows carry cross-channel activity → show the activity icon,
   *  the Missed/Voicemails filters, and fold calls/VMs into the unread dot. */
  canAccessUnifiedInbox?: boolean
  /** Txt Broadcasts is a Beta feature (txt_broadcasts flag). Show the Broadcast
   *  composer button + Broadcasts page link only when this user has the beta on
   *  (AND is a manager). Resolved server-side in HubShell from betaFlags. */
  betaBroadcasts?: boolean
  /** Group texting is a Beta feature (txt_groups flag) — true Group MMS on our
   *  long code (everyone sees everyone, like a native phone group text). Shows
   *  the + Group button for any Txt user with the beta on. */
  betaGroups?: boolean
  currentUserId: string
  companyId: string
}) {
  const pathname = usePathname() || ''
  const toast = useToast()
  const [scope, setScope] = useState<Scope>('all')
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [queue, setQueue] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [addContactOpen, setAddContactOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const [broadcastOpen, setBroadcastOpen] = useState(false)
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [assignOpenId, setAssignOpenId] = useState<string | null>(null)
  const [users, setUsers] = useState<SimpleUser[]>([])
  // Server-side search results (non-null when search.length >= 2).
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null)
  const [searchingServer, setSearchingServer] = useState(false)

  // Per-conversation read tracking (per-device, like the rail dot). Maps a
  // conversation id → the ISO time this device last opened it. A conversation
  // is "unread" when its last_inbound_at is newer than that stamp. Stored as
  // one JSON blob so we don't pollute localStorage with a key per thread.
  const READS_KEY = 'txt-conv-reads'
  const [reads, setReads] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      return JSON.parse(localStorage.getItem(READS_KEY) || '{}') as Record<string, string>
    } catch {
      return {}
    }
  })
  const markRead = useCallback((id: string) => {
    setReads((prev) => {
      const next = { ...prev, [id]: new Date().toISOString() }
      try {
        localStorage.setItem(READS_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  // Assignable users for the inline Assign menu. Any Txt2 user can reassign.
  useEffect(() => {
    fetch('/api/hub/users')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        const list = (data.users || []).filter(
          (u: { is_bot?: boolean }) => !u.is_bot
        )
        setUsers(list.map((u: SimpleUser) => ({ id: u.id, display_name: u.display_name })))
      })
      .catch(() => setUsers([]))
  }, [])

  const load = useCallback(async () => {
    // Contacts tab fetches its own data (SidebarContactsList); skip the
    // conversations endpoint so the 15s poll doesn't churn on it.
    if (scope === 'contacts') {
      setLoading(false)
      return
    }
    setLoading(true)
    const showQueue = canManage && scope !== 'archived'
    const requests: Promise<Response>[] = [
      fetch(`/api/txt/conversations?scope=${scope}&limit=100`),
    ]
    if (showQueue) {
      requests.push(fetch('/api/txt/conversations?scope=unassigned&limit=100'))
    }
    const [mainRes, queueRes] = await Promise.all(requests)
    if (mainRes.ok) {
      const data = await mainRes.json()
      setConversations(data.conversations || [])
    }
    if (showQueue && queueRes?.ok) {
      const data = await queueRes.json()
      setQueue(data.conversations || [])
    } else {
      setQueue([])
    }
    setLoading(false)
  }, [scope, canManage])

  useEffect(() => {
    load()
  }, [load])

  // #27 — realtime list updates. The inbound webhook + delivery-status route
  // broadcast on the company-wide `txt:{companyId}` channel, so we refresh the
  // list the moment a text lands instead of waiting up to 15s. A slow 30s
  // fallback poll reconciles if a broadcast is ever dropped (broadcasts aren't
  // persisted). load() only shows its spinner when the list is empty, so these
  // background refreshes don't flash.
  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    const channel = supabase
      .channel(`txt:${companyId}`)
      .on('broadcast', { event: 'inbound' }, () => { if (!cancelled) load() })
      .on('broadcast', { event: 'status' }, () => { if (!cancelled) load() })
      .subscribe()
    const t = setInterval(() => { if (!cancelled) load() }, 30000)
    return () => {
      cancelled = true
      clearInterval(t)
      supabase.removeChannel(channel)
    }
  }, [load, companyId])

  // Server-side full-text search (debounced 250ms). Fires when the query is
  // ≥ 2 chars; searches contacts by name/phone AND message bodies. Resets to
  // null when the query is cleared so the normal scoped list reappears.
  useEffect(() => {
    if (search.length < 2) {
      setSearchResults(null)
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      setSearchingServer(true)
      const res = await fetch(
        `/api/txt/conversations?scope=search&q=${encodeURIComponent(search)}`
      )
      if (cancelled) return
      setSearchingServer(false)
      if (res.ok) {
        const data = await res.json()
        setSearchResults(data.conversations || [])
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
      setSearchingServer(false)
    }
  }, [search])

  // Mark the currently-open conversation read — on navigation AND on every
  // list refresh, so a thread you're actively viewing stays read as new
  // inbounds arrive (no stale dot when you leave it).
  useEffect(() => {
    const m = pathname.match(/^\/hub\/txt\/([0-9a-fA-F-]+)$/)
    if (m) markRead(m[1])
  }, [pathname, conversations, markRead])

  // A thread "belongs to me" when I own it (assigned_to) or I'm on it as a
  // member — the same owner-or-member set the "Mine" tab and the rail dot
  // (/api/txt/unread) already scope to. assigned_to and the members row are
  // written together on every claim/start/assign path, so either alone is
  // enough; checking both is belt-and-suspenders.
  function isMine(c: Conversation) {
    if (c.assigned_to && c.assigned_to === currentUserId) return true
    return (c.members ?? []).some((m) => m.user_id === currentUserId)
  }

  // A conversation is unread when a customer inbound landed after this device
  // last opened it. The currently-open thread never shows a dot. With the
  // unified inbox on, "inbound" also covers a missed call or a new voicemail
  // (last_inbound_activity_at), so the same dot lights for any unhandled
  // incoming on any channel — and opening the thread (which shows the markers)
  // clears it via the existing per-device reads stamp.
  //
  // The dot only lights for threads that are MINE. In the shared "All" view
  // every teammate's threads are visible; lighting everyone's unread dots
  // buried the ones actually assigned to me. Unassigned Queue threads surface
  // in their own pinned section, so scoping the per-row dot to my threads
  // hides nothing that needs triage.
  function isUnread(c: Conversation) {
    if (c.status === 'archived') return false
    if (!isMine(c)) return false
    if (pathname === `/hub/txt/${c.id}`) return false
    const inbound = canAccessUnifiedInbox
      ? c.last_inbound_activity_at ?? c.last_inbound_at
      : c.last_inbound_at
    if (!inbound) return false
    const seen = reads[c.id]
    return !seen || inbound > seen
  }

  // Within-list lens (unified inbox only): All · Unread · Missed · Voicemails.
  function passesViewFilter(c: Conversation) {
    if (!canAccessUnifiedInbox || viewFilter === 'all') return true
    if (viewFilter === 'unread') return isUnread(c)
    if (viewFilter === 'missed') return !!c.has_missed_call
    if (viewFilter === 'voicemails') return !!c.has_voicemail
    return true
  }

  // Leading icon showing the last activity type for a row (unified inbox only).
  function activityIcon(c: Conversation) {
    if (!canAccessUnifiedInbox || !c.last_activity_type) return null
    return (
      <span
        className="flex-none text-[11px] leading-none opacity-70"
        aria-hidden
        title={`Last activity: ${c.last_activity_type}`}
      >
        {ACTIVITY_ICON[c.last_activity_type]}
      </span>
    )
  }

  // Sidebar subline: the last message snippet ("You: …" for outbound), falling
  // back to the phone / group-size line when there's no preview yet.
  function previewFor(c: Conversation) {
    const p = (c.last_message_preview || '').trim()
    if (!p) return sublineFor(c)
    return c.last_message_direction === 'outbound' ? `You: ${p}` : p
  }

  const matchesSearch = useCallback(
    (c: Conversation) => {
      if (!search) return true
      const q = search.toLowerCase()
      if (
        c.contact?.name?.toLowerCase().includes(q) ||
        c.contact?.phone?.toLowerCase().includes(q)
      )
        return true
      return (c.group_contacts ?? []).some((gc) => {
        const inner = Array.isArray(gc.contact) ? gc.contact[0] : gc.contact
        return (
          inner?.name?.toLowerCase().includes(q) ||
          inner?.phone?.toLowerCase().includes(q)
        )
      })
    },
    [search]
  )

  const filteredQueue = queue.filter(matchesSearch).filter(passesViewFilter)
  // In the All view the unassigned threads also come back in the main list —
  // drop them so they only appear once (in the pinned Queue section above).
  const filteredMain = conversations
    .filter((c) => !(scope === 'all' && c.status === 'unassigned'))
    .filter(matchesSearch)
    .filter(passesViewFilter)

  async function claim(id: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (actioningId) return
    setActioningId(id)
    try {
      const res = await fetch(`/api/txt/conversations/${id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigned_to: currentUserId }),
      })
      if (res.ok) await load()
      else toast.error("Couldn't claim conversation")
    } finally {
      setActioningId(null)
    }
  }

  async function assign(id: string, userId: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setAssignOpenId(null)
    if (actioningId) return
    setActioningId(id)
    try {
      const res = await fetch(`/api/txt/conversations/${id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigned_to: userId }),
      })
      if (res.ok) await load()
      else toast.error("Couldn't assign conversation")
    } finally {
      setActioningId(null)
    }
  }

  async function archive(id: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (actioningId) return
    setActioningId(id)
    try {
      const res = await fetch(`/api/txt/conversations/${id}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      })
      if (res.ok) await load()
      else toast.error("Couldn't archive conversation")
    } finally {
      setActioningId(null)
    }
  }

  const tabs: { id: Scope; label: string; show: boolean }[] = [
    { id: 'mine', label: 'Mine', show: true },
    { id: 'all', label: 'All', show: true },
    { id: 'archived', label: 'Archived', show: true },
    { id: 'contacts', label: 'Contacts', show: true },
  ]

  // Which of our numbers is this conversation on? Label (e.g. "Main" /
  // "Toll Free") or a last-4 fallback. Returns null when unknown.
  const numberLabelFor = (c: Conversation): string | null => {
    const n = Array.isArray(c.number) ? c.number[0] : c.number
    if (!n) return null
    return (n.label && n.label.trim()) || (n.twilio_number ? n.twilio_number.slice(-4) : null)
  }
  // Only show the per-line badge when this company actually uses 2+ numbers, so
  // single-number setups stay clean (mirrors the conversation-header rule).
  const showNumberBadges =
    new Set(
      [...conversations, ...queue]
        .map((c) => {
          const n = Array.isArray(c.number) ? c.number[0] : c.number
          return n?.twilio_number || null
        })
        .filter(Boolean)
    ).size > 1

  return (
    <aside
      className="t-sidebar-surface h-full w-72 text-white flex flex-col flex-none min-h-0"
      style={{ background: 'linear-gradient(180deg,var(--t-well),var(--t-rail))', borderRight: '1px solid rgba(255,255,255,.06)' }}
      aria-label="Txt sidebar"
    >
      <SidebarHeader title="Txt" onClose={onClose} onDesktopCollapse={onDesktopCollapse} />

      <div className="px-3 pt-3 pb-2 space-y-2">
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          className="w-full px-3 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
        >
          + New conversation
        </button>
        <button
          type="button"
          onClick={() => setAddContactOpen(true)}
          className="w-full px-2 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-xs font-medium border border-white/10"
        >
          + Add contact
        </button>
        {/* Group + Broadcast are both Beta features (txt_groups / txt_broadcasts
            flags, resolved in HubShell). This block renders nothing unless the
            user has at least one beta on. Layout adapts to 1 or 2 buttons. */}
        {(betaGroups || (canManage && betaBroadcasts)) && (
          <div
            className={`grid ${
              betaGroups && canManage && betaBroadcasts
                ? 'grid-cols-2'
                : 'grid-cols-1'
            } gap-2`}
          >
            {betaGroups && (
              <button
                type="button"
                onClick={() => setGroupOpen(true)}
                className="px-2 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-xs font-medium border border-white/10"
                title="New group conversation"
              >
                + Group
              </button>
            )}
            {canManage && betaBroadcasts && (
              <button
                type="button"
                onClick={() => setBroadcastOpen(true)}
                className="px-2 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-xs font-medium border border-white/10"
                title="Send 1-to-many broadcast"
              >
                📣 Broadcast
              </button>
            )}
          </div>
        )}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or phone…"
          className="w-full px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
        />
        <div className="flex flex-wrap gap-1 text-xs">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <button
                key={t.id}
                onClick={() => setScope(t.id)}
                className={`flex-1 basis-0 min-w-[60px] px-2 py-1 rounded-md transition ${
                  scope === t.id
                    ? 'bg-white/10 text-white'
                    : 'text-white/50 hover:text-white/80'
                }`}
              >
                {t.label}
              </button>
            ))}
        </div>

        {/* Unified inbox lens: filter the current list by channel/state. One
            icon per row already shows the last activity type; these chips
            narrow to what needs attention. Hidden on the Contacts tab. */}
        {canAccessUnifiedInbox && scope !== 'contacts' && (
          <div className="flex flex-wrap gap-1 text-[11px]">
            {([
              ['all', 'All'],
              ['unread', 'Unread'],
              ['missed', 'Missed'],
              ['voicemails', 'Voicemails'],
            ] as [ViewFilter, string][]).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setViewFilter(id)}
                className={`px-2 py-0.5 rounded-full border transition ${
                  viewFilter === id
                    ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200'
                    : 'border-white/10 text-white/50 hover:text-white/80'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {scope === 'contacts' ? (
        <SidebarContactsList canCall={canCall} canText onClose={onClose} />
      ) : searchResults !== null ? (
        // Server search results mode — shown when search.length >= 2
        <div className="flex-1 overflow-y-auto min-h-0">
          {searchingServer && searchResults.length === 0 && (
            <div className="py-12 text-center"><Spinner size={6} /></div>
          )}
          {!searchingServer && searchResults.length === 0 && (
            <EmptyState title="No matching conversations." />
          )}
          {searchResults.length > 0 && (
            <div>
              <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wide text-white/40">
                {searchResults.length} result{searchResults.length === 1 ? '' : 's'}
              </div>
              <ul>
                {searchResults.map((c) => {
                  const active = pathname === `/hub/txt/${c.id}`
                  const unread = isUnread(c)
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/hub/txt/${c.id}`}
                        onClick={() => { markRead(c.id); onClose?.() }}
                        className={`block px-4 py-2 border-l-2 ${
                          active
                            ? 'bg-white/5 border-emerald-400'
                            : 'border-transparent hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 min-w-0">
                            {unread && (
                              <span className="w-2 h-2 rounded-full bg-orange-400 flex-none" aria-label="Unread" />
                            )}
                            {activityIcon(c)}
                            <span className={`text-sm truncate ${unread ? 'font-semibold text-white' : 'font-medium'}`}>
                              {displayNameFor(c)}
                            </span>
                          </span>
                          <span className={`text-[10px] flex-none ${unread ? 'text-orange-300' : 'text-white/40'}`}>
                            {formatRelative(c.last_activity_at || c.last_message_at || c.created_at)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <span className={`text-[11px] truncate ${unread ? 'text-white/70' : 'text-white/40'}`}>
                            {previewFor(c)}
                          </span>
                          <span className="flex items-center gap-1 text-[10px] flex-none">
                            {c.status === 'archived' && (
                              <span className="text-white/30">archived</span>
                            )}
                          </span>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && conversations.length === 0 && queue.length === 0 && (
          <div className="py-12 text-center"><Spinner size={6} /></div>
        )}

        {/* Pinned Queue section — unassigned threads, always at the top for
            managers (in Mine + All). Highlighted, with inline Claim / Assign /
            Archive so they can be triaged without leaving the list. */}
        {canManage && scope !== 'archived' && filteredQueue.length > 0 && (
          <div className="bg-orange-500/[0.06] border-b border-orange-500/20">
            <div className="px-4 pt-2 pb-1 flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide text-orange-300/80 font-semibold">
                Queue
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-200 font-semibold">
                {filteredQueue.length}
              </span>
            </div>
            <ul>
              {filteredQueue.map((c) => {
                const active = pathname === `/hub/txt/${c.id}`
                const busy = actioningId === c.id
                return (
                  <li key={c.id} className="border-l-2 border-orange-400/70">
                    <Link
                      href={`/hub/txt/${c.id}`}
                      onClick={onClose}
                      className={`block px-4 py-2 ${active ? 'bg-white/5' : 'hover:bg-white/5'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 min-w-0">
                          {activityIcon(c)}
                          <span className="font-medium text-sm truncate">
                            {displayNameFor(c)}
                          </span>
                        </span>
                        <span className="flex items-center gap-1.5 flex-none">
                          {showNumberBadges && numberLabelFor(c) && (
                            <span className="px-1 py-0.5 rounded bg-white/10 text-white/55 uppercase tracking-wide text-[9px]">
                              {numberLabelFor(c)}
                            </span>
                          )}
                          <span className="text-[10px] text-white/40">
                            {formatRelative(c.last_activity_at || c.last_message_at || c.created_at)}
                          </span>
                        </span>
                      </div>
                      <div className="text-[11px] text-white/40 truncate mt-0.5">
                        {previewFor(c)}
                      </div>
                    </Link>
                    {/* Inline triage actions */}
                    <div className="px-4 pb-2 -mt-0.5 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => claim(c.id, e)}
                        disabled={busy}
                        className="px-2 py-0.5 rounded bg-emerald-600/80 hover:bg-emerald-600 text-white text-[10px] font-medium disabled:opacity-50"
                        title="Assign this to me"
                      >
                        {busy ? '…' : 'Claim'}
                      </button>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setAssignOpenId((v) => (v === c.id ? null : c.id))
                          }}
                          disabled={busy}
                          className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/80 text-[10px] font-medium disabled:opacity-50"
                          title="Assign to a teammate"
                        >
                          Assign ▾
                        </button>
                        {assignOpenId === c.id && (
                          <div className="absolute left-0 top-full mt-1 w-44 max-h-56 overflow-y-auto bg-[var(--t-panel)] border border-white/15 rounded-md shadow-xl z-30">
                            {users.length === 0 && (
                              <div className="px-3 py-2 text-[11px] text-white/40">
                                No teammates
                              </div>
                            )}
                            {users.map((u) => (
                              <button
                                key={u.id}
                                type="button"
                                onClick={(e) => assign(c.id, u.id, e)}
                                className="block w-full text-left px-3 py-1.5 text-xs hover:bg-white/5"
                              >
                                {u.display_name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => archive(c.id, e)}
                        disabled={busy}
                        className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/60 text-[10px] font-medium disabled:opacity-50"
                        title="Archive without replying"
                      >
                        Archive
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {!loading && filteredMain.length === 0 && filteredQueue.length === 0 && (
          <EmptyState
            title={
              scope === 'mine'
                ? 'Nothing assigned to you yet.'
                : scope === 'archived'
                ? 'No archived conversations.'
                : 'No conversations.'
            }
          />
        )}

        <ul>
          {filteredMain.map((c) => {
            const active = pathname === `/hub/txt/${c.id}`
            const unread = isUnread(c)
            return (
              <li key={c.id}>
                <Link
                  href={`/hub/txt/${c.id}`}
                  onClick={() => { markRead(c.id); onClose?.() }}
                  className={`block px-4 py-2 border-l-2 ${
                    active
                      ? 'bg-white/5 border-emerald-400'
                      : 'border-transparent hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 min-w-0">
                      {unread && (
                        <span
                          className="w-2 h-2 rounded-full bg-orange-400 flex-none"
                          aria-label="Unread"
                        />
                      )}
                      {activityIcon(c)}
                      <span className={`text-sm truncate ${unread ? 'font-semibold text-white' : 'font-medium'}`}>
                        {displayNameFor(c)}
                      </span>
                    </span>
                    <span className={`text-[10px] flex-none ${unread ? 'text-orange-300' : 'text-white/40'}`}>
                      {formatRelative(c.last_activity_at || c.last_message_at || c.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className={`text-[11px] truncate ${unread ? 'text-white/70' : 'text-white/40'}`}>
                      {previewFor(c)}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] flex-none">
                      {showNumberBadges && numberLabelFor(c) && (
                        <span className="px-1 py-0.5 rounded bg-white/10 text-white/55 uppercase tracking-wide text-[9px]">
                          {numberLabelFor(c)}
                        </span>
                      )}
                      {c.source === 'responder' && !c.assigned_to && (
                        <span className="text-purple-300">Guardian</span>
                      )}
                      {c.status === 'assigned' && c.assignee && (
                        <span className="text-emerald-300">
                          {c.assignee.id === currentUserId
                            ? 'you'
                            : c.assignee.display_name.split(' ')[0]}
                        </span>
                      )}
                      {c.status === 'archived' && (
                        <span className="text-white/30">archived</span>
                      )}
                    </span>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
      )}

      <div className="px-3 py-2 border-t border-white/5 flex items-center justify-between">
        {canManage && betaBroadcasts ? (
          <Link
            href="/hub/txt/broadcasts"
            onClick={onClose}
            className="text-[11px] text-white/60 hover:text-white"
          >
            📣 Broadcasts ›
          </Link>
        ) : (
          <span />
        )}
        <span />
      </div>

      {newOpen && (
        <NewConversationModal onClose={() => setNewOpen(false)} onCreated={load} />
      )}

      {addContactOpen && (
        <ContactModal
          mode="create"
          onClose={() => setAddContactOpen(false)}
          onCreated={() => {
            setAddContactOpen(false)
            window.location.href = `/hub/contacts`
          }}
        />
      )}

      {groupOpen && <TxtGroupComposer onClose={() => setGroupOpen(false)} />}

      {broadcastOpen && <TxtBroadcastComposer onClose={() => setBroadcastOpen(false)} />}
    </aside>
  )
}

function NewConversationModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<
    Array<{ id: string; name: string; phone: string; do_not_text?: boolean }>
  >([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [manualPhone, setManualPhone] = useState('')
  const [error, setError] = useState('')

  // Search the local Txt contacts (the Contacts page), not Jobber.
  async function search(q: string) {
    const term = q.trim()
    if (!term) {
      setResults([])
      setSearched(false)
      return
    }
    setSearching(true)
    setError('')
    const res = await fetch(
      `/api/txt/contacts?search=${encodeURIComponent(term)}&include_do_not_text=1&limit=25`
    )
    setSearching(false)
    setSearched(true)
    if (res.ok) {
      const data = await res.json()
      setResults(data.contacts || [])
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Search failed')
    }
  }

  // Debounced search-as-you-type.
  useEffect(() => {
    const t = setTimeout(() => search(query), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  async function start(opts: { phone: string; name?: string; email?: string }) {
    setError('')
    const res = await fetch('/api/txt/conversations/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Failed to start conversation')
      return
    }
    onCreated()
    onClose()
    window.location.href = `/hub/txt/${data.conversation_id}`
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4">
      <div className="bg-[var(--t-panel)] border border-white/10 rounded-lg w-full max-w-md max-h-[80vh] flex flex-col">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-medium">New conversation</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white" aria-label="Close">×</button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div>
            <label className="text-xs text-white/50 block mb-1">Search contacts</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or phone…"
              className="w-full px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
              style={{ fontSize: 16 }}
              autoFocus
            />
          </div>
          {searching && <div className="text-xs text-white/40">Searching…</div>}
          {!searching && searched && results.length === 0 && query.trim() && (
            <div className="text-xs text-white/40">
              No matching contacts. Add them below by phone, or use “+ Add contact”.
            </div>
          )}
          {results.length > 0 && (
            <ul className="space-y-1 max-h-56 overflow-y-auto">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => start({ phone: r.phone || '', name: r.name })}
                    disabled={!r.phone}
                    className="w-full text-left px-3 py-2 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-40"
                  >
                    <div className="text-sm font-medium flex items-center gap-2">
                      {r.name}
                      {r.do_not_text && (
                        <span className="text-[10px] px-1 rounded bg-orange-500/20 text-orange-300">
                          do-not-text
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-white/50">
                      {r.phone ? formatPhone(r.phone) : 'no phone'}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="pt-2 border-t border-white/10">
            <label className="text-xs text-white/50 block mb-1">Or start by phone number</label>
            <div className="flex gap-2">
              <input
                type="tel"
                value={manualPhone}
                onChange={(e) => setManualPhone(e.target.value)}
                placeholder="(281) 555-1234"
                className="flex-1 px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
                style={{ fontSize: 16 }}
              />
              <button
                onClick={() => start({ phone: manualPhone })}
                disabled={!manualPhone.trim()}
                className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm disabled:opacity-50"
              >
                Start
              </button>
            </div>
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
      </div>
    </div>
  )
}
