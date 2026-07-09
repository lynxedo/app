'use client'

// Trimmed, self-contained Hub DM / room thread for the pop-out window.
//
// Covers both internal chat surfaces — a DM (conversation_id) and a room /
// channel (room_id) — since they share the `messages` table and APIs. Like the
// txt pop-out, it drops the heavy in-page features (threads/replies, reactions,
// file upload, deep-link scrolling, read-by indicators) and keeps the core loop:
// read the thread, watch it live, send a reply.
//
//   - initial + pagination-free load: browser Supabase select (RLS-scoped)
//   - live updates:  Supabase `feed:{id}` postgres_changes INSERT/UPDATE + the
//                    `message-inserted` broadcast backstop (mirrors MessageFeed)
//   - send:          POST /api/hub/messages   (text only here)
//   - read state:    POST /api/hub/read-receipts on load + inbound, so unread
//                    clears even when the user only uses the pop-out
//
// Top-level messages only (parent_id IS NULL) — replies live in the in-page
// thread panel, which isn't part of the trimmed view.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { renderContent } from '../renderContent'

// Never let one message's formatting blow up the whole list — fall back to the
// raw text if renderContent throws on some unexpected input.
function safeRenderContent(content: string | null | undefined): ReactNode {
  try {
    return renderContent(content ?? '', [])
  } catch {
    return content ?? ''
  }
}

type Sender = { id: string; display_name: string; avatar_url: string | null; is_bot?: boolean }

type DmMessage = {
  id: string
  content: string
  created_at: string
  parent_id: string | null
  room_id: string | null
  conversation_id: string | null
  sender: Sender | Sender[] | null
}

const SELECT =
  'id, content, created_at, parent_id, room_id, conversation_id, sender:hub_users!sender_id (id, display_name, avatar_url, is_bot)'

function normSender(raw: DmMessage['sender']): Sender | null {
  if (!raw) return null
  return Array.isArray(raw) ? raw[0] ?? null : raw
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return sameDay ? time : `${d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })} ${time}`
}

export default function PopoutDmConversation({
  roomId,
  conversationId,
  currentUserId,
}: {
  roomId?: string
  conversationId?: string
  currentUserId: string
}) {
  const [messages, setMessages] = useState<DmMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)

  const key = roomId ?? conversationId ?? ''
  const readBody = roomId ? { room_id: roomId } : { conversation_id: conversationId }

  const markRead = useCallback(() => {
    fetch('/api/hub/read-receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(readBody),
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Refetch the recent window — used by the reconcile poll below.
  const refresh = useCallback(() => {
    const supabase = createClient()
    const col = roomId ? 'room_id' : 'conversation_id'
    return supabase
      .from('messages')
      .select(SELECT)
      .eq(col, key)
      .is('parent_id', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(100)
      .then(({ data }) => {
        if (data) setMessages(data as unknown as DmMessage[])
      })
  }, [key, roomId])

  // Initial load — RLS restricts to threads the user can see, so a stray
  // roomId/conversationId simply returns nothing rather than leaking. `loading`
  // starts true and the host remounts per thread, so no re-set is needed here.
  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    const col = roomId ? 'room_id' : 'conversation_id'
    supabase
      .from('messages')
      .select(SELECT)
      .eq(col, key)
      .is('parent_id', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(100)
      .then(({ data }) => {
        if (cancelled) return
        setMessages((data ?? []) as unknown as DmMessage[])
        setLoading(false)
        markRead()
      })
    return () => { cancelled = true }
  }, [key, roomId, markRead])

  // Realtime + reconcile poll.
  //
  // CRITICAL: the channel topic must be pop-out-PRIVATE (`feed:popout:{key}`),
  // NOT MessageFeed's `feed:{key}`. The browser Supabase client is a singleton,
  // so `.channel('feed:{key}')` returns the main page's ALREADY-subscribed
  // channel, and adding postgres_changes bindings to a subscribed channel throws
  // ("cannot add postgres_changes callbacks after subscribe()") — which is what
  // white-screened the pop-out. A distinct topic gets us our own channel;
  // postgres_changes is delivered by the binding's table/filter, not the topic
  // name, so events still arrive. Our removeChannel() then only tears down OUR
  // channel and never disturbs MessageFeed's.
  //
  // We can't reuse the `feed:{key}` `message-inserted` broadcast backstop here
  // (same-topic collision), and postgres_changes silently drops admin-client
  // inserts (bot / Guardian / scheduled / Chat Synx messages). A slow reconcile
  // poll fills that gap and also catches any edit/delete we missed.
  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    const filter = roomId ? `room_id=eq.${roomId}` : `conversation_id=eq.${conversationId}`

    async function ingest(msgId: string, parentId: string | null | undefined, senderId?: string | null) {
      if (parentId) return // replies belong to the in-page thread panel
      if (senderId && senderId !== currentUserId) markRead()
      const { data } = await supabase.from('messages').select(SELECT).eq('id', msgId).single()
      if (!data || cancelled) return
      const msg = data as unknown as DmMessage
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === msg.id)
        if (idx >= 0) { const next = [...prev]; next[idx] = msg; return next }
        return [...prev, msg]
      })
    }

    const channel = supabase
      .channel(`feed:popout:${key}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter }, (payload) => {
        const n = payload.new as { id: string; parent_id: string | null; sender_id: string | null }
        ingest(n.id, n.parent_id, n.sender_id)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter }, (payload) => {
        const u = payload.new as { id: string; content: string; deleted_at: string | null }
        if (u.deleted_at) {
          setMessages((prev) => prev.filter((m) => m.id !== u.id))
        } else {
          setMessages((prev) => prev.map((m) => (m.id === u.id ? { ...m, content: u.content } : m)))
        }
      })
      .subscribe()

    const poll = setInterval(() => { if (!cancelled) void refresh() }, 15000)

    return () => {
      cancelled = true
      clearInterval(poll)
      supabase.removeChannel(channel)
    }
  }, [key, roomId, conversationId, currentUserId, markRead, refresh])

  useEffect(() => {
    const el = scrollRef.current
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages])

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  async function send() {
    const content = text.trim()
    if (!content || sending) return
    setSending(true)
    setError('')
    setText('')
    atBottomRef.current = true
    try {
      const res = await fetch('/api/hub/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...readBody, content }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d?.error || 'Send failed')
        setText(content) // restore so the user doesn't lose their draft
      }
      // On success the realtime INSERT (or broadcast) appends the stored row.
    } catch {
      setError('Send failed')
      setText(content)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {loading && messages.length === 0 ? (
          <div className="pt-8 text-center text-sm text-white/40">Loading…</div>
        ) : messages.length === 0 ? (
          <div className="pt-8 text-center text-sm text-white/40">No messages yet.</div>
        ) : (
          messages.map((m) => {
            const sender = normSender(m.sender)
            const mine = sender?.id === currentUserId
            return (
              <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                {!mine && sender && (
                  <div className="mb-0.5 px-1 text-[11px] font-medium text-white/50">{sender.display_name}</div>
                )}
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    mine ? 'bg-indigo-600 text-white' : 'bg-white/10 text-white'
                  }`}
                >
                  <div className="whitespace-pre-wrap break-words">{safeRenderContent(m.content)}</div>
                </div>
                <div className="mt-0.5 px-1 text-[10px] text-white/40">{formatTime(m.created_at)}</div>
              </div>
            )
          })
        )}
      </div>

      <div className="flex-none border-t border-white/10 p-2">
        {error && <div className="px-1 pb-1 text-xs text-red-300">{error}</div>}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            }}
            rows={1}
            placeholder="Message…"
            className="max-h-28 min-h-[38px] flex-1 resize-none rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={send}
            disabled={!text.trim() || sending}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-indigo-600 text-white transition-colors hover:bg-indigo-500 disabled:opacity-40"
            aria-label="Send"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
