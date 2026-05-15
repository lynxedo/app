'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import EmojiPicker from './EmojiPicker'

export type HubUser = { id: string; display_name: string; avatar_url: string | null; is_bot?: boolean }
export type RxItem = { user_id: string; emoji: string }
export type FileItem = { id: string; filename: string; mime_type: string; size_bytes: number; storage_path: string }
export type Sender = HubUser
export type HubMessage = {
  id: string
  content: string
  created_at: string
  edited_at: string | null
  parent_id: string | null
  room_id?: string | null
  conversation_id?: string | null
  sender: Sender | Sender[] | null
  reactions?: RxItem[]
  files?: FileItem[]
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function formatDate(iso: string) {
  const d = new Date(iso), today = new Date(), yest = new Date(today)
  yest.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}
function normSender(raw: Sender | Sender[] | null): Sender | null {
  if (!raw) return null
  return Array.isArray(raw) ? (raw[0] ?? null) : raw
}
function normReactions(raw: unknown): RxItem[] {
  if (!raw || !Array.isArray(raw)) return []
  return raw as RxItem[]
}
function normFiles(raw: unknown): FileItem[] {
  if (!raw || !Array.isArray(raw)) return []
  return raw as FileItem[]
}
function formatBytes(b: number) {
  return b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`
}

function Avatar({ sender }: { sender: Sender | null }) {
  if (!sender) return <div className="w-8 h-8 rounded-full bg-gray-700 flex-none" />
  if (sender.avatar_url) return <img src={sender.avatar_url} alt="" className="w-8 h-8 rounded-full flex-none object-cover" />
  const initials = sender.display_name.slice(0, 2).toUpperCase()
  return (
    <div className={`w-8 h-8 rounded-full flex-none flex items-center justify-center text-xs font-bold text-white ${sender.is_bot ? 'bg-[#2E7EB8]' : 'bg-gray-600'}`}>
      {initials}
    </div>
  )
}

function renderContent(content: string, hubUsers: HubUser[]) {
  const parts = content.split(/(@\w+)/g)
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      const name = part.slice(1).toLowerCase()
      const isUser = hubUsers.some(u => u.display_name.split(' ')[0].toLowerCase() === name)
      if (isUser) return <span key={i} className="bg-[#2E7EB8]/20 text-[#6FB3E8] rounded px-0.5">{part}</span>
    }
    return <span key={i}>{part}</span>
  })
}

function FileAttachment({ file }: { file: FileItem }) {
  const src = `/api/hub/files/${file.id}`
  const size = formatBytes(file.size_bytes)
  if (file.mime_type.startsWith('image/')) {
    return (
      <a href={src} target="_blank" rel="noopener">
        <img src={src} alt={file.filename} className="max-w-xs max-h-64 rounded-lg mt-1.5 border border-gray-700 hover:border-gray-500 transition-colors cursor-pointer object-cover" />
      </a>
    )
  }
  const icon = file.mime_type === 'application/pdf' ? '📄' : '📎'
  return (
    <a href={src} target="_blank" rel="noopener" className="flex items-center gap-2.5 bg-gray-800 border border-gray-700 hover:border-gray-600 rounded-lg px-3 py-2 mt-1.5 text-sm text-gray-300 max-w-xs transition-colors">
      <span className="text-xl">{icon}</span>
      <div className="min-w-0">
        <div className="truncate text-white text-xs font-medium">{file.filename}</div>
        <div className="text-xs text-gray-500">{size}</div>
      </div>
    </a>
  )
}

export default function MessageFeed({
  roomId,
  conversationId,
  initialMessages,
  currentUserId,
  hubUsers,
  onOpenThread,
  openThreadMsgId,
}: {
  roomId?: string
  conversationId?: string
  initialMessages: HubMessage[]
  currentUserId: string
  hubUsers: HubUser[]
  onOpenThread?: (msg: HubMessage) => void
  openThreadMsgId?: string | null
}) {
  const [messages, setMessages] = useState<HubMessage[]>(initialMessages)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [pickerMsgId, setPickerMsgId] = useState<string | null>(null)
  const [rxMap, setRxMap] = useState<Record<string, RxItem[]>>(() => {
    const map: Record<string, RxItem[]> = {}
    for (const m of initialMessages) map[m.id] = normReactions(m.reactions)
    return map
  })
  const bottomRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Realtime: messages
  useEffect(() => {
    const filter = roomId
      ? `room_id=eq.${roomId}`
      : `conversation_id=eq.${conversationId}`

    const channel = supabase
      .channel(`feed:${roomId ?? conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter }, async (payload) => {
        if (payload.new.parent_id) return // thread reply — handled by ThreadPanel
        const { data } = await supabase
          .from('messages')
          .select(`id, content, created_at, edited_at, parent_id, room_id, conversation_id,
            sender:hub_users!sender_id (id, display_name, avatar_url, is_bot),
            reactions (message_id, user_id, emoji),
            files (id, filename, mime_type, size_bytes, storage_path)`)
          .eq('id', payload.new.id)
          .single()
        if (data) {
          const msg = data as unknown as HubMessage
          setMessages(prev => [...prev, msg])
          setRxMap(prev => ({ ...prev, [msg.id]: normReactions(msg.reactions) }))
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter }, (payload) => {
        const u = payload.new as { id: string; content: string; edited_at: string; deleted_at: string | null }
        if (u.deleted_at) {
          setMessages(prev => prev.filter(m => m.id !== u.id))
        } else {
          setMessages(prev => prev.map(m => m.id === u.id ? { ...m, content: u.content, edited_at: u.edited_at } : m))
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [roomId, conversationId])

  // Realtime: reactions (no filter — filter client-side)
  useEffect(() => {
    const channel = supabase
      .channel(`reactions:${roomId ?? conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reactions' }, (payload) => {
        const r = payload.new as { message_id: string; user_id: string; emoji: string }
        setRxMap(prev => {
          if (!(r.message_id in prev)) return prev
          const existing = prev[r.message_id] ?? []
          if (existing.some(x => x.user_id === r.user_id && x.emoji === r.emoji)) return prev
          return { ...prev, [r.message_id]: [...existing, { user_id: r.user_id, emoji: r.emoji }] }
        })
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reactions' }, (payload) => {
        const r = payload.old as { message_id: string; user_id: string; emoji: string }
        setRxMap(prev => {
          if (!(r.message_id in prev)) return prev
          return { ...prev, [r.message_id]: (prev[r.message_id] ?? []).filter(x => !(x.user_id === r.user_id && x.emoji === r.emoji)) }
        })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [roomId, conversationId])

  const toggleReaction = useCallback(async (msgId: string, emoji: string) => {
    const current = rxMap[msgId] ?? []
    const mine = current.find(r => r.user_id === currentUserId && r.emoji === emoji)
    // Optimistic update
    setRxMap(prev => ({
      ...prev,
      [msgId]: mine
        ? (prev[msgId] ?? []).filter(r => !(r.user_id === currentUserId && r.emoji === emoji))
        : [...(prev[msgId] ?? []), { user_id: currentUserId, emoji }],
    }))
    await fetch('/api/hub/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: msgId, emoji }),
    })
  }, [rxMap, currentUserId])

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

  // Group by date
  const groups: { date: string; messages: HubMessage[] }[] = []
  for (const msg of messages) {
    const date = formatDate(msg.created_at)
    const last = groups[groups.length - 1]
    if (last && last.date === date) last.messages.push(msg)
    else groups.push({ date, messages: [msg] })
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
      {groups.map(group => (
        <div key={group.date}>
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-gray-800" />
            <span className="text-xs text-gray-500 font-medium">{group.date}</span>
            <div className="flex-1 h-px bg-gray-800" />
          </div>

          {group.messages.map((msg, idx) => {
            const sender = normSender(msg.sender)
            const prevMsg = group.messages[idx - 1]
            const prevSender = normSender(prevMsg?.sender ?? null)
            const isContinuation = prevMsg && prevSender?.id === sender?.id &&
              new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() < 5 * 60 * 1000
            const isOwn = sender?.id === currentUserId
            const isEditing = editingId === msg.id
            const isThreadOpen = openThreadMsgId === msg.id
            const reactions = rxMap[msg.id] ?? []
            const files = normFiles(msg.files)

            // Group reactions by emoji
            const rxGroups: Record<string, string[]> = {}
            for (const r of reactions) {
              if (!rxGroups[r.emoji]) rxGroups[r.emoji] = []
              rxGroups[r.emoji].push(r.user_id)
            }

            return (
              <div
                key={msg.id}
                className={`group flex items-start gap-3 px-1 py-0.5 rounded hover:bg-gray-900/50 transition-colors ${isThreadOpen ? 'bg-[#2E7EB8]/5 border-l-2 border-[#2E7EB8]' : ''}`}
              >
                <div className="flex-none w-8 mt-0.5">
                  {!isContinuation ? <Avatar sender={sender} /> : null}
                </div>

                <div className="flex-1 min-w-0">
                  {!isContinuation && (
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="font-semibold text-sm text-white">
                        {sender?.display_name ?? 'Unknown'}
                        {sender?.is_bot && (
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
                      {renderContent(msg.content, hubUsers)}
                      {msg.edited_at && <span className="ml-1.5 text-xs text-gray-600">(edited)</span>}
                    </p>
                  )}

                  {/* File attachments */}
                  {files.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-0.5">
                      {files.map(f => <FileAttachment key={f.id} file={f} />)}
                    </div>
                  )}

                  {/* Reactions */}
                  {Object.keys(rxGroups).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {Object.entries(rxGroups).map(([emoji, userIds]) => (
                        <button
                          key={emoji}
                          onClick={() => toggleReaction(msg.id, emoji)}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                            userIds.includes(currentUserId)
                              ? 'bg-[#2E7EB8]/20 border-[#2E7EB8]/50 text-[#2E7EB8]'
                              : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
                          }`}
                        >
                          <span>{emoji}</span>
                          <span>{userIds.length}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Hover actions */}
                {!isEditing && (
                  <div className="flex-none opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 relative">
                    {/* Emoji react */}
                    <div className="relative">
                      <button
                        onClick={() => setPickerMsgId(pickerMsgId === msg.id ? null : msg.id)}
                        className="text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-800 text-sm"
                        title="Add reaction"
                      >
                        😊
                      </button>
                      {pickerMsgId === msg.id && (
                        <EmojiPicker
                          onSelect={emoji => toggleReaction(msg.id, emoji)}
                          onClose={() => setPickerMsgId(null)}
                        />
                      )}
                    </div>

                    {/* Reply in thread */}
                    {onOpenThread && (
                      <button
                        onClick={() => onOpenThread(msg)}
                        className="text-xs text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-800"
                        title="Reply in thread"
                      >
                        💬
                      </button>
                    )}

                    {/* Edit / Delete (own messages) */}
                    {isOwn && (
                      <>
                        <button
                          onClick={() => { setEditingId(msg.id); setEditContent(msg.content) }}
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
                      </>
                    )}
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
