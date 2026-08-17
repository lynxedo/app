'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SidebarHeader } from './SidebarShell'
import { subscribeSharedBroadcast } from '@/lib/realtime-shared-channel'
import SidebarContactsList from './SidebarContactsList'
import { Spinner, EmptyState, useToast, useConfirm } from '@/components/ui'
import ContactModal from '@/components/hub/txt/ContactModal'
import TxtGroupComposer from '@/components/hub/txt/TxtGroupComposer'
import TxtBroadcastComposer from '@/components/hub/txt/TxtBroadcastComposer'
import { formatPhone } from '@/lib/format'
import { contactDisplayName, isPlaceholderName, nameIsAiGuessed } from '@/lib/contact-name'
import { lsaThreadLabel } from '@/lib/lsa-relay'
import { useWorkspaceTabs } from '../workspace/WorkspaceTabsContext'
import { useOutsideClose } from '@/hooks/use-outside-close'

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
  contact: { id: string; name: string; name_source?: string | null; phone: string; do_not_text: boolean } | null
  assignee: { id: string; display_name: string } | null
  members?: Array<{ user_id: string; role?: string | null }>
  group_contacts?: Array<{ contact: { id: string; name: string; phone: string } | { id: string; name: string; phone: string }[] | null }>
  phone_number_id?: string | null
  number?: { label: string | null; twilio_number: string } | { label: string | null; twilio_number: string }[] | null
  // Google Local Services relay thread — the number is Google's per-lead proxy,
  // not the customer's, and Google never sends a name, so these are labeled by
  // the lead's city + service instead of showing as "Unknown".
  lsa_relay?: boolean | null
  lsa_location?: string | null
  lsa_service?: string | null
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

/** The unified-inbox lens options, shown in the filter menu beside search. */
const VIEW_FILTERS: [ViewFilter, string][] = [
  ['all', 'All'],
  ['unread', 'Unread'],
  ['missed', 'Missed'],
  ['voicemails', 'Voicemails'],
]

/** Shared look for the icon-only secondary actions in the top action row. */
const SIDEBAR_ICON_BTN =
  'flex-none w-10 sm:w-9 h-11 sm:h-9 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-sm'

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
  if (!isGroup) {
    // A Google LSA relay with no name yet reads as its lead (city · service)
    // rather than "Unknown". A real name, once we learn one, still wins.
    const fallback = c.lsa_relay ? lsaThreadLabel(c.lsa_location ?? null, c.lsa_service ?? null) : null
    return contactDisplayName(c.contact?.name, c.contact?.phone, fallback)
  }
  const groupNames = (c.group_contacts ?? [])
    .map((gc) => {
      const inner = Array.isArray(gc.contact) ? gc.contact[0] : gc.contact
      return inner?.name && !isPlaceholderName(inner.name, inner.phone) ? inner.name.trim() : null
    })
    .filter(Boolean) as string[]
  return groupNames.length > 0
    ? `👥 ${groupNames.slice(0, 2).join(', ')}${groupNames.length > 2 ? ` +${groupNames.length - 2}` : ''}`
    : '👥 Group'
}

// Purple dot when a direct contact's name was guessed by AI (verify + confirm).
// inline-block + leading so it renders inside the truncating name span and never
// gets clipped when a long name ellipsizes.
function AiDot({ c }: { c: Conversation }) {
  if (c.kind === 'group' || !nameIsAiGuessed(c.contact?.name_source)) return null
  return <span className="inline-block align-middle mr-1 w-2 h-2 rounded-full bg-purple-400" title="Name suggested by AI — open to confirm" />
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
  currentUserId: string
  companyId: string
}) {
  const pathname = usePathname() || ''
  const wsTabs = useWorkspaceTabs()
  // Workspace Tabs: open a Txt conversation as a kept-alive tab instead of navigating.
  // Conversations are always go-to-existing (a 2nd tab of the same thread would
  // double-subscribe its realtime channel) — Alt is ignored.
  const openTxtTab = (c: Conversation) =>
    wsTabs.openTab({ catalogId: 'txt-thread', instanceKey: c.id, label: displayNameFor(c), href: `/hub/txt/${c.id}` })
  const toast = useToast()
  const confirm = useConfirm()
  // Open on YOUR threads, not the whole company's shared inbox — matches the
  // Dialer and Inbox sidebars, which already land on "Mine". Managers still get
  // the pinned unassigned Queue above this list on every tab except Archived, so
  // defaulting to Mine hides nothing that needs triage.
  const [scope, setScope] = useState<Scope>('mine')
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)
  useOutsideClose(filterRef, filterOpen, () => setFilterOpen(false))
  // The filter button is hidden on the Contacts tab. Without this, switching to
  // Contacts with the menu open leaves `filterOpen` true, so it silently
  // re-appears when you come back to a conversation tab.
  useEffect(() => {
    if (scope === 'contacts') setFilterOpen(false)
  }, [scope])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [queue, setQueue] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [newInitialQuery, setNewInitialQuery] = useState('')
  const [addContactOpen, setAddContactOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const [broadcastOpen, setBroadcastOpen] = useState(false)
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [archivingAll, setArchivingAll] = useState(false)
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
  /**
   * The Txt thread on screen right now.
   *
   * Opening one as a Workspace Tab never touches the URL, and while a tab is
   * active HubShell doesn't render the route at all — so the pathname is the
   * wrong answer in tab mode, and a thread open as a tab kept its unread dot as
   * new texts arrived. The tab wins when there is one; the URL answers
   * otherwise, which is exactly today's behavior off tabs.
   */
  const viewingConvId: string | null = wsTabs.activeTab
    ? (wsTabs.activeTab.catalogId === 'txt-thread' ? wsTabs.activeTab.instanceKey ?? null : null)
    : (pathname.match(/^\/hub\/txt\/([0-9a-fA-F-]+)$/)?.[1] ?? null)

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
    // Ref-counted — several components share this topic and Supabase hands them
    // all one channel. This effect re-runs on every scope/filter change, and
    // removing the channel outright used to kill realtime for the rail dot, the
    // chime, and any Txt thread open as a Workspace Tab.
    const off = subscribeSharedBroadcast(`txt:${companyId}`, {
      inbound: () => { if (!cancelled) load() },
      status: () => { if (!cancelled) load() },
    })
    const t = setInterval(() => { if (!cancelled) load() }, 30000)
    return () => {
      cancelled = true
      clearInterval(t)
      off()
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
    if (viewingConvId) markRead(viewingConvId)
  }, [viewingConvId, conversations, markRead])

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
    if (viewingConvId === c.id) return false
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

  // Bulk "Archive all mine": archives every conversation the current user OWNS
  // (only those — not ones they merely collaborate on). Previews the count first
  // so the confirm can name it, then refreshes the list. Each archived thread
  // starts fresh (owner + members cleared) if the customer texts back.
  async function archiveAllMine() {
    if (archivingAll) return
    setArchivingAll(true)
    try {
      const pre = await fetch('/api/txt/conversations/archive-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: true }),
      })
      if (!pre.ok) {
        toast.error("Couldn't check your conversations")
        return
      }
      const { count } = await pre.json()
      if (!count) {
        toast.info('No conversations of yours to archive')
        return
      }
      const ok = await confirm({
        title: 'Archive all mine',
        message: `Archive ${count} conversation${count === 1 ? '' : 's'} you own? They leave your inbox, and if a customer texts back that conversation returns to the queue unassigned — a clean start. Conversations you don't own are untouched.`,
        confirmText: 'Archive all',
      })
      if (!ok) return
      const res = await fetch('/api/txt/conversations/archive-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        const { archived } = await res.json()
        toast.success(`Archived ${archived} conversation${archived === 1 ? '' : 's'}`)
        await load()
      } else {
        toast.error("Couldn't archive your conversations")
      }
    } finally {
      setArchivingAll(false)
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
        {/* Action row — "New" keeps the prominent green button and carries the
            remaining width; the four secondary actions are icon-only (labels
            live in title/aria) so all five fit on ONE row instead of four.
            Taller on mobile to keep a real tap target. */}
        <div className="flex items-stretch gap-1.5">
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="flex-1 min-w-0 h-11 sm:h-9 px-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium flex items-center justify-center gap-1.5"
            title="New conversation"
          >
            <span aria-hidden>✏️</span>
            <span className="truncate">New</span>
          </button>
          <button
            type="button"
            onClick={() => setAddContactOpen(true)}
            className={SIDEBAR_ICON_BTN}
            title="Add contact"
            aria-label="Add contact"
          >
            <span aria-hidden>👤</span>
          </button>
          {/* + Group for any Txt user; 📣 Broadcast is manager-only (broadcasts
              can hit hundreds of customers). */}
          <button
            type="button"
            onClick={() => setGroupOpen(true)}
            className={SIDEBAR_ICON_BTN}
            title="New group conversation"
            aria-label="New group conversation"
          >
            <span aria-hidden>👥</span>
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() => setBroadcastOpen(true)}
              className={SIDEBAR_ICON_BTN}
              title="Send 1-to-many broadcast"
              aria-label="Send broadcast"
            >
              <span aria-hidden>📣</span>
            </button>
          )}
          {/* Bulk-archive every thread the user owns (only theirs). Confirms
              with a count first. On every tab so it's reachable on mobile. */}
          <button
            type="button"
            onClick={archiveAllMine}
            disabled={archivingAll}
            className={`${SIDEBAR_ICON_BTN} disabled:opacity-50`}
            title="Archive every conversation you own"
            aria-label="Archive all mine"
          >
            {archivingAll ? (
              <span className="inline-block w-3.5 h-3.5 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
            ) : (
              <span aria-hidden>🗄</span>
            )}
          </button>
        </div>

        {/* Search + the unified-inbox lens. The lens used to be a row of four
            chips; it's now a filter button beside search that SHOWS its active
            value as a label, so a non-default filter is never hidden state. */}
        <div className="flex items-stretch gap-1.5">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or phone…"
            className="flex-1 min-w-0 px-3 h-9 sm:h-8 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
          />
          {canAccessUnifiedInbox && scope !== 'contacts' && (
            <div ref={filterRef} className="relative flex-none">
              <button
                type="button"
                onClick={() => setFilterOpen((v) => !v)}
                className={`h-9 sm:h-8 px-2 rounded-md border text-[11px] flex items-center gap-1 transition ${
                  viewFilter === 'all'
                    ? 'bg-white/5 border-white/10 text-white/50 hover:text-white/80'
                    : 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200'
                }`}
                title="Filter this list"
                aria-label={`Filter: ${VIEW_FILTERS.find((f) => f[0] === viewFilter)?.[1] || 'All'}`}
              >
                {/* Inline SVG, not an emoji — the obvious "filter" glyphs
                    (⛃ / ⚟) are obscure codepoints that render as a box on some
                    platforms, and this button has no text label when inactive. */}
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 5h18l-7 8v6l-4-2v-4Z" />
                </svg>
                {viewFilter !== 'all' && (
                  <span>{VIEW_FILTERS.find((f) => f[0] === viewFilter)?.[1]}</span>
                )}
              </button>
              {filterOpen && (
                <>
                  <div className="absolute right-0 mt-1 w-40 bg-[var(--t-panel)] border border-white/10 rounded-md shadow-lg z-30 overflow-hidden">
                    {VIEW_FILTERS.map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setViewFilter(id)
                          setFilterOpen(false)
                        }}
                        className={`block w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${
                          viewFilter === id ? 'text-[var(--t-tint-success)]' : 'text-white/80'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

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
      </div>

      {scope === 'contacts' ? (
        <SidebarContactsList canCall={canCall} canText onClose={onClose} />
      ) : searchResults !== null ? (
        // Server search results mode — shown when search.length >= 2
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Typed a phone number? Offer to text it directly — no detour through
              "New conversation". Opens the composer pre-filled (find-or-create). */}
          {search.replace(/\D/g, '').length >= 7 && (
            <button
              type="button"
              onClick={() => { setNewInitialQuery(search); setNewOpen(true) }}
              className="w-full text-left px-4 py-2.5 border-b border-white/5 hover:bg-white/5 flex items-center gap-2 text-sm"
            >
              <span className="text-emerald-400">💬</span>
              <span>Message <span className="font-medium">{formatPhone(search.replace(/\D/g, '').slice(-10))}</span></span>
            </button>
          )}
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
                        onClick={(e) => { markRead(c.id); if (wsTabs.enabled) { e.preventDefault(); onClose?.(); openTxtTab(c); return } onClose?.() }}
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
                              <AiDot c={c} />{displayNameFor(c)}
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
                      onClick={(e) => { if (wsTabs.enabled) { e.preventDefault(); onClose?.(); openTxtTab(c); return } onClose?.() }}
                      className={`block px-4 py-2 ${active ? 'bg-white/5' : 'hover:bg-white/5'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 min-w-0">
                          {activityIcon(c)}
                          <span className="font-medium text-sm truncate">
                            <AiDot c={c} />{displayNameFor(c)}
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
                        className="px-2 py-0.5 rounded bg-emerald-600/80 hover:bg-emerald-600 text-[#fff] text-[10px] font-medium disabled:opacity-50"
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
                  onClick={(e) => { markRead(c.id); if (wsTabs.enabled) { e.preventDefault(); onClose?.(); openTxtTab(c); return } onClose?.() }}
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
                        <AiDot c={c} />{displayNameFor(c)}
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
        {canManage ? (
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
        <NewConversationModal
          initialQuery={newInitialQuery}
          onClose={() => { setNewOpen(false); setNewInitialQuery('') }}
          onCreated={load}
        />
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
  initialQuery = '',
}: {
  onClose: () => void
  onCreated: () => void
  initialQuery?: string
}) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<
    Array<{ id: string; name: string; name_source?: string | null; phone: string; do_not_text?: boolean }>
  >([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  // Pre-fill the manual-phone box when the caller handed us a number, so
  // "Message this number" lands ready to send.
  const [manualPhone, setManualPhone] = useState(
    /\d/.test(initialQuery) && initialQuery.replace(/\D/g, '').length >= 7 ? initialQuery : ''
  )
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
                      {nameIsAiGuessed(r.name_source) && <span className="w-2 h-2 rounded-full bg-purple-400 flex-none" title="Name suggested by AI — open to confirm" />}
                      {contactDisplayName(r.name, r.phone)}
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
