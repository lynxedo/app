'use client'

import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/ui'

type HubUser = { id: string; display_name: string; is_bot?: boolean }

/**
 * Assign dropdown for an email thread. Lists non-bot hub teammates and calls
 * POST /api/hub/email/threads/{id}/assign { user_id }. Includes an "Unassign"
 * option when the thread currently has an owner. Positioned absolutely by the
 * caller (wrap in a `relative` container). Mirrors the Txt assignment menu.
 */
export default function AssignMenu({
  threadId,
  currentAssigneeId,
  onAssigned,
  onClose,
}: {
  threadId: string
  currentAssigneeId: string | null
  onAssigned: () => void
  onClose: () => void
}) {
  const [users, setUsers] = useState<HubUser[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
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

  // Close on outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  async function assign(userId: string | null) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/hub/email/threads/${threadId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })
      if (res.ok) {
        onAssigned()
        onClose()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      ref={ref}
      className="absolute right-0 mt-1 w-56 bg-[var(--t-panel)] border border-white/10 rounded-md shadow-lg z-40 max-h-80 overflow-y-auto"
    >
      {loading ? (
        <div className="py-6 text-center"><Spinner size={5} /></div>
      ) : (
        <>
          {users.length === 0 && (
            <div className="px-3 py-2 text-xs text-white/40">No teammates</div>
          )}
          {users.map((u) => (
            <button
              key={u.id}
              type="button"
              disabled={busy}
              onClick={() => assign(u.id)}
              className={`block w-full text-left px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-50 ${
                u.id === currentAssigneeId ? 'text-[var(--t-tint-success)]' : ''
              }`}
            >
              {u.display_name}
              {u.id === currentAssigneeId && <span className="text-[10px] text-white/40"> · current</span>}
            </button>
          ))}
          {currentAssigneeId && (
            <button
              type="button"
              disabled={busy}
              onClick={() => assign(null)}
              className="block w-full text-left px-3 py-2 text-sm text-[var(--t-tint-orange)] hover:bg-white/5 border-t border-white/10 disabled:opacity-50"
            >
              Unassign
            </button>
          )}
        </>
      )}
    </div>
  )
}
