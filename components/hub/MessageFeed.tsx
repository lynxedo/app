'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type Sender = {
  id: string
  display_name: string
  avatar_url: string | null
  is_bot: boolean
}

type Message = {
  id: string
  content: string
  created_at: string
  edited_at: string | null
  sender: Sender | null
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatDate(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function Avatar({ sender }: { sender: Sender | null }) {
  if (!sender) return <div className="w-8 h-8 rounded-full bg-gray-700 flex-none" />
  if (sender.avatar_url) {
    return <img src={sender.avatar_url} alt="" className="w-8 h-8 rounded-full flex-none object-cover" />
  }
  const initials = sender.display_name.slice(0, 2).toUpperCase()
  const color = sender.is_bot ? 'bg-[#2E7EB8]' : 'bg-gray-600'
  return (
    <div className={`w-8 h-8 rounded-full ${color} flex-none flex items-center justify-center text-xs font-bold text-white`}>
      {initials}
    </div>
  )
}

export default function MessageFeed({
  roomId,
  initialMessages,
  currentUserId,
}: {
  roomId: string
  initialMessages: Message[]
  currentUserId: string
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `room_id=eq.${roomId}`,
        },
        async (payload) => {
          // Fetch the full message with sender info
          const { data } = await supabase
            .from('messages')
            .select(`
              id, content, created_at, edited_at,
              sender:hub_users!sender_id (id, display_name, avatar_url, is_bot)
            `)
            .eq('id', payload.new.id)
            .single()
          if (data) {
            setMessages(prev => [...prev, data as unknown as Message])
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const updated = payload.new as { id: string; content: string; edited_at: string; deleted_at: string | null }
          if (updated.deleted_at) {
            setMessages(prev => prev.filter(m => m.id !== updated.id))
          } else {
            setMessages(prev =>
              prev.map(m =>
                m.id === updated.id
                  ? { ...m, content: updated.content, edited_at: updated.edited_at }
                  : m
              )
            )
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [roomId])

  const startEdit = useCallback((msg: Message) => {
    setEditingId(msg.id)
    setEditContent(msg.content)
  }, [])

  const saveEdit = useCallback(async (msgId: string) => {
    const trimmed = editContent.trim()
    if (!trimmed) return
    await fetch(`/api/hub/messages/${msgId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: trimmed }),
    })
    setEditingId(null)
  }, [editContent])

  const deleteMessage = useCallback(async (msgId: string) => {
    if (!confirm('Delete this message?')) return
    await fetch(`/api/hub/messages/${msgId}`, { method: 'DELETE' })
  }, [])

  // Group messages by date
  const groups: { date: string; messages: Message[] }[] = []
  for (const msg of messages) {
    const date = formatDate(msg.created_at)
    const last = groups[groups.length - 1]
    if (last && last.date === date) {
      last.messages.push(msg)
    } else {
      groups.push({ date, messages: [msg] })
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
      {groups.map(group => (
        <div key={group.date}>
          {/* Date divider */}
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-gray-800" />
            <span className="text-xs text-gray-500 font-medium">{group.date}</span>
            <div className="flex-1 h-px bg-gray-800" />
          </div>

          {/* Messages */}
          {group.messages.map((msg, idx) => {
            const prevMsg = group.messages[idx - 1]
            const isContinuation =
              prevMsg &&
              prevMsg.sender?.id === msg.sender?.id &&
              new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() < 5 * 60 * 1000

            const isOwn = msg.sender?.id === currentUserId
            const isEditing = editingId === msg.id

            return (
              <div
                key={msg.id}
                className="group flex items-start gap-3 px-1 py-0.5 rounded hover:bg-gray-900/50 transition-colors"
              >
                {/* Avatar or spacer */}
                <div className="flex-none w-8 mt-0.5">
                  {!isContinuation ? (
                    <Avatar sender={msg.sender} />
                  ) : null}
                </div>

                <div className="flex-1 min-w-0">
                  {!isContinuation && (
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="font-semibold text-sm text-white">
                        {msg.sender?.display_name ?? 'Unknown'}
                        {msg.sender?.is_bot && (
                          <span className="ml-1.5 text-xs bg-[#2E7EB8]/30 text-[#2E7EB8] px-1.5 py-0.5 rounded font-normal">Bot</span>
                        )}
                      </span>
                      <span className="text-xs text-gray-500">{formatTime(msg.created_at)}</span>
                    </div>
                  )}

                  {isEditing ? (
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        value={editContent}
                        onChange={e => setEditContent(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(msg.id) }
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white outline-none focus:border-[#2E7EB8]"
                      />
                      <button onClick={() => saveEdit(msg.id)} className="text-xs text-[#2E7EB8] hover:text-blue-300 px-2">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 hover:text-gray-300 px-2">Cancel</button>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap break-words">
                      {msg.content}
                      {msg.edited_at && (
                        <span className="ml-1.5 text-xs text-gray-600">(edited)</span>
                      )}
                    </p>
                  )}
                </div>

                {/* Action buttons — appear on hover for own messages */}
                {isOwn && !isEditing && (
                  <div className="flex-none opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                    <button
                      onClick={() => startEdit(msg)}
                      className="text-xs text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-800"
                      title="Edit"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => deleteMessage(msg.id)}
                      className="text-xs text-gray-500 hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-gray-800"
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}

      <div ref={bottomRef} />
    </div>
  )
}
