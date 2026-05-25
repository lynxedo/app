'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SidebarHeader } from './SidebarShell'
import ContactModal from '@/components/hub/txt/ContactModal'
import TxtGroupComposer from '@/components/hub/txt/TxtGroupComposer'
import TxtBroadcastComposer from '@/components/hub/txt/TxtBroadcastComposer'

type Conversation = {
  id: string
  kind?: 'direct' | 'group'
  status: 'unassigned' | 'assigned' | 'archived'
  assigned_to: string | null
  last_message_at: string | null
  last_inbound_at: string | null
  created_at: string
  contact: { id: string; name: string; phone: string; do_not_text: boolean } | null
  assignee: { id: string; display_name: string } | null
  group_contacts?: Array<{ contact: { id: string; name: string; phone: string } | { id: string; name: string; phone: string }[] | null }>
}

type Scope = 'unassigned' | 'mine' | 'all' | 'archived'

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return phone
}

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

export default function TxtV2Sidebar({
  onClose,
  onDesktopCollapse,
  canAssign,
  currentUserId,
}: {
  onClose?: () => void
  onDesktopCollapse?: () => void
  canAssign: boolean
  currentUserId: string
}) {
  const pathname = usePathname() || ''
  const [scope, setScope] = useState<Scope>(canAssign ? 'unassigned' : 'mine')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [addContactOpen, setAddContactOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const [broadcastOpen, setBroadcastOpen] = useState(false)
  const [claimingId, setClaimingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/txt/conversations?scope=${scope}&limit=100`)
    if (res.ok) {
      const data = await res.json()
      setConversations(data.conversations || [])
    }
    setLoading(false)
  }, [scope])

  useEffect(() => {
    load()
  }, [load])

  // Reload on incoming broadcasts (new inbound, status change, assignment)
  useEffect(() => {
    let cancelled = false
    const t = setInterval(() => {
      if (!cancelled) load()
    }, 15000) // fallback poll every 15s — realtime channel added later
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [load])

  const filtered = search
    ? conversations.filter(
        (c) =>
          c.contact?.name?.toLowerCase().includes(search.toLowerCase()) ||
          c.contact?.phone?.toLowerCase().includes(search.toLowerCase())
      )
    : conversations

  async function claim(id: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (claimingId) return
    setClaimingId(id)
    try {
      const res = await fetch(`/api/txt/conversations/${id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigned_to: currentUserId }),
      })
      if (res.ok) {
        await load()
      }
    } finally {
      setClaimingId(null)
    }
  }

  const tabs: { id: Scope; label: string; show: boolean }[] = [
    { id: 'unassigned', label: 'Queue', show: canAssign },
    { id: 'mine', label: 'Mine', show: true },
    { id: 'all', label: 'All', show: canAssign },
    { id: 'archived', label: 'Archived', show: true },
  ]

  return (
    <aside
      className="h-full w-72 bg-[#0F2E47] text-white flex flex-col flex-none border-r border-white/5 min-h-0"
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
          className="w-full px-3 py-2 rounded-md bg-white/5 hover:bg-white/10 text-sm font-medium border border-white/10"
        >
          + Add contact
        </button>
        {canAssign && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setGroupOpen(true)}
              className="px-2 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-xs font-medium border border-white/10"
              title="New group conversation"
            >
              + Group
            </button>
            <button
              type="button"
              onClick={() => setBroadcastOpen(true)}
              className="px-2 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-xs font-medium border border-white/10"
              title="Send 1-to-many broadcast"
            >
              📣 Broadcast
            </button>
          </div>
        )}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or phone…"
          className="w-full px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
        />
        <div className="flex gap-1 text-xs">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <button
                key={t.id}
                onClick={() => setScope(t.id)}
                className={`flex-1 px-2 py-1 rounded-md transition ${
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

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && conversations.length === 0 && (
          <div className="px-4 py-6 text-sm text-white/40">Loading…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="px-4 py-6 text-sm text-white/40">
            {scope === 'unassigned'
              ? 'Queue is empty.'
              : scope === 'mine'
              ? 'Nothing assigned to you yet.'
              : 'No conversations.'}
          </div>
        )}
        <ul>
          {filtered.map((c) => {
            const active = pathname === `/hub/txt/${c.id}`
            const isUnassigned = c.status === 'unassigned'
            const isGroup = c.kind === 'group'
            const groupNames = isGroup
              ? (c.group_contacts ?? [])
                  .map((gc) => {
                    const inner = Array.isArray(gc.contact) ? gc.contact[0] : gc.contact
                    return inner?.name || null
                  })
                  .filter(Boolean)
              : []
            const displayName = isGroup
              ? groupNames.length > 0
                ? `👥 ${groupNames.slice(0, 2).join(', ')}${
                    groupNames.length > 2 ? ` +${groupNames.length - 2}` : ''
                  }`
                : '👥 Group'
              : c.contact?.name || 'Unknown'
            const subline = isGroup
              ? `${groupNames.length} people`
              : c.contact?.phone
              ? formatPhone(c.contact.phone)
              : ''
            return (
              <li key={c.id}>
                <Link
                  href={`/hub/txt/${c.id}`}
                  onClick={onClose}
                  className={`block px-4 py-2 border-l-2 ${
                    active
                      ? 'bg-white/5 border-emerald-400'
                      : 'border-transparent hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">
                      {displayName}
                    </span>
                    <span className="text-[10px] text-white/40 flex-none">
                      {formatRelative(c.last_message_at || c.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-[11px] text-white/40 truncate">
                      {subline}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] flex-none">
                      {isUnassigned && (
                        <>
                          <span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300">
                            new
                          </span>
                          <button
                            type="button"
                            onClick={(e) => claim(c.id, e)}
                            disabled={claimingId === c.id}
                            className="px-1.5 py-0.5 rounded bg-emerald-600/80 hover:bg-emerald-600 text-white text-[10px] font-medium disabled:opacity-50"
                            title="Assign this to me"
                          >
                            {claimingId === c.id ? '…' : 'Claim'}
                          </button>
                        </>
                      )}
                      {c.status === 'assigned' && c.assignee && (
                        <span className="text-emerald-300">
                          {c.assignee.id === currentUserId
                            ? 'you'
                            : c.assignee.display_name.split(' ')[0]}
                        </span>
                      )}
                    </span>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="px-3 py-2 border-t border-white/5 flex items-center justify-between">
        {canAssign ? (
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
        <span className="text-[10px] text-white/30">Staging</span>
      </div>

      {newOpen && (
        <NewConversationModal onClose={() => setNewOpen(false)} onCreated={load} />
      )}

      {addContactOpen && (
        <ContactModal
          mode="create"
          onClose={() => setAddContactOpen(false)}
          onCreated={(conversationId) => {
            setAddContactOpen(false)
            load()
            window.location.href = `/hub/txt/${conversationId}`
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
  const [results, setResults] = useState<Array<{ id: string; name: string; phone?: string; email?: string }>>([])
  const [searching, setSearching] = useState(false)
  const [manualPhone, setManualPhone] = useState('')
  const [error, setError] = useState('')

  async function search() {
    if (!query.trim()) return
    setSearching(true)
    setError('')
    const res = await fetch(`/api/txt/contacts/search?q=${encodeURIComponent(query)}`)
    setSearching(false)
    if (res.ok) {
      const data = await res.json()
      setResults(data.results || [])
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Search failed')
    }
  }

  async function start(opts: { phone: string; name?: string; jobber_client_id?: string; email?: string }) {
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
      <div className="bg-[#0F2E47] border border-white/10 rounded-lg w-full max-w-md max-h-[80vh] flex flex-col">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-medium">New conversation</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white">×</button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div>
            <label className="text-xs text-white/50 block mb-1">Search Jobber</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') search() }}
                placeholder="Name…"
                className="flex-1 px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
              />
              <button onClick={search} disabled={searching} className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-sm disabled:opacity-50">
                {searching ? '…' : 'Find'}
              </button>
            </div>
          </div>
          {results.length > 0 && (
            <ul className="space-y-1 max-h-56 overflow-y-auto">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => start({ phone: r.phone || '', name: r.name, jobber_client_id: r.id, email: r.email })}
                    disabled={!r.phone}
                    className="w-full text-left px-3 py-2 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-40"
                  >
                    <div className="text-sm font-medium">{r.name}</div>
                    <div className="text-[11px] text-white/50">{r.phone || 'no phone'}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="pt-2 border-t border-white/10">
            <label className="text-xs text-white/50 block mb-1">Or by phone number</label>
            <div className="flex gap-2">
              <input
                type="tel"
                value={manualPhone}
                onChange={(e) => setManualPhone(e.target.value)}
                placeholder="(281) 555-1234"
                className="flex-1 px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-sm placeholder-white/30"
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
