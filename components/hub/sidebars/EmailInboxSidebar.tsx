'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { SidebarHeader } from './SidebarShell'
import { createClient } from '@/lib/supabase/client'
import { Spinner, EmptyState } from '@/components/ui'
import RulesPanel from '@/components/hub/email/RulesPanel'
import {
  relativeTime,
  participantName,
  initials,
  firstName,
  type AccountType,
  type Scope,
  type InboxAccount,
  type EmailThread,
  type EmailMessage,
  type MailFolder,
} from '@/components/hub/email/emailFormat'

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

  // Accounts / access.
  const [accounts, setAccounts] = useState<InboxAccount[]>([])
  const [isFullAccess, setIsFullAccess] = useState(false)
  const [canCompose, setCanCompose] = useState(false)
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [account, setAccount] = useState<AccountType>('shared')

  // List state.
  const [threads, setThreads] = useState<EmailThread[]>([])
  const [loading, setLoading] = useState(false)
  const [scope, setScope] = useState<Scope>('mine')
  const [folder, setFolder] = useState('') // '' = Inbox / default
  const [folders, setFolders] = useState<MailFolder[]>([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

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
        const full = !!data.flags?.isFullAccess
        setAccounts(accts)
        setIsFullAccess(full)
        setCanCompose(!!data.flags?.canCompose)
        const sharedExists = accts.some((a) => a.account_type === 'shared')
        const personalExists = accts.some((a) => a.account_type === 'personal')
        const defaultAccount: AccountType =
          full && sharedExists ? 'shared' : personalExists ? 'personal' : 'shared'
        setAccount(defaultAccount)
        // Full-access managers land on their own queue; techs/personal on "mine".
        setScope(defaultAccount === 'shared' && full ? 'mine' : 'mine')
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

  // Reset scope when the account changes (personal + shared-tech only have one).
  useEffect(() => {
    if (account === 'personal') setScope('mine')
    else if (account === 'shared' && !isFullAccess) setScope('mine')
  }, [account, isFullAccess])

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

  const load = useCallback(async () => {
    if (!accountsLoaded) return
    setLoading(true)
    const params = new URLSearchParams({ scope, account, limit: '100' })
    if (folder) params.set('folder', folder)
    if (debouncedSearch) params.set('search', debouncedSearch)
    try {
      const res = await fetch(`/api/hub/email/threads?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setThreads(data.threads || [])
      }
    } finally {
      setLoading(false)
    }
  }, [scope, account, folder, debouncedSearch, accountsLoaded])

  useEffect(() => {
    load()
  }, [load])

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

  // Which scope tabs to show for the current account + access level.
  const tabs: { id: Scope; label: string }[] =
    account === 'shared' && isFullAccess
      ? [
          { id: 'mine', label: 'Mine' },
          { id: 'all', label: 'All' },
          { id: 'unassigned', label: 'Unassigned' },
          { id: 'needs_reply', label: 'Needs reply' },
          { id: 'closed', label: 'Closed' },
        ]
      : account === 'shared'
      ? [{ id: 'mine', label: 'Shared with me' }]
      : [{ id: 'mine', label: 'Inbox' }]

  const showAccountToggle = hasShared && hasPersonal
  // Non-Inbox folders are reference/filing views — the workflow tabs only make
  // sense on the live Inbox queue.
  const showTabs = folder === ''

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
          {isFullAccess && (
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
            className={`block w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/5 ${isFullAccess ? 'border-t border-white/10' : ''}`}
          >
            Inbox settings
          </button>
        </div>
      )}
    </div>
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

        {/* Folder dropdown — Inbox default; others are reference/filing views.
            System folders (Sent/Drafts/Deleted/Junk…) get an em-dash prefix. */}
        {folders.length > 0 && (
          <select
            value={folder}
            onChange={(e) => {
              const v = e.target.value
              setFolder(v)
              setExpandedId(null)
              // A filing folder shows everything in it; the Inbox queue returns
              // to the personal default.
              if (account === 'shared' && isFullAccess) setScope(v ? 'all' : 'mine')
            }}
            className="w-full px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs text-white/80"
          >
            <option value="">Inbox</option>
            {folders.map((f) => (
              <option key={f.id} value={f.provider_folder_id}>
                {isSystemFolder(f) ? '— ' : ''}
                {f.name}
                {f.unread_count > 0 ? ` (${f.unread_count})` : ''}
              </option>
            ))}
          </select>
        )}

        {/* Workflow tabs — Inbox only; wrap cleanly instead of overlapping at
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
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {(!accountsLoaded || (loading && threads.length === 0)) && (
          <div className="py-12 text-center">
            <Spinner size={6} />
          </div>
        )}

        {accountsLoaded && !loading && threads.length === 0 && (
          <EmptyState
            title={
              debouncedSearch
                ? 'No matching email.'
                : folder
                ? 'Nothing in this folder.'
                : scope === 'closed'
                ? 'No closed threads.'
                : scope === 'unassigned'
                ? 'Nothing waiting to be claimed.'
                : scope === 'needs_reply'
                ? 'Nothing needs a reply. 🎉'
                : account === 'personal'
                ? 'Your personal inbox is empty.'
                : 'No conversations.'
            }
          />
        )}

        <ul>
          {threads.map((t) => {
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
                          <span className="text-[10px] text-orange-300/80">open</span>
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
