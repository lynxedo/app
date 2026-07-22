'use client'

import { useState } from 'react'
import { useToast } from '@/components/ui'

type Board = { slug: string; title: string; badge?: string }
type User = { id: string; name: string }

export default function ScoreboardBoardAccessPanel({
  boards,
  users,
  initialAccess,
}: {
  boards: Board[]
  users: User[]
  initialAccess: Record<string, string[]>
}) {
  const [access, setAccess] = useState<Record<string, Set<string>>>(() => {
    const m: Record<string, Set<string>> = {}
    for (const u of users) m[u.id] = new Set(initialAccess[u.id] ?? [])
    return m
  })
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const toast = useToast()

  // Auto-save on toggle (no separate Save button).
  async function toggle(userId: string, slug: string) {
    const willGrant = !access[userId].has(slug)
    const key = `${userId}:${slug}`
    setSavingKey(key)
    const apply = (grant: boolean) =>
      setAccess(prev => {
        const s = new Set(prev[userId])
        if (grant) s.add(slug); else s.delete(slug)
        return { ...prev, [userId]: s }
      })
    apply(willGrant) // optimistic
    const res = await fetch('/api/admin/scoreboards/board-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, board_slug: slug, granted: willGrant }),
    })
    if (!res.ok) {
      apply(!willGrant) // revert
      const data = await res.json().catch(() => ({}))
      toast.error(data.error || 'Failed to save — try again')
    }
    setSavingKey(null)
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Who can see each board</h1>
        <p className="text-gray-500 text-sm mt-1">
          Pick which scoreboards each person can open. A user must first have <strong>Scoreboards</strong> turned on
          in Admin&nbsp;&rarr;&nbsp;People to appear here, then sees only the boards you turn on below — nothing until
          granted. Admins always see every board. Changes save automatically.
        </p>
      </div>

      {users.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-8 text-center text-sm text-gray-500">
          No users have Scoreboards access yet. Turn on <strong>Scoreboards</strong> for someone in
          Admin&nbsp;&rarr;&nbsp;People, then choose their boards here.
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl divide-y divide-gray-800">
          {users.map(u => (
            <div key={u.id} className="px-4 md:px-6 py-4 flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
              <div className="md:w-48 min-w-0 text-sm font-medium truncate">{u.name}</div>
              <div className="flex flex-wrap gap-2">
                {boards.map(b => {
                  const on = access[u.id]?.has(b.slug) ?? false
                  const key = `${u.id}:${b.slug}`
                  return (
                    <button
                      key={b.slug}
                      type="button"
                      aria-pressed={on}
                      disabled={savingKey === key}
                      onClick={() => toggle(u.id, b.slug)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
                        on
                          ? 'bg-sky-600 border-sky-500 text-[#fff]'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
                      } ${savingKey === key ? 'opacity-60' : ''}`}
                      title={on ? `Click to hide ${b.title}` : `Click to show ${b.title}`}
                    >
                      {b.title}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
