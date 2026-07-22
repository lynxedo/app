'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type ConversationListItem = {
  id: string
  is_unread: boolean
  last_at: string | null
  participants?: Array<{ user_id: string; display_name: string | null; is_bot: boolean }>
}

type ActivityRow = {
  id: string
  content: string | null
  created_at: string
  parent_id: string | null
  room_id: string | null
  conversation_id: string | null
  sender: { id: string; display_name: string; avatar_url: string | null; is_bot: boolean }
    | { id: string; display_name: string; avatar_url: string | null; is_bot: boolean }[] | null
  kind: 'mention' | 'reply'
}

type RoomItem = { id: string; name: string; is_unread: boolean; last_at: string | null }

function relativeTime(iso: string | null) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const diffMs = Date.now() - then
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

function senderOf<T extends { display_name: string }>(s: T | T[] | null): T | null {
  if (!s) return null
  return Array.isArray(s) ? (s[0] ?? null) : s
}

function activityHref(row: ActivityRow): string {
  if (row.room_id) {
    return row.parent_id ? `/hub/${row.room_id}?thread=${row.parent_id}` : `/hub/${row.room_id}`
  }
  if (row.conversation_id) {
    return row.parent_id ? `/hub/pm/${row.conversation_id}?thread=${row.parent_id}` : `/hub/pm/${row.conversation_id}`
  }
  return '/hub'
}

export default function LandingActivity({ currentUserId }: { currentUserId: string }) {
  const [unreadRooms, setUnreadRooms] = useState<RoomItem[]>([])
  const [unreadConvs, setUnreadConvs] = useState<ConversationListItem[]>([])
  const [activity, setActivity] = useState<ActivityRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/hub/conversations', { cache: 'no-store' }).then(r => r.ok ? r.json() : { conversations: [], rooms: [] }),
      fetch('/api/hub/activity', { cache: 'no-store' }).then(r => r.ok ? r.json() : { activity: [] }),
    ]).then(([conv, act]) => {
      if (cancelled) return
      const convs = (conv.conversations ?? []) as ConversationListItem[]
      const rooms = (conv.rooms ?? []) as RoomItem[]
      setUnreadConvs(convs.filter(c => c.is_unread).slice(0, 8))
      setUnreadRooms(rooms.filter(r => r.is_unread).slice(0, 8))
      // Limit landing-page activity to last 7d for relevance.
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
      const recent = ((act.activity ?? []) as ActivityRow[]).filter(a => new Date(a.created_at).getTime() >= sevenDaysAgo).slice(0, 8)
      setActivity(recent)
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  function convLabel(conv: ConversationListItem): string {
    if (!conv.participants) return 'Direct message'
    const others = conv.participants.filter(p => p.user_id !== currentUserId && !p.is_bot)
    if (others.length === 0) return 'You'
    if (others.length === 1) return others[0].display_name ?? 'Direct message'
    return others.map(o => o.display_name?.split(' ')[0] ?? '?').slice(0, 3).join(', ')
  }

  if (loading) {
    return <p className="text-sm text-gray-500">Loading your activity…</p>
  }

  const nothing = unreadRooms.length === 0 && unreadConvs.length === 0 && activity.length === 0

  return (
    <div className="space-y-6">
      {(unreadRooms.length > 0 || unreadConvs.length > 0) && (
        <section>
          <h2 className="text-xs font-semibold text-orange-300 uppercase tracking-wider mb-3">Unread</h2>
          <ul className="space-y-1">
            {unreadConvs.map(c => (
              <li key={c.id}>
                <Link href={`/hub/pm/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-orange-500/5 border border-orange-400/30 hover:bg-orange-500/10 transition-colors">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-orange-300">💬</span>
                    <span className="text-white truncate">{convLabel(c)}</span>
                  </span>
                  <span className="text-xs text-orange-300/70 flex-none">{relativeTime(c.last_at)}</span>
                </Link>
              </li>
            ))}
            {unreadRooms.map(r => (
              <li key={r.id}>
                <Link href={`/hub/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-orange-500/5 border border-orange-400/30 hover:bg-orange-500/10 transition-colors">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-orange-300">#</span>
                    <span className="text-white truncate">{r.name}</span>
                  </span>
                  <span className="text-xs text-orange-300/70 flex-none">{relativeTime(r.last_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {activity.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Recent activity</h2>
          <ul className="space-y-2">
            {activity.map(row => {
              const sender = senderOf(row.sender)
              const kindLabel = row.kind === 'mention' ? 'mentioned you' : 'replied to your thread'
              return (
                <li key={row.id}>
                  <Link href={activityHref(row)} className="block rounded-lg bg-gray-900 border border-gray-800 hover:bg-gray-800 transition-colors p-3">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-[#fff] text-xs font-bold flex-none">
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
                        <p className="text-sm text-gray-300 mt-1 line-clamp-2 whitespace-pre-wrap break-words">
                          {row.content ?? <span className="italic text-gray-500">(no text)</span>}
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {nothing && (
        <div className="text-center py-10 text-gray-500">
          <div className="text-3xl mb-2">☕</div>
          <p className="text-sm">Nothing new. Enjoy the quiet.</p>
        </div>
      )}
    </div>
  )
}
