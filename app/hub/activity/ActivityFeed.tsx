'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Spinner, EmptyState } from '@/components/ui'

type Sender = { id: string; display_name: string; avatar_url: string | null; is_bot: boolean }

type ActivityRow = {
  id: string
  content: string | null
  created_at: string
  parent_id: string | null
  room_id: string | null
  conversation_id: string | null
  sender: Sender | Sender[] | null
  kind: 'mention' | 'reply'
}

function relativeTime(iso: string) {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffMs = now - then
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

function senderOf(s: Sender | Sender[] | null): Sender | null {
  if (!s) return null
  return Array.isArray(s) ? (s[0] ?? null) : s
}

function linkFor(row: ActivityRow): string {
  if (row.room_id) {
    return row.parent_id ? `/hub/${row.room_id}?thread=${row.parent_id}` : `/hub/${row.room_id}`
  }
  if (row.conversation_id) {
    return row.parent_id ? `/hub/pm/${row.conversation_id}?thread=${row.parent_id}` : `/hub/pm/${row.conversation_id}`
  }
  return '/hub'
}

export default function ActivityFeed() {
  const [activity, setActivity] = useState<ActivityRow[]>([])
  const [lastSeen, setLastSeen] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/hub/activity')
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d.error) setError(d.error)
        else { setActivity(d.activity ?? []); setLastSeen(d.lastSeen ?? null) }
        setLoading(false)
      })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    // Mark seen on mount (fire-and-forget)
    fetch('/api/hub/activity', { method: 'POST' }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (loading) return <div className="py-12 text-center"><Spinner size={6} /></div>
  if (error) return <p className="text-sm text-rose-400">Error: {error}</p>
  if (activity.length === 0) {
    return <EmptyState icon={<span className="text-4xl">🎉</span>} title="Nothing new — you're all caught up." size="lg" />
  }

  return (
    <ul className="space-y-3">
      {activity.map(row => {
        const sender = senderOf(row.sender)
        const isUnread = lastSeen ? new Date(row.created_at) > new Date(lastSeen) : true
        const kindLabel = row.kind === 'mention' ? 'mentioned you' : 'replied to your thread'
        return (
          <li key={row.id}>
            <Link
              href={linkFor(row)}
              className={`block rounded-lg border p-3 transition-colors ${
                isUnread
                  ? 'bg-amber-500/5 border-amber-500/30 hover:bg-amber-500/10'
                  : 'bg-gray-900 border-gray-800 hover:bg-gray-800'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-[#fff] text-sm font-bold flex-none">
                  {(sender?.display_name ?? '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-sm font-medium text-white truncate">
                      {sender?.display_name ?? 'Someone'}
                      <span className="text-white/50 font-normal"> {kindLabel}</span>
                    </div>
                    <span className="text-xs text-gray-500 flex-none">{relativeTime(row.created_at)}</span>
                  </div>
                  <p className="text-sm text-gray-300 mt-1 line-clamp-3 whitespace-pre-wrap break-words">
                    {row.content ?? <span className="italic text-gray-500">(no text)</span>}
                  </p>
                </div>
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
