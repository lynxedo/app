'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { SidebarHeader } from './SidebarShell'
import { createClient } from '@/lib/supabase/client'
import { Spinner, EmptyState, useToast } from '@/components/ui'
import RulesPanel from '@/components/hub/email/RulesPanel'
import {
  relativeTime,
  participantName,
  initials,
  firstName,
  type AccountType,
  type Scope,
  type Lens,
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

  // Gear menu + Rules.
  const [gearOpen, setGearOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const gearRef = useRef<HTMLDivElement>(null)

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
  useEffect(() => {
    if (!accountsLoaded) return
    let cancelled = false
    fetch(`/api/hub/email/folders?account=${encodeURIComponent(account)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (!cancelled) setFolders(data.folders || [])
      })
      .catch(() => {
        if (!cancelled) setFolders([])
      })
    setFolder('') // reset folder selection when switching accounts
    return () => {
      cancelled = true
    }
  }, [account, accountsLoaded])

  const isDraftsView = folder === DRAFTS_VIEW
  // Managers see the pinned unassigned Queue on the live Inbox view (not on Closed / Drafts / a folder view).
  const showQueue = isManager && account === 'shared' && folder === '' && scope !== 'closed'

  const load = useCallback(async () => {
    if (!accountsLoaded || isDraftsView) return
    setLoading(true)
    const params = new URLSearchParams({ scope, account, limit: '100' })
    if (folder) params.set('folder', folder)
    if (debouncedSearch) params.set('search', debouncedSearch)
    const reqs: Promise<Response>[] = [fetch(`/api/hub/email/threads?${params.toString()}`)]
    if (showQueue) {
      const qp = new URLSearchParams({ scope: 'unassigned', account, limit: '100' })
      if (debouncedSearch) qp.set('search', debouncedSearch)
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
  }, [scope, account, folder, debouncedSearch, accountsLoaded, showQueue, isDraftsView])

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
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
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
            return (
              <li
                key={t.id}
                className={`border-l-2 ${
                  active ? 'bg-white/5 border-emerald-400' : 'border-transparent'
                }`}
              >
                <div className={`flex items-stretch ${active ? '' : 'hover:bg-white/5'}`}>
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
    </aside>
  )
}
