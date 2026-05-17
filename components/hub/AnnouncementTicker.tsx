'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Reaction = { announcement_id: string; user_id: string; emoji: string }

type Announcement = {
  id: string
  content: string
  expires_at: string
  reactions: Reaction[]
}

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '🙌', '👀']

function groupReactions(reactions: Reaction[], currentUserId: string) {
  const counts: Record<string, { count: number; mine: boolean }> = {}
  for (const r of reactions) {
    if (!counts[r.emoji]) counts[r.emoji] = { count: 0, mine: false }
    counts[r.emoji].count++
    if (r.user_id === currentUserId) counts[r.emoji].mine = true
  }
  return counts
}

export default function AnnouncementTicker({
  currentUserId,
  initialAnnouncement,
}: {
  currentUserId: string
  initialAnnouncement?: Announcement | null
}) {
  const [announcement, setAnnouncement] = useState<Announcement | null>(initialAnnouncement ?? null)
  const [dismissed, setDismissed] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [reactions, setReactions] = useState<Reaction[]>(initialAnnouncement?.reactions ?? [])
  const pickerRef = useRef<HTMLDivElement>(null)

  // Check localStorage dismissal whenever the active announcement changes
  useEffect(() => {
    if (!announcement) return
    const key = `dismissed_announcement_${announcement.id}`
    setDismissed(localStorage.getItem(key) === '1')
  }, [announcement?.id])

  // Refresh from API on mount (picks up any changes since SSR)
  useEffect(() => {
    fetch('/api/hub/announcements')
      .then(r => r.json())
      .then(d => {
        if (d.announcement) {
          setAnnouncement(d.announcement)
          setReactions(d.announcement.reactions ?? [])
        } else {
          setAnnouncement(null)
        }
      })
      .catch(() => {})
  }, [])

  // Realtime subscription for new/deleted announcements
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('hub_announcements_ticker')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hub_announcements' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const ann = payload.new as Announcement
            setAnnouncement({ ...ann, reactions: [] })
            setReactions([])
            setDismissed(false)
          } else if (payload.eventType === 'DELETE') {
            setAnnouncement(null)
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // Close picker on outside click
  useEffect(() => {
    if (!showPicker) return
    function handler(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPicker])

  if (!announcement || dismissed) return null
  if (new Date(announcement.expires_at) <= new Date()) return null

  function dismiss() {
    if (!announcement) return
    localStorage.setItem(`dismissed_announcement_${announcement.id}`, '1')
    setDismissed(true)
  }

  async function toggleReaction(emoji: string) {
    if (!announcement) return
    setShowPicker(false)

    // Optimistic update
    const existing = reactions.find(r => r.user_id === currentUserId && r.emoji === emoji)
    if (existing) {
      setReactions(prev => prev.filter(r => !(r.user_id === currentUserId && r.emoji === emoji)))
    } else {
      setReactions(prev => [...prev, { announcement_id: announcement.id, user_id: currentUserId, emoji }])
    }

    await fetch(`/api/hub/announcements/${announcement.id}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    })
  }

  const grouped = groupReactions(reactions, currentUserId)
  const hasReactions = Object.keys(grouped).length > 0

  return (
    <div className="flex-none flex items-center gap-3 px-4 h-8 bg-[#0F2D45] border-b border-white/10 relative">
      {/* Megaphone icon */}
      <span className="flex-none text-sm">📢</span>

      {/* Scrolling marquee */}
      <div className="flex-1 overflow-hidden relative">
        <div className="whitespace-nowrap animate-marquee text-sm text-white/80 inline-block">
          {announcement.content}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
          {announcement.content}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
        </div>
      </div>

      {/* Reactions */}
      <div className="flex items-center gap-1 flex-none relative" ref={pickerRef}>
        {hasReactions && (
          <button
            onClick={() => setShowPicker(v => !v)}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-xs text-white/70"
          >
            {Object.entries(grouped).map(([emoji, { count, mine }]) => (
              <span key={emoji} className={mine ? 'text-white' : ''}>
                {emoji} {count}
              </span>
            ))}
          </button>
        )}

        {!hasReactions && (
          <button
            onClick={() => setShowPicker(v => !v)}
            className="text-white/30 hover:text-white/60 transition-colors text-xs px-1"
            title="Add reaction"
          >
            😊
          </button>
        )}

        {showPicker && (
          <div className="absolute bottom-full right-0 mb-1 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-2 flex gap-1 z-50">
            {REACTION_EMOJIS.map(emoji => {
              const mine = grouped[emoji]?.mine
              return (
                <button
                  key={emoji}
                  onClick={() => toggleReaction(emoji)}
                  className={`w-8 h-8 rounded-lg text-lg flex items-center justify-center transition-colors ${mine ? 'bg-[#2E7EB8]/30' : 'hover:bg-gray-700'}`}
                >
                  {emoji}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Dismiss */}
      <button
        onClick={dismiss}
        className="flex-none text-white/30 hover:text-white/70 transition-colors text-xs leading-none"
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
