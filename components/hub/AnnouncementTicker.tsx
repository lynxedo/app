'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Reaction = { announcement_id: string; user_id: string; emoji: string }

type AnnType = 'announcement' | 'shout_out'

export type Announcement = {
  id: string
  content: string
  expires_at: string
  type: AnnType
  archived_at: string | null
  created_by: string
  reactions: Reaction[]
}

// Both tickers share one CSS marquee keyframe (translateX 0 → -50% over a fixed
// duration), so the linear scroll speed scales with text length — a long shout-out
// scrolls faster than a short announcement. We instead drive a CONSTANT speed
// (px/second) by computing the animation duration from the rendered width, so every
// ticker scrolls at the same calm pace regardless of message length. Bump this to
// speed every ticker up, lower it to slow them all down.
const MARQUEE_SPEED_PX_PER_SEC = 30

const STYLE: Record<AnnType, { icon: string; bg: string; border: string; text: string; ariaLabel: string }> = {
  announcement: {
    icon: '📢',
    bg: 'bg-[var(--t-panel)]',
    border: 'border-white/10',
    text: 'text-white/80',
    ariaLabel: 'Company announcement',
  },
  shout_out: {
    icon: '🎉',
    bg: 'bg-amber-500/10',
    border: 'border-amber-400/30',
    // theme-aware: light cream on dark themes, dark amber on light themes
    // (--t-shout-text in globals.css) so it stays readable everywhere
    text: 'text-[var(--t-shout-text)]',
    ariaLabel: 'Shout out',
  },
}

function TickerBar({
  announcement,
  canEdit,
  onEdit,
  onDismiss,
}: {
  announcement: Announcement
  canEdit: boolean
  onEdit: () => void
  onDismiss: () => void
}) {
  const style = STYLE[announcement.type]

  // Constant-speed marquee: measure the rendered width and set the animation
  // duration so the scroll speed (px/sec) is identical across every ticker.
  const marqueeRef = useRef<HTMLDivElement>(null)
  const [marqueeDuration, setMarqueeDuration] = useState<number | null>(null)
  useEffect(() => {
    const el = marqueeRef.current
    if (!el) return
    // Content is duplicated, so the keyframe's -50% translate moves exactly one
    // copy's width — that half is the real distance travelled per loop.
    const travel = el.scrollWidth / 2
    if (travel > 0) setMarqueeDuration(travel / MARQUEE_SPEED_PX_PER_SEC)
  }, [announcement.content])

  return (
    <div
      className={`flex-none flex items-center gap-3 px-4 h-8 ${style.bg} border-b ${style.border} relative`}
      aria-label={style.ariaLabel}
    >
      <span className="flex-none text-sm">{style.icon}</span>

      <div className="flex-1 overflow-hidden relative">
        <div
          ref={marqueeRef}
          className={`whitespace-nowrap animate-marquee text-sm ${style.text} inline-block`}
          style={marqueeDuration ? { animationDuration: `${marqueeDuration}s` } : undefined}
        >
          {announcement.content}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
          {announcement.content}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
        </div>
      </div>

      {canEdit && (
        <button
          onClick={onEdit}
          className="flex-none text-white/30 hover:text-white/70 transition-colors text-xs leading-none px-1"
          title="Edit"
          aria-label="Edit"
        >
          ✎
        </button>
      )}

      <button
        onClick={onDismiss}
        className="flex-none text-white/30 hover:text-white/70 transition-colors text-xs leading-none"
        title="Dismiss"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}

function EditModal({
  announcement,
  onClose,
  onSaved,
}: {
  announcement: Announcement
  onClose: () => void
  onSaved: (next: Announcement) => void
}) {
  const [content, setContent] = useState(announcement.content)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const label = announcement.type === 'shout_out' ? 'Shout Out' : 'Announcement'

  async function save() {
    if (!content.trim() || saving) return
    setSaving(true)
    setError('')
    const res = await fetch(`/api/hub/announcements/${announcement.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.trim() }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) { setError(data.error ?? 'Failed to save'); return }
    onSaved({ ...announcement, ...data })
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-lg w-full">
        <h3 className="text-white font-semibold mb-1">Edit {label}</h3>
        <p className="text-xs text-gray-500 mb-4">
          Expiration stays the same. Posting time and reactions are preserved.
        </p>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={4}
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-brand resize-none mb-4"
        />
        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-gray-300 hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!content.trim() || saving}
            className="px-5 py-2 rounded-xl bg-brand hover:bg-brand-hover disabled:opacity-40 text-sm text-[#fff] font-medium transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AnnouncementTicker({
  currentUserId,
  isAdmin,
  initialActive,
}: {
  currentUserId: string
  isAdmin?: boolean
  initialActive?: Announcement[]
}) {
  const [active, setActive] = useState<Announcement[]>(initialActive ?? [])
  const [dismissed, setDismissed] = useState<Record<string, boolean>>(() => {
    const next: Record<string, boolean> = {}
    for (const a of initialActive ?? []) {
      try { next[a.id] = localStorage.getItem(`dismissed_announcement_${a.id}`) === '1' } catch {}
    }
    return next
  })
  const [editing, setEditing] = useState<Announcement | null>(null)

  // Sync dismissed-state from localStorage whenever the active set changes
  useEffect(() => {
    const next: Record<string, boolean> = {}
    for (const a of active) {
      next[a.id] = localStorage.getItem(`dismissed_announcement_${a.id}`) === '1'
    }
    setDismissed(next)
  }, [active.map(a => a.id).join(',')])

  // Refresh from API on mount
  useEffect(() => {
    fetch('/api/hub/announcements')
      .then(r => r.json())
      .then((d: { active?: Announcement[] }) => {
        setActive(d.active ?? [])
      })
      .catch(() => {})
  }, [])

  // Realtime: refetch on any change to hub_announcements
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('hub_announcements_ticker')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hub_announcements' },
        () => {
          fetch('/api/hub/announcements')
            .then(r => r.json())
            .then((d: { active?: Announcement[] }) => {
              setActive(d.active ?? [])
            })
            .catch(() => {})
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  function dismiss(id: string) {
    localStorage.setItem(`dismissed_announcement_${id}`, '1')
    setDismissed(prev => ({ ...prev, [id]: true }))
  }

  const visible = active.filter(a => {
    if (dismissed[a.id]) return false
    if (a.archived_at) return false
    if (new Date(a.expires_at) <= new Date()) return false
    return true
  })

  if (visible.length === 0 && !editing) return null

  return (
    <>
      {visible.map(a => (
        <TickerBar
          key={a.id}
          announcement={a}
          canEdit={!!isAdmin || a.created_by === currentUserId}
          onEdit={() => setEditing(a)}
          onDismiss={() => dismiss(a.id)}
        />
      ))}
      {editing && (
        <EditModal
          announcement={editing}
          onClose={() => setEditing(null)}
          onSaved={next => {
            setActive(prev => prev.map(a => a.id === next.id ? next : a))
            setEditing(null)
          }}
        />
      )}
    </>
  )
}
