'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Spinner } from '@/components/ui'

type HubUser = { id: string; display_name: string; is_bot?: boolean }

/**
 * Share dropdown for an email thread — grants a technician per-THREAD access
 * (PRD: techs see a thread iff assignee OR share-row OR authored it). Lists
 * non-bot teammates not already on the thread and calls
 * POST /api/hub/email/threads/{id}/share { user_id }. Positioned absolutely by
 * the caller (wrap in a `relative` container).
 */
export default function ShareMenu({
  threadId,
  existingMemberIds,
  onShared,
  onClose,
}: {
  threadId: string
  existingMemberIds: string[]
  onShared: () => void
  onClose: () => void
}) {
  const [users, setUsers] = useState<HubUser[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/hub/users')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        const list: HubUser[] = (data.users || []).filter((u: HubUser) => !u.is_bot)
        setUsers(list)
      })
      .catch(() => setUsers([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const candidates = useMemo(() => {
    const already = new Set(existingMemberIds)
    const q = query.trim().toLowerCase()
    return users
      .filter((u) => !already.has(u.id))
      .filter((u) => !q || u.display_name.toLowerCase().includes(q))
  }, [users, existingMemberIds, query])

  async function share(userId: string) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/hub/email/threads/${threadId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })
      if (res.ok) {
        onShared()
        onClose()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    // left-0 + z-50 for the same reason as AssignMenu — the main pane's
    // overflow-hidden clipped a right-aligned menu at the sidebar boundary.
    <div
      ref={ref}
      className="absolute left-0 top-full mt-1 w-60 bg-white border border-gray-200 rounded-md shadow-xl z-50 flex flex-col max-h-80"
    >
      <div className="px-3 py-2 border-b border-gray-100">
        <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">
          Share this thread with
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search teammates…"
          className="w-full px-2 py-1 rounded bg-white border border-gray-300 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-400"
          autoFocus
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="py-6 text-center"><Spinner size={5} /></div>
        ) : candidates.length === 0 ? (
          <div className="px-3 py-3 text-xs text-gray-400">
            {users.length === 0 ? 'No teammates' : 'Everyone already has access'}
          </div>
        ) : (
          candidates.map((u) => (
            <button
              key={u.id}
              type="button"
              disabled={busy}
              onClick={() => share(u.id)}
              className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {u.display_name}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
