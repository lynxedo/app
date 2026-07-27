'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { SidebarHeader } from './SidebarShell'
import { createClient } from '@/lib/supabase/client'
import { Spinner, EmptyState, useToast } from '@/components/ui'
import RulesPanel from '@/components/hub/email/RulesPanel'
import FoldersPanel from '@/components/hub/email/FoldersPanel'
import TagsPanel from '@/components/hub/email/TagsPanel'
import TemplatesPanel from '@/components/hub/email/TemplatesPanel'
import {
  relativeTime,
  messageTime,
  participantName,
  initials,
  firstName,
  WAITING_LABELS,
  type AccountType,
  type Scope,
  type Lens,
  type WaitingState,
  type InboxTag,
  type InboxSavedView,
  type InboxAccount,
  type EmailThread,
  type EmailMessage,
  type EmailDraft,
  type MailFolder,
} from '@/components/hub/email/emailFormat'

// Special folder-dropdown value that switches the list to the user's Drafts.
const DRAFTS_VIEW = '__drafts__'

const READS_KEY = 'email-conv-reads'

/** Compact message row shown when a thread is expanded in the list. */
type PreviewMessage = {
  id: string
  direction: 'inbound' | 'outbound'
  from_name: string | null
  from_email: string | null
  snippet: string | null
  message_date: string | null
}

type PreviewState = { loading: boolean; error: boolean; messages: PreviewMessage[] }

/** A hub teammate (GET /api/hub/users) — for the bulk Assign dropdown. */
type HubUser = { id: string; display_name: string; is_bot?: boolean }

/** Folders that are filing/system views rather than the live queue. */
function isSystemFolder(f: MailFolder): boolean {
  if (f.system_folder && f.system_folder.toLowerCase() !== 'inbox') return true
  return /^(sent( items)?|drafts?|deleted( items)?|junk( e-?mail)?|trash|spam|archive|outbox)$/i.test(
    (f.name || '').trim()
  )
}

/**
 * Hub Inbox thread list (mirrors TxtV2Sidebar). Mounted by the Hub shell — do
 * NOT render inside a page. Loads accounts to decide which scopes/tabs to show,
 * then lists threads for the current account + scope + folder + search. Realtime
 * refresh via the company `inbox:{companyId}` broadcast channel + a 30s poll.
 *
 * Views (PRD Redesign 2026-07-22), Txt-style:
 *   • Primary tabs — Manager: Mine · All · Closed;  Standard user: Mine · Closed.
 *   • Secondary lens — All · Unread · Needs replied (a within-list filter).
 *   • Managers also get a pinned "Queued" (unassigned) section they can claim from,
 *     shown inside both Mine and All (not a separate tab).
 *
 * Prop signature (for the orchestrator wiring this into HubShell):
 *   <EmailInboxSidebar currentUserId={id} companyId={id}
 *      onClose?={fn} onDesktopCollapse?={fn} />
 */
export default function EmailInboxSidebar({
  currentUserId,
  companyId,
  onClose,
  onDesktopCollapse,
}: {
  currentUserId: string
  companyId: string
  onClose?: () => void
  onDesktopCollapse?: () => void
}) {
  const pathname = usePathname() || ''
  const router = useRouter()
  const toast = useToast()

  // Accounts / access.
  const [accounts, setAccounts] = useState<InboxAccount[]>([])
  const [isManager, setIsManager] = useState(false)
  const [canCompose, setCanCompose] = useState(false)
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [account, setAccount] = useState<AccountType>('shared')

  // List state.
  const [threads, setThreads] = useState<EmailThread[]>([])
  const [queue, setQueue] = useState<EmailThread[]>([]) // manager-only unassigned Queue
  const [drafts, setDrafts] = useState<EmailDraft[]>([]) // Drafts view
  const [draftsLoading, setDraftsLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [scope, setScope] = useState<Scope>('mine')
  const [lens, setLens] = useState<Lens>('all') // secondary within-list filter
  const [folder, setFolder] = useState('') // '' = Inbox / default
  const [folders, setFolders] = useState<MailFolder[]>([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [claiming, setClaiming] = useState<string | null>(null)

  // Phase 2 filters (server-side; compose with the current scope).
  const [tagFilter, setTagFilter] = useState('') // a single tag id, or '' for all
  const [waitingFilter, setWaitingFilter] = useState<'' | 'any' | WaitingState>('')
  const [snoozedView, setSnoozedView] = useState(false) // Phase 3A — show only currently-snoozed threads
  const [tagCatalog, setTagCatalog] = useState<InboxTag[]>([]) // admin tag definitions — resolves row tag ids + fills the filter dropdown

  // Gear menu + Rules + Folders + Tags.
  const [gearOpen, setGearOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [foldersOpen, setFoldersOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const gearRef = useRef<HTMLDivElement>(null)

  // Phase 4A — Saved views (per-user pinned filter snapshots).
  const [savedViews, setSavedViews] = useState<InboxSavedView[]>([])
  const [viewsOpen, setViewsOpen] = useState(false)
  const [newViewName, setNewViewName] = useState('')
  const [savingView, setSavingView] = useState(false)
  const viewsRef = useRef<HTMLDivElement>(null)

  // Phase 4A — Multi-select bulk triage (managers only).
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkMenu, setBulkMenu] = useState<null | 'assign' | 'tag' | 'snooze' | 'waiting'>(null)
  const [teammates, setTeammates] = useState<HubUser[]>([])
  const teammatesLoadedRef = useRef(false)
  const bulkBarRef = useRef<HTMLDivElement>(null)

  // Expanded-thread previews (Outlook-style chevron sub-rows).
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({})

  // Per-device read tracking (mirrors the Txt sidebar). Maps thread id → the ISO
  // time this device last opened it; a thread is "unread" when its inbound
  // last_message_at is newer than that stamp.
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

  const hasShared = accounts.some((a) => a.account_type === 'shared')
  const hasPersonal = accounts.some((a) => a.account_type === 'personal')

  // Load accounts once, then pick a sensible default account.
  useEffect(() => {
    let cancelled = false
    fetch('/api/hub/email/accounts')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return
        const accts: InboxAccount[] = data.accounts || []
        const mgr = !!data.flags?.isManager
        setAccounts(accts)
        setIsManager(mgr)
        setCanCompose(!!data.flags?.canCompose)
        const sharedExists = accts.some((a) => a.account_type === 'shared')
        const personalExists = accts.some((a) => a.account_type === 'personal')
        // Everyone who can reach the shared box lands there; else their personal box.
        const defaultAccount: AccountType = sharedExists ? 'shared' : personalExists ? 'personal' : 'shared'
        setAccount(defaultAccount)
        setScope('mine')
      })
      .catch(() => {
        if (!cancelled) {
          setAccounts([])
        }
      })
      .finally(() => {
        if (!cancelled) setAccountsLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Load the admin tag catalog once — resolves row tag ids → name/color and fills
  // the tag filter dropdown. (Managers edit it via the gear → Manage tags panel.)
  useEffect(() => {
    let cancelled = false
    fetch('/api/hub/email/tags')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (!cancelled) setTagCatalog((data.tags || []) as InboxTag[])
      })
      .catch(() => {
        if (!cancelled) setTagCatalog([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Reset scope when the account changes (personal + shared-standard only have "mine").
  useEffect(() => {
    if (account === 'personal') setScope('mine')
    else if (account === 'shared' && !isManager) setScope('mine')
  }, [account, isManager])

  // Debounce the search box (250ms).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  // Close the gear menu on outside click.
  useEffect(() => {
    if (!gearOpen) return
    function onDown(e: MouseEvent) {
      if (gearRef.current && !gearRef.current.contains(e.target as Node)) setGearOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [gearOpen])

  // Load the folder list for the current account (lean — Inbox default + others).
  const loadFolders = useCallback(() => {
    if (!accountsLoaded) return
    fetch(`/api/hub/email/folders?account=${encodeURIComponent(account)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setFolders(data.folders || []))
      .catch(() => setFolders([]))
  }, [account, accountsLoaded])

  useEffect(() => {
    loadFolders()
    setFolder('') // reset folder selection when switching accounts
  }, [loadFolders])

  const isDraftsView = folder === DRAFTS_VIEW
  // Managers see the pinned unassigned Queue on the live Inbox view (not on Closed / Drafts / a folder /
  // the snoozed view).
  const showQueue = isManager && account === 'shared' && folder === '' && scope !== 'closed' && !snoozedView

  const load = useCallback(async () => {
    if (!accountsLoaded || isDraftsView) return
    setLoading(true)
    const params = new URLSearchParams({ scope, account, limit: '100' })
    if (folder) params.set('folder', folder)
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (tagFilter) params.set('tag', tagFilter)
    if (waitingFilter) params.set('waiting', waitingFilter)
    // Snoozed view — keep the current scope but ask only for currently-snoozed
    // threads (active views hide these server-side by default).
    if (snoozedView) params.set('snoozed', '1')
    const reqs: Promise<Response>[] = [fetch(`/api/hub/email/threads?${params.toString()}`)]
    if (showQueue) {
      const qp = new URLSearchParams({ scope: 'unassigned', account, limit: '100' })
      if (debouncedSearch) qp.set('search', debouncedSearch)
      if (tagFilter) qp.set('tag', tagFilter)
      if (waitingFilter) qp.set('waiting', waitingFilter)
      reqs.push(fetch(`/api/hub/email/threads?${qp.toString()}`))
    }
    try {
      const [mainRes, queueRes] = await Promise.all(reqs)
      if (mainRes.ok) setThreads((await mainRes.json()).threads || [])
      if (showQueue && queueRes?.ok) setQueue((await queueRes.json()).threads || [])
      else if (!showQueue) setQueue([])
    } finally {
      setLoading(false)
    }
  }, [scope, account, folder, debouncedSearch, tagFilter, waitingFilter, snoozedView, accountsLoaded, showQueue, isDraftsView])

  useEffect(() => {
    load()
  }, [load])

  // Drafts view — load the caller's own drafts for the current mailbox.
  const loadDrafts = useCallback(async () => {
    if (!accountsLoaded || !isDraftsView) return
    setDraftsLoading(true)
    try {
      const res = await fetch(`/api/hub/email/drafts?account=${encodeURIComponent(account)}`)
      if (res.ok) setDrafts((await res.json()).drafts || [])
    } finally {
      setDraftsLoading(false)
    }
  }, [account, accountsLoaded, isDraftsView])

  useEffect(() => {
    loadDrafts()
  }, [loadDrafts])

  async function deleteDraft(id: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDrafts((prev) => prev.filter((d) => d.id !== id)) // optimistic
    try {
      const res = await fetch(`/api/hub/email/drafts/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        // e.g. a scheduled send too close to its time to cancel.
        toast.error(data.error || "Couldn't remove that")
        loadDrafts() // restore the row
      }
    } catch {
      loadDrafts() // restore on failure
    }
  }

  // Edit a scheduled send: cancel it at the provider, reopen as an editable draft.
  async function editScheduled(id: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    try {
      const res = await fetch(`/api/hub/email/drafts/${id}/unschedule`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "Couldn't edit that")
        return
      }
      const d = data.draft as { id: string; kind: string; thread_id: string | null } | undefined
      if (!d) return
      onClose?.()
      if (d.kind === 'new' || !d.thread_id) router.push(`/hub/email/compose?draft=${d.id}`)
      else router.push(`/hub/email/${d.thread_id}`)
    } catch {
      toast.error("Couldn't edit that")
    }
  }

  // Realtime — the sync/webhook pipeline broadcasts on `inbox:{companyId}`.
  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    const supabase = createClient()
    const channel = supabase
      .channel(`inbox:${companyId}`)
      .on('broadcast', { event: 'update' }, () => {
        if (!cancelled) load()
      })
      .on('broadcast', { event: 'sync' }, () => {
        if (!cancelled) load()
      })
      .subscribe()
    const t = setInterval(() => {
      if (!cancelled) load()
    }, 30000)
    return () => {
      cancelled = true
      clearInterval(t)
      supabase.removeChannel(channel)
    }
  }, [load, companyId])

  // Mark the currently-open thread read on navigation + on each refresh.
  useEffect(() => {
    const m = pathname.match(/^\/hub\/email\/([0-9a-fA-F-]+)$/)
    if (m) markRead(m[1])
  }, [pathname, threads, markRead])

  function isUnread(t: EmailThread): boolean {
    if (t.status === 'closed') return false
    // Only light the dot / count the "Unread" lens for MY threads — in the shared
    // "All" view, lighting every teammate's unread would bury my own (Txt behavior).
    if (!t.mine) return false
    if (pathname === `/hub/email/${t.id}`) return false
    if (t.last_message_direction !== 'inbound') return false
    if (!t.last_message_at) return false
    const seen = reads[t.id]
    // No per-device stamp yet → defer to the server's unread flag. Once this
    // device has opened the thread, the stamp takes over so the dot clears
    // immediately on open and only relights when a newer inbound lands.
    if (!seen) return t.unread
    return t.last_message_at > seen
  }

  const needsReply = (t: EmailThread) =>
    t.status !== 'closed' && t.last_message_direction === 'inbound'

  // Secondary within-list lens (All · Unread · Needs replied), Txt-style.
  const passesLens = useCallback(
    (t: EmailThread) => {
      if (lens === 'unread') return isUnread(t)
      if (lens === 'needs_reply') return needsReply(t)
      return true
    },
    // isUnread/needsReply close over `reads`/`pathname`; recompute when those change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lens, reads, pathname]
  )

  // In the "All" scope the unassigned threads also come back in the main list —
  // drop them so they only appear once (in the pinned Queue above). The Drafts view
  // renders its own list, so the thread/queue lists are empty there.
  const filteredThreads = isDraftsView
    ? []
    : threads
        .filter((t) => !(showQueue && scope === 'all' && t.status === 'open' && !t.assigned_to_user_id))
        .filter(passesLens)
  const filteredQueue = isDraftsView ? [] : queue.filter(passesLens)

  async function claim(id: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (claiming) return
    setClaiming(id)
    try {
      const res = await fetch(`/api/hub/email/threads/${id}/claim`, { method: 'POST' })
      if (res.ok) {
        toast.success('Claimed')
        load()
      } else {
        toast.error("Couldn't claim conversation")
      }
    } catch {
      toast.error("Couldn't claim conversation")
    } finally {
      setClaiming(null)
    }
  }

  // ── Phase 4A — Saved views ──────────────────────────────────────────────────
  const loadSavedViews = useCallback(() => {
    fetch('/api/hub/email/saved-views')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setSavedViews((data.views || []) as InboxSavedView[]))
      .catch(() => setSavedViews([]))
  }, [])
  useEffect(() => {
    loadSavedViews()
  }, [loadSavedViews])

  // Close the Views dropdown on outside click (mirrors the gear menu).
  useEffect(() => {
    if (!viewsOpen) return
    function onDown(e: MouseEvent) {
      if (viewsRef.current && !viewsRef.current.contains(e.target as Node)) setViewsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [viewsOpen])

  // Close an open bulk submenu on outside click.
  useEffect(() => {
    if (!bulkMenu) return
    function onDown(e: MouseEvent) {
      if (bulkBarRef.current && !bulkBarRef.current.contains(e.target as Node)) setBulkMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [bulkMenu])

  // Snapshot the current filter state as a saved-view config (only include set keys —
  // never persist empty strings, mirroring the load() request builder above).
  function buildCurrentConfig(): InboxSavedView['config'] {
    const config: InboxSavedView['config'] = { scope }
    if (tagFilter) config.tag = tagFilter
    if (waitingFilter) config.waiting = waitingFilter
    if (folder) config.folder = folder
    const s = search.trim()
    if (s) config.search = s
    if (snoozedView) config.snoozed = true
    return config
  }

  // Apply a saved view's config to the live filter state (missing keys → cleared /
  // sensible default). The existing load() effect reloads on these deps.
  function applyView(v: InboxSavedView) {
    const c = v.config || {}
    setScope((c.scope as Scope) || 'mine')
    setTagFilter(c.tag || '')
    setWaitingFilter((c.waiting as '' | 'any' | WaitingState) || '')
    setFolder(c.folder || '')
    setSearch(c.search || '')
    setSnoozedView(!!c.snoozed)
    setExpandedId(null)
    setViewsOpen(false)
  }

  async function saveCurrentView() {
    const name = newViewName.trim()
    if (!name || savingView) return
    setSavingView(true)
    try {
      const res = await fetch('/api/hub/email/saved-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, config: buildCurrentConfig() }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setNewViewName('')
        loadSavedViews()
        toast.success('View saved')
      } else if (res.status === 409) {
        toast.error(data.error || 'A view with that name already exists')
      } else {
        toast.error(data.error || "Couldn't save view")
      }
    } catch {
      toast.error("Couldn't save view")
    } finally {
      setSavingView(false)
    }
  }

  async function deleteView(id: string) {
    setSavedViews((prev) => prev.filter((v) => v.id !== id)) // optimistic
    try {
      const res = await fetch(`/api/hub/email/saved-views/${id}`, { method: 'DELETE' })
      if (!res.ok) toast.error("Couldn't delete view")
    } catch {
      toast.error("Couldn't delete view")
    } finally {
      loadSavedViews() // reconcile against the server
    }
  }

  // ── Phase 4A — Bulk actions (managers only) ─────────────────────────────────
  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleSelectMode() {
    setSelectMode((v) => {
      const next = !v
      if (!next) {
        setSelectedIds(new Set())
        setBulkMenu(null)
      }
      return next
    })
  }

  // Teammate list for the bulk Assign menu — fetched once, lazily on first open.
  const loadTeammates = useCallback(() => {
    if (teammatesLoadedRef.current) return
    teammatesLoadedRef.current = true
    fetch('/api/hub/users')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setTeammates(((data.users || []) as HubUser[]).filter((u) => !u.is_bot)))
      .catch(() => {
        teammatesLoadedRef.current = false
        setTeammates([])
      })
  }, [])

  function openBulkMenu(m: 'assign' | 'tag' | 'snooze' | 'waiting') {
    setBulkMenu((prev) => (prev === m ? null : m))
    if (m === 'assign') loadTeammates()
  }

  // Tomorrow at 8:00 AM local, ISO — the one-tap bulk snooze target.
  function tomorrow8am(): string {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(8, 0, 0, 0)
    return d.toISOString()
  }

  // Apply ONE bulk action to the current selection, then clear + reload.
  async function bulkAction(action: string, params: Record<string, unknown>) {
    if (bulkBusy || selectedIds.size === 0) return
    setBulkBusy(true)
    try {
      const res = await fetch('/api/hub/email/threads/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_ids: [...selectedIds], action, params }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(`Updated ${data.applied ?? selectedIds.size}`)
        setSelectedIds(new Set())
        setBulkMenu(null)
        load()
      } else {
        toast.error(data.error || "Couldn't apply that")
      }
    } catch {
      toast.error("Couldn't apply that")
    } finally {
      setBulkBusy(false)
    }
  }

  // Lazily fetch the thread's messages for the chevron preview. A ref mirrors
  // the cache so the callback stays stable AND the fetch never runs inside a
  // state updater (strict mode double-invokes those).
  const previewsRef = useRef(previews)
  previewsRef.current = previews
  const toggleExpand = useCallback((threadId: string) => {
    setExpandedId((prev) => (prev === threadId ? null : threadId))
    if (previewsRef.current[threadId]) return
    setPreviews((p) => ({ ...p, [threadId]: { loading: true, error: false, messages: [] } }))
    fetch(`/api/hub/email/threads/${threadId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        const msgs = ((data.messages || []) as EmailMessage[])
          .map((m) => ({
            id: m.id,
            direction: m.direction,
            from_name: m.from_name,
            from_email: m.from_email,
            snippet: m.snippet,
            message_date: m.message_date,
          }))
          // Newest first, Outlook-style.
          .reverse()
        setPreviews((p) => ({
          ...p,
          [threadId]: { loading: false, error: false, messages: msgs },
        }))
      })
      .catch(() => {
        setPreviews((p) => ({
          ...p,
          [threadId]: { loading: false, error: true, messages: [] },
        }))
      })
  }, [])

  // Which primary tabs to show for the current account + role.
  const tabs: { id: Scope; label: string }[] =
    account === 'personal'
      ? [{ id: 'mine', label: 'Inbox' }]
      : isManager
      ? [
          { id: 'mine', label: 'Mine' },
          { id: 'all', label: 'All' },
          { id: 'closed', label: 'Closed' },
        ]
      : [
          { id: 'mine', label: 'Mine' },
          { id: 'closed', label: 'Closed' },
        ]

  const showAccountToggle = hasShared && hasPersonal
  // Non-Inbox folders are reference/filing views — the workflow tabs + lens only
  // make sense on the live Inbox queue.
  const showTabs = folder === ''
  const showLens = folder === '' && scope !== 'closed'

  const lenses: { id: Lens; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread' },
    { id: 'needs_reply', label: 'Needs reply' },
  ]

  // Active tag catalog (split by kind for the filter dropdown) + an id→tag lookup for
  // the row chips. Unknown/inactive ids simply resolve to nothing.
  const activeTags = tagCatalog
    .filter((t) => t.active)
    .sort((a, b) => a.sort_order - b.sort_order)
  const typeTags = activeTags.filter((t) => t.kind === 'type')
  const outcomeTags = activeTags.filter((t) => t.kind === 'outcome')
  const tagById = new Map(tagCatalog.map((t) => [t.id, t] as const))

  const gearMenu = (
    <div className="relative" ref={gearRef}>
      <button
        type="button"
        onClick={() => setGearOpen((v) => !v)}
        className="text-white/40 hover:text-white/80 transition-colors p-1 rounded"
        aria-label="Inbox options"
        title="Inbox options"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
      {gearOpen && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-[var(--t-panel)] border border-white/10 rounded-md shadow-lg z-50 overflow-hidden">
          {/* Rules are manager/office-only (the API is requireAdminArea-gated); don't
              show the entry to users who'd only get a 403. */}
          {isManager && (
            <button
              type="button"
              onClick={() => {
                setGearOpen(false)
                setRulesOpen(true)
              }}
              className="block w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/5"
            >
              Rules
            </button>
          )}
          {isManager && (
            <button
              type="button"
              onClick={() => {
                setGearOpen(false)
                setFoldersOpen(true)
              }}
              className="block w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/5"
            >
              Folders
            </button>
          )}
          {isManager && (
            <button
              type="button"
              onClick={() => {
                setGearOpen(false)
                setTagsOpen(true)
              }}
              className="block w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/5"
            >
              Manage tags
            </button>
          )}
          {isManager && (
            <button
              type="button"
              onClick={() => {
                setGearOpen(false)
                setTemplatesOpen(true)
              }}
              className="block w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/5"
            >
              Manage templates
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setGearOpen(false)
              onClose?.()
              router.push('/hub/settings?tab=account')
            }}
            className={`block w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/5 ${isManager ? 'border-t border-white/10' : ''}`}
          >
            Inbox settings
          </button>
        </div>
      )}
    </div>
  )

  // A compact queue row (no chevron/preview) with an inline Claim button.
  const queueRow = (t: EmailThread) => (
    <li key={`q-${t.id}`} className="border-l-2 border-orange-400/50">
      <div className="flex items-center gap-1 hover:bg-white/5">
        <Link
          href={`/hub/email/${t.id}`}
          onClick={() => {
            markRead(t.id)
            onClose?.()
          }}
          className="flex-1 min-w-0 py-2 pl-3 pr-1"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium truncate">
              {participantName(t.from_name, t.from_email)}
            </span>
            <span className="text-[10px] text-white/40 flex-none">{relativeTime(t.last_message_at)}</span>
          </div>
          <div className="text-[13px] text-white/70 truncate mt-0.5">{t.subject || '(no subject)'}</div>
          <div className="text-[11px] text-white/40 truncate mt-0.5">{t.snippet || ''}</div>
        </Link>
        <button
          type="button"
          onClick={(e) => claim(t.id, e)}
          disabled={claiming === t.id}
          className="flex-none mr-2 px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-[11px] font-medium disabled:opacity-50"
          title="Claim for yourself"
        >
          {claiming === t.id ? '…' : 'Claim'}
        </button>
      </div>
    </li>
  )

  return (
    <aside
      className="t-sidebar-surface h-full w-72 text-white flex flex-col flex-none min-h-0"
      style={{
        background: 'linear-gradient(180deg,var(--t-well),var(--t-rail))',
        borderRight: '1px solid rgba(255,255,255,.06)',
      }}
      aria-label="Hub Inbox sidebar"
    >
      <SidebarHeader
        title="Inbox"
        action={gearMenu}
        onClose={onClose}
        onDesktopCollapse={onDesktopCollapse}
      />

      <div className="px-3 pt-3 pb-2 space-y-2">
        {/* Shared-inbox composers OR anyone with a connected personal mailbox — the
            /compose page admits personal owners, so they need the entry point too. */}
        {(canCompose || hasPersonal) && (
          <Link
            href="/hub/email/compose"
            onClick={() => onClose?.()}
            className="block w-full px-3 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium text-center"
          >
            ✎ New email
          </Link>
        )}

        {/* Account toggle — only when the user has both a shared + personal box. */}
        {showAccountToggle && (
          <div className="flex gap-1 text-xs">
            {([
              ['shared', 'Shared'],
              ['personal', 'Personal'],
            ] as [AccountType, string][]).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setAccount(id)}
                className={`flex-1 px-2 py-1 rounded-md transition ${
                  account === id ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search email…"
          className="w-full px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
        />

        {/* Kanban board view of the shared inbox. */}
        <Link
          href="/hub/email/board"
          onClick={() => onClose?.()}
          className="block w-full px-2 py-[3px] rounded-md text-[11px] text-center bg-white/[0.04] text-white/60 hover:text-white/90 transition"
          title="Board view"
        >
          ⊞ Board
        </Link>

        {/* Folder dropdown — Inbox default + Drafts; other folders are reference/filing
            views. System folders (Sent/Deleted/Junk…) get an em-dash prefix. */}
        <select
          value={folder}
          onChange={(e) => {
            const v = e.target.value
            setFolder(v)
            setExpandedId(null)
            // A filing folder shows everything in it; the Inbox queue returns to the
            // personal default. Drafts is its own view — leave the scope alone.
            if (account === 'shared' && isManager && v !== DRAFTS_VIEW) setScope(v ? 'all' : 'mine')
          }}
          className="w-full px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs text-white/80"
        >
          <option value="">Inbox</option>
          <option value={DRAFTS_VIEW}>Drafts</option>
          {folders
            // Hide the Inbox + Drafts system folders — the "Inbox" default IS the
            // Outlook Inbox mirror, and our "Drafts" entry IS the drafts view, so
            // listing the provider folders again would duplicate both (the old confusion).
            .filter((f) => {
              const s = (f.system_folder || '').toLowerCase()
              return s !== 'inbox' && s !== 'drafts'
            })
            .map((f) => (
              <option key={f.id} value={f.provider_folder_id}>
                {isSystemFolder(f) ? '— ' : ''}
                {f.name}
                {f.unread_count > 0 ? ` (${f.unread_count})` : ''}
              </option>
            ))}
        </select>

        {/* Primary tabs — Inbox only; wrap cleanly instead of overlapping at
            narrow sidebar widths. */}
        {showTabs && tabs.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setScope(t.id)}
                className={`px-2 py-[3px] rounded-full text-[11px] whitespace-nowrap transition ${
                  scope === t.id
                    ? 'bg-white/15 text-white font-medium'
                    : 'bg-white/[0.04] text-white/50 hover:text-white/80'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        {showTabs && tabs.length === 1 && (
          <div className="px-1 pt-0.5 text-[11px] uppercase tracking-wide text-white/40">
            {tabs[0].label}
          </div>
        )}

        {/* Secondary within-list lens — All · Unread · Needs reply. */}
        {showLens && (
          <div className="flex gap-1">
            {lenses.map((l) => (
              <button
                key={l.id}
                onClick={() => setLens(l.id)}
                className={`flex-1 px-2 py-[3px] rounded-md text-[11px] whitespace-nowrap transition ${
                  lens === l.id
                    ? 'bg-white/10 text-white font-medium'
                    : 'text-white/40 hover:text-white/70'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        )}

        {/* Phase 2 filters — tag + waiting-on. Server-side (compose with the scope),
            shown on the live Inbox view alongside the tabs/lens. */}
        {showTabs && (
          <div className="flex gap-1">
            {activeTags.length > 0 && (
              <select
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                aria-label="Filter by tag"
                className="flex-1 min-w-0 px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs text-white/80"
              >
                <option value="">All tags</option>
                {typeTags.length > 0 && (
                  <optgroup label="Type">
                    {typeTags.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {outcomeTags.length > 0 && (
                  <optgroup label="Outcome">
                    {outcomeTags.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}
            <select
              value={waitingFilter}
              onChange={(e) => setWaitingFilter(e.target.value as '' | 'any' | WaitingState)}
              aria-label="Filter by waiting state"
              className="flex-1 min-w-0 px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs text-white/80"
            >
              <option value="">Waiting: off</option>
              <option value="any">Any waiting</option>
              {(Object.keys(WAITING_LABELS) as WaitingState[]).map((w) => (
                <option key={w} value={w}>
                  {WAITING_LABELS[w]}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Snoozed view toggle (Phase 3A) — keeps the current scope but asks the
            server for only currently-snoozed threads (hidden from active views). */}
        {showTabs && (
          <button
            type="button"
            onClick={() => setSnoozedView((v) => !v)}
            aria-pressed={snoozedView}
            className={`w-full px-2 py-[3px] rounded-md text-[11px] whitespace-nowrap transition ${
              snoozedView
                ? 'bg-indigo-500/25 text-indigo-200 font-medium'
                : 'text-white/40 hover:text-white/70'
            }`}
            title="Show snoozed conversations"
          >
            💤 {snoozedView ? 'Showing snoozed' : 'Snoozed'}
          </button>
        )}

        {/* Phase 4A — Saved views (apply / save current) + a manager-only Select
            toggle for bulk triage. Sits alongside the tag/Waiting filters. */}
        <div className="flex items-center gap-1">
          <div className="relative flex-1 min-w-0" ref={viewsRef}>
            <button
              type="button"
              onClick={() => setViewsOpen((v) => !v)}
              aria-expanded={viewsOpen}
              className="w-full px-2 py-[3px] rounded-md text-[11px] bg-white/[0.04] text-white/60 hover:text-white/90 transition"
              title="Saved views"
            >
              Views ▾
            </button>
            {viewsOpen && (
              <div className="absolute left-0 top-full mt-1 w-60 bg-[var(--t-panel)] border border-white/10 rounded-md shadow-lg z-50 overflow-hidden">
                <div className="max-h-52 overflow-y-auto">
                  {savedViews.length === 0 && (
                    <div className="px-3 py-2 text-[11px] text-white/40">No saved views yet.</div>
                  )}
                  {savedViews.map((v) => (
                    <div key={v.id} className="flex items-center hover:bg-white/5">
                      <button
                        type="button"
                        onClick={() => applyView(v)}
                        className="flex-1 min-w-0 text-left px-3 py-2 text-sm text-white/80 truncate"
                        title={`Apply "${v.name}"`}
                      >
                        {v.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteView(v.id)}
                        className="flex-none w-7 h-7 mr-1 rounded flex items-center justify-center text-white/30 hover:text-red-300 hover:bg-white/5"
                        aria-label={`Delete view ${v.name}`}
                        title="Delete view"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <div className="border-t border-white/10 p-2 space-y-1">
                  <input
                    type="text"
                    value={newViewName}
                    onChange={(e) => setNewViewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        saveCurrentView()
                      }
                    }}
                    placeholder="Name this view"
                    className="w-full px-2 py-1 rounded-md bg-white/5 border border-white/10 text-xs placeholder-white/30"
                  />
                  <button
                    type="button"
                    onClick={saveCurrentView}
                    disabled={savingView || !newViewName.trim()}
                    className="w-full px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-[11px] font-medium text-[#fff] disabled:opacity-50"
                  >
                    {savingView ? 'Saving…' : 'Save current view'}
                  </button>
                </div>
              </div>
            )}
          </div>
          {isManager && !isDraftsView && (
            <button
              type="button"
              onClick={toggleSelectMode}
              aria-pressed={selectMode}
              className={`flex-none px-2 py-[3px] rounded-md text-[11px] transition ${
                selectMode
                  ? 'bg-emerald-600 text-[#fff] font-medium'
                  : 'bg-white/[0.04] text-white/60 hover:text-white/90'
              }`}
              title="Select conversations for bulk actions"
            >
              {selectMode ? 'Done' : 'Select'}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Phase 4A — bulk action bar (managers, multi-select mode). Sticky to the
            top of the list; opaque panel surface so rows scroll under it cleanly. */}
        {selectMode && !isDraftsView && selectedIds.size > 0 && (
          <div
            ref={bulkBarRef}
            className="sticky top-0 z-30 bg-[var(--t-panel)] border-b border-white/10 px-2 py-2"
          >
            <div className="flex items-center flex-wrap gap-1 text-[11px]">
              <span className="text-white/60 font-medium mr-1">{selectedIds.size} selected</span>

              {/* Assign ▾ */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => openBulkMenu('assign')}
                  disabled={bulkBusy}
                  className="px-2 py-[3px] rounded-md bg-white/[0.06] text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-50 transition"
                >
                  Assign ▾
                </button>
                {bulkMenu === 'assign' && (
                  <div className="absolute left-0 top-full mt-1 w-48 bg-[var(--t-panel)] border border-white/10 rounded-md shadow-lg z-50 max-h-64 overflow-y-auto">
                    {teammates.length === 0 && (
                      <div className="px-3 py-2 text-[11px] text-white/40">No teammates</div>
                    )}
                    {teammates.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        disabled={bulkBusy}
                        onClick={() => bulkAction('assign', { user_id: u.id })}
                        className="block w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/5 disabled:opacity-50"
                      >
                        {u.display_name}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={bulkBusy}
                      onClick={() => bulkAction('assign', { user_id: null })}
                      className="block w-full text-left px-3 py-2 text-sm text-orange-300 hover:bg-white/5 border-t border-white/10 disabled:opacity-50"
                    >
                      Unassign
                    </button>
                  </div>
                )}
              </div>

              {/* Close */}
              <button
                type="button"
                onClick={() => bulkAction('close', {})}
                disabled={bulkBusy}
                className="px-2 py-[3px] rounded-md bg-white/[0.06] text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-50 transition"
              >
                Close
              </button>

              {/* Tag ▾ */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => openBulkMenu('tag')}
                  disabled={bulkBusy}
                  className="px-2 py-[3px] rounded-md bg-white/[0.06] text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-50 transition"
                >
                  Tag ▾
                </button>
                {bulkMenu === 'tag' && (
                  <div className="absolute left-0 top-full mt-1 w-48 bg-[var(--t-panel)] border border-white/10 rounded-md shadow-lg z-50 max-h-64 overflow-y-auto">
                    {activeTags.length === 0 && (
                      <div className="px-3 py-2 text-[11px] text-white/40">No tags</div>
                    )}
                    {activeTags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        disabled={bulkBusy}
                        onClick={() => bulkAction('add_tag', { tag_id: tag.id })}
                        className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/5 disabled:opacity-50"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-none"
                          style={{ backgroundColor: tag.color || '#64748b' }}
                          aria-hidden
                        />
                        <span className="truncate">{tag.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Snooze ▾ */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => openBulkMenu('snooze')}
                  disabled={bulkBusy}
                  className="px-2 py-[3px] rounded-md bg-white/[0.06] text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-50 transition"
                >
                  Snooze ▾
                </button>
                {bulkMenu === 'snooze' && (
                  <div className="absolute left-0 top-full mt-1 w-44 bg-[var(--t-panel)] border border-white/10 rounded-md shadow-lg z-50 overflow-hidden">
                    <button
                      type="button"
                      disabled={bulkBusy}
                      onClick={() => bulkAction('snooze', { snoozed_until: tomorrow8am() })}
                      className="block w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/5 disabled:opacity-50"
                    >
                      Tomorrow 8am
                    </button>
                    <button
                      type="button"
                      disabled={bulkBusy}
                      onClick={() => bulkAction('snooze', { snoozed_until: null })}
                      className="block w-full text-left px-3 py-2 text-sm text-white/60 hover:bg-white/5 border-t border-white/10 disabled:opacity-50"
                    >
                      Clear snooze
                    </button>
                  </div>
                )}
              </div>

              {/* Waiting ▾ */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => openBulkMenu('waiting')}
                  disabled={bulkBusy}
                  className="px-2 py-[3px] rounded-md bg-white/[0.06] text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-50 transition"
                >
                  Waiting ▾
                </button>
                {bulkMenu === 'waiting' && (
                  <div className="absolute left-0 top-full mt-1 w-48 bg-[var(--t-panel)] border border-white/10 rounded-md shadow-lg z-50 overflow-hidden">
                    {(Object.keys(WAITING_LABELS) as WaitingState[]).map((w) => (
                      <button
                        key={w}
                        type="button"
                        disabled={bulkBusy}
                        onClick={() => bulkAction('waiting', { waiting_state: w })}
                        className="block w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/5 disabled:opacity-50"
                      >
                        {WAITING_LABELS[w]}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={bulkBusy}
                      onClick={() => bulkAction('waiting', { waiting_state: null })}
                      className="block w-full text-left px-3 py-2 text-sm text-white/60 hover:bg-white/5 border-t border-white/10 disabled:opacity-50"
                    >
                      Clear waiting
                    </button>
                  </div>
                )}
              </div>

              {/* Clear selection */}
              <button
                type="button"
                onClick={() => {
                  setSelectedIds(new Set())
                  setBulkMenu(null)
                }}
                disabled={bulkBusy}
                className="ml-auto px-2 py-[3px] rounded-md text-white/50 hover:text-white/80 disabled:opacity-50 transition"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Drafts view — the caller's own saved/scheduled composes. */}
        {isDraftsView && (
          <div>
            {draftsLoading && drafts.length === 0 && (
              <div className="py-12 text-center">
                <Spinner size={6} />
              </div>
            )}
            {!draftsLoading && drafts.length === 0 && <EmptyState title="No drafts." />}
            <ul>
              {drafts.map((d) => {
                const scheduled = !!d.scheduled_at
                const href =
                  d.kind === 'new' || !d.thread_id
                    ? `/hub/email/compose?draft=${d.id}`
                    : `/hub/email/${d.thread_id}`
                const who = d.to_recipients?.map((r) => r.email).filter(Boolean).join(', ')
                const whenLabel = scheduled
                  ? new Date(d.scheduled_at as string).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })
                  : relativeTime(d.updated_at)
                const inner = (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">
                        {d.subject?.trim() || '(no subject)'}
                      </span>
                      {!scheduled && (
                        <span className="text-[10px] text-white/40 flex-none">{whenLabel}</span>
                      )}
                    </div>
                    <div className="text-[12px] text-white/50 truncate mt-0.5">
                      {who ? `To: ${who}` : 'No recipient yet'}
                    </div>
                    {scheduled && (
                      <div className="text-[11px] text-amber-300/90 mt-0.5 truncate">
                        ⏱ Scheduled — {whenLabel}
                      </div>
                    )}
                  </>
                )
                return (
                  <li
                    key={d.id}
                    className={`border-l-2 ${scheduled ? 'border-amber-400/50' : 'border-transparent'}`}
                  >
                    <div className="flex items-center gap-1 hover:bg-white/5">
                      {scheduled ? (
                        // Already handed to the provider — not editable; only cancellable.
                        <div className="flex-1 min-w-0 py-2.5 pl-4 pr-1">{inner}</div>
                      ) : (
                        <Link
                          href={href}
                          onClick={() => onClose?.()}
                          className="flex-1 min-w-0 py-2.5 pl-4 pr-1"
                        >
                          {inner}
                        </Link>
                      )}
                      {scheduled && (
                        <button
                          type="button"
                          onClick={(e) => editScheduled(d.id, e)}
                          className="flex-none w-6 h-6 rounded flex items-center justify-center text-white/30 hover:text-white/80 hover:bg-white/5"
                          aria-label="Edit scheduled send"
                          title="Edit (cancels the schedule, reopens as a draft)"
                        >
                          ✎
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => deleteDraft(d.id, e)}
                        className="flex-none mr-2 w-6 h-6 rounded flex items-center justify-center text-white/30 hover:text-red-300 hover:bg-white/5"
                        aria-label={scheduled ? 'Cancel scheduled send' : 'Delete draft'}
                        title={scheduled ? 'Cancel scheduled send' : 'Delete draft'}
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {!isDraftsView &&
          (!accountsLoaded || (loading && threads.length === 0 && queue.length === 0)) && (
            <div className="py-12 text-center">
              <Spinner size={6} />
            </div>
          )}

        {/* Pinned unassigned Queue (managers only) — claim/open to work it. */}
        {showQueue && filteredQueue.length > 0 && (
          <div>
            <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-orange-300/80 font-medium">
              Queued · {filteredQueue.length}
            </div>
            <ul className="border-b border-white/10 pb-1">{filteredQueue.map(queueRow)}</ul>
          </div>
        )}

        {!isDraftsView && accountsLoaded && !loading && filteredThreads.length === 0 && filteredQueue.length === 0 && (
          <EmptyState
            title={
              debouncedSearch
                ? 'No matching email.'
                : snoozedView
                ? 'Nothing snoozed. 💤'
                : folder
                ? 'Nothing in this folder.'
                : scope === 'closed'
                ? 'No closed threads.'
                : lens === 'unread'
                ? 'Nothing unread. 🎉'
                : lens === 'needs_reply'
                ? 'Nothing needs a reply. 🎉'
                : account === 'personal'
                ? 'Your personal inbox is empty.'
                : 'No conversations.'
            }
          />
        )}

        <ul>
          {filteredThreads.map((t) => {
            const active = pathname === `/hub/email/${t.id}`
            const unread = isUnread(t)
            // Render the chevron when the thread is known multi-message, or when
            // the API didn't send message_count (lazily discover on expand).
            const showChevron = (t.message_count ?? 2) > 1
            const isExpanded = expandedId === t.id
            const preview = previews[t.id]
            const rowTags = (t.tags || [])
              .map((id) => tagById.get(id))
              .filter((x): x is InboxTag => !!x)
            const waiting = t.waiting_state || null
            const rowSnoozedUntil = t.snoozed_until || null
            const rowSnoozed = !!rowSnoozedUntil && new Date(rowSnoozedUntil).getTime() > Date.now()
            return (
              <li
                key={t.id}
                className={`border-l-2 ${
                  active ? 'bg-white/5 border-emerald-400' : 'border-transparent'
                }`}
              >
                <div className={`flex items-stretch ${active ? '' : 'hover:bg-white/5'}`}>
                  {selectMode && (
                    <label
                      className="flex-none w-8 flex items-center justify-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(t.id)}
                        onChange={() => toggleSelected(t.id)}
                        className="w-3.5 h-3.5 accent-emerald-500 cursor-pointer"
                        aria-label={`Select ${participantName(t.from_name, t.from_email)}`}
                      />
                    </label>
                  )}
                  {showChevron && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        toggleExpand(t.id)
                      }}
                      className="flex-none w-6 flex items-center justify-center text-white/30 hover:text-white/80"
                      aria-label={isExpanded ? 'Hide messages' : 'Show messages'}
                      aria-expanded={isExpanded}
                    >
                      <svg
                        className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  )}
                  <Link
                    href={`/hub/email/${t.id}`}
                    onClick={() => {
                      markRead(t.id)
                      onClose?.()
                    }}
                    className={`flex-1 min-w-0 py-2.5 pr-4 ${showChevron ? 'pl-1' : 'pl-4'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 min-w-0">
                        {unread && (
                          <span
                            className="w-2 h-2 rounded-full bg-orange-400 flex-none"
                            aria-label="Unread"
                          />
                        )}
                        <span
                          className={`text-sm truncate ${
                            unread ? 'font-semibold text-white' : 'font-medium'
                          }`}
                        >
                          {participantName(t.from_name, t.from_email)}
                        </span>
                      </span>
                      <span
                        className={`text-[10px] flex-none ${
                          unread ? 'text-orange-300' : 'text-white/40'
                        }`}
                      >
                        {relativeTime(t.last_message_at)}
                      </span>
                    </div>
                    <div
                      className={`text-[13px] truncate mt-0.5 ${
                        unread ? 'text-white/90 font-medium' : 'text-white/70'
                      }`}
                    >
                      {t.subject || '(no subject)'}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className="text-[11px] text-white/40 truncate">
                        {t.last_message_direction === 'outbound' ? 'You: ' : ''}
                        {t.snippet || ''}
                      </span>
                      <span className="flex items-center gap-1.5 flex-none">
                        {t.has_attachments && (
                          <span className="text-white/40" title="Has attachments" aria-hidden>
                            📎
                          </span>
                        )}
                        {needsReply(t) && (
                          <span className="px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300 text-[9px] font-medium whitespace-nowrap">
                            ↩ needs reply
                          </span>
                        )}
                        {t.status === 'closed' ? (
                          <span className="text-[10px] text-white/30">closed</span>
                        ) : t.assigned_to_user_id && t.assignee_name ? (
                          <span
                            className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-200 text-[9px] font-semibold inline-flex items-center justify-center"
                            title={`Owner: ${t.assignee_name}`}
                          >
                            {initials(t.assignee_name)}
                          </span>
                        ) : (
                          <span className="text-[10px] text-orange-300/80">unclaimed</span>
                        )}
                      </span>
                    </div>
                    {/* Phase 2 — "waiting on …" pill + applied tag chips (cap 3 + overflow);
                        Phase 3A — a "snoozed until" pill. */}
                    {(waiting || rowTags.length > 0 || rowSnoozed) && (
                      <div className="flex items-center flex-wrap gap-1 mt-1">
                        {rowSnoozed && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-200 text-[9px] font-medium whitespace-nowrap"
                            title={`Snoozed until ${messageTime(rowSnoozedUntil)}`}
                          >
                            💤 {relativeTime(rowSnoozedUntil)}
                          </span>
                        )}
                        {waiting && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[9px] font-medium whitespace-nowrap"
                            title={WAITING_LABELS[waiting]}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-none" aria-hidden />
                            {WAITING_LABELS[waiting]}
                          </span>
                        )}
                        {rowTags.slice(0, 3).map((tag) => (
                          <span
                            key={tag.id}
                            className="px-1.5 py-0.5 rounded-full text-[9px] font-medium whitespace-nowrap"
                            style={{ backgroundColor: tag.color || '#64748b', color: '#fff' }}
                            title={tag.name}
                          >
                            {tag.name}
                          </span>
                        ))}
                        {rowTags.length > 3 && (
                          <span className="px-1 py-0.5 text-[9px] text-white/40">
                            +{rowTags.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                    {t.status === 'assigned' && t.assignee_name && !active && (
                      <div className="text-[10px] text-emerald-300/70 mt-0.5 truncate">
                        Owner: {firstName(t.assignee_name)}
                      </div>
                    )}
                  </Link>
                </div>

                {/* Expanded per-message sub-rows (Outlook-style). */}
                {isExpanded && (
                  <div className="pl-6 pr-3 pb-2">
                    {!preview || preview.loading ? (
                      <div className="py-2 pl-2">
                        <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : preview.error ? (
                      <div className="py-1.5 pl-2 text-[11px] text-white/35">
                        Couldn&apos;t load messages.
                      </div>
                    ) : preview.messages.length === 0 ? (
                      <div className="py-1.5 pl-2 text-[11px] text-white/35">No messages.</div>
                    ) : (
                      preview.messages.map((m) => (
                        <Link
                          key={m.id}
                          href={`/hub/email/${t.id}`}
                          onClick={() => {
                            markRead(t.id)
                            onClose?.()
                          }}
                          className="block py-1.5 pl-2 pr-1 border-l border-white/10 hover:bg-white/5 rounded-r"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-white/70 truncate">
                              {m.direction === 'outbound'
                                ? 'You'
                                : participantName(m.from_name, m.from_email)}
                            </span>
                            <span className="text-[10px] text-white/35 flex-none">
                              {relativeTime(m.message_date)}
                            </span>
                          </div>
                          <div className="text-[10px] text-white/40 truncate">
                            {m.snippet || ''}
                          </div>
                        </Link>
                      ))
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {rulesOpen && <RulesPanel open onClose={() => setRulesOpen(false)} />}
      {foldersOpen && (
        <FoldersPanel
          open
          account={account === 'personal' ? 'personal' : 'shared'}
          onClose={() => setFoldersOpen(false)}
          onChanged={loadFolders}
        />
      )}
      {tagsOpen && <TagsPanel open onClose={() => setTagsOpen(false)} />}
      {templatesOpen && <TemplatesPanel open onClose={() => setTemplatesOpen(false)} />}
    </aside>
  )
}
