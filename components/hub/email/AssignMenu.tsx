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
    // left-0 (not right-0): the trigger sits near the LEFT edge of the main pane,
    // and the Hub shell clips the pane with overflow-hidden — a right-aligned menu
    // extended past that edge and looked like it slid under the sidebar. z-50 keeps
    // it above the message stream + iframes. Light theme to match the email pane.
    <div
      ref={ref}
      className="absolute left-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-md shadow-xl z-50 max-h-80 overflow-y-auto"
    >
      {loading ? (
        <div className="py-6 text-center"><Spinner size={5} /></div>
      ) : (
        <>
          {users.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400">No teammates</div>
          )}
          {users.map((u) => (
            <button
              key={u.id}
              type="button"
              disabled={busy}
              onClick={() => assign(u.id)}
              className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50 ${
                u.id === currentAssigneeId ? 'text-emerald-600 font-medium' : 'text-gray-700'
              }`}
            >
              {u.display_name}
              {u.id === currentAssigneeId && <span className="text-[10px] text-gray-400"> · current</span>}
            </button>
          ))}
          {currentAssigneeId && (
            <button
              type="button"
              disabled={busy}
              onClick={() => assign(null)}
              className="block w-full text-left px-3 py-2 text-sm text-orange-600 hover:bg-gray-50 border-t border-gray-100 disabled:opacity-50"
            >
              Unassign
            </button>
          )}
        </>
      )}
    </div>
  )
}
