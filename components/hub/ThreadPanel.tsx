'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { HubMessage, HubUser, Sender } from './MessageFeed'
import { useHubTextSize } from './HubTextSizeContext'

function normSender(raw: Sender | Sender[] | null): Sender | null {
  if (!raw) return null
  return Array.isArray(raw) ? (raw[0] ?? null) : raw
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function Avatar({ sender }: { sender: Sender | null }) {
  if (!sender) return <div className="w-7 h-7 rounded-full bg-gray-700 flex-none" />
  if (sender.avatar_url) return <img src={`/api/profile/avatar/${sender.id}`} alt="" className="w-7 h-7 rounded-full flex-none object-cover" />
  return (
    <div className={`w-7 h-7 rounded-full flex-none flex items-center justify-center text-xs font-bold text-white ${sender.is_bot ? 'bg-[#2E7EB8]' : 'bg-gray-600'}`}>
      {sender.display_name.slice(0, 2).toUpperCase()}
    </div>
  )
}

type Reply = {
  id: string
  content: string
  created_at: string
  edited_at: string | null
  sender: Sender | Sender[] | null
}

export default function ThreadPanel({
  parentMessage,
  currentUserId,
  hubUsers,
  onClose,
}: {
  parentMessage: HubMessage
  currentUserId: string
  hubUsers: HubUser[]
  onClose: () => void
}) {
  const textSize = useHubTextSize()
  const msgFontSize = textSize === 'small' ? '0.8125rem' : textSize === 'large' ? '1.25rem' : undefined

  const [replies, setReplies] = useState<Reply[]>([])
  const [replyContent, setReplyContent] = useState('')
  const [sending, setSending] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const supabase = createClient()

  useEffect(() => {
    supabase
      .from('messages')
      .select('id, content, created_at, edited_at, sender:hub_users!sender_id(id, display_name, avatar_url, is_bot)')
      .eq('parent_id', parentMessage.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setReplies((data ?? []) as unknown as Reply[])
      })
  }, [parentMessage.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [replies.length])

  useEffect(() => {
    const channel = supabase
      .channel(`thread:${parentMessage.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `parent_id=eq.${parentMessage.id}`,
      }, async (payload) => {
        const { data } = await supabase
          .from('messages')
          .select('id, content, created_at, edited_at, sender:hub_users!sender_id(id, display_name, avatar_url, is_bot)')
          .eq('id', payload.new.id)
          .single()
        if (data) setReplies(prev => {
          // Deduplicate: remove any temp optimistic entry, then add the real one if not already present
          const withoutTemp = prev.filter(r => !r.id.startsWith('temp-'))
          if (withoutTemp.some(r => r.id === (data as unknown as Reply).id)) return withoutTemp
          return [...withoutTemp, data as unknown as Reply]
        })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [parentMessage.id])

  async function sendReply() {
    const trimmed = replyContent.trim()
    if (!trimmed || sending) return
    setSending(true)
    setReplyContent('')

    const currentUser = hubUsers.find(u => u.id === currentUserId) ?? null
    const tempId = `temp-${Date.now()}`
    setReplies(prev => [...prev, {
      id: tempId,
      content: trimmed,
      created_at: new Date().toISOString(),
      edited_at: null,
      sender: currentUser,
    }])

    await fetch('/api/hub/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: parentMessage.room_id ?? null,
        conversation_id: parentMessage.conversation_id ?? null,
        parent_id: parentMessage.id,
        content: trimmed,
      }),
    })

    // Refetch all replies to replace the optimistic entry with the real one
    const { data: refreshed } = await supabase
      .from('messages')
      .select('id, content, created_at, edited_at, sender:hub_users!sender_id(id, display_name, avatar_url, is_bot)')
      .eq('parent_id', parentMessage.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
    if (refreshed) setReplies(refreshed as unknown as Reply[])

    setSending(false)
  }

  const parentSender = normSender(parentMessage.sender)

  return (
    <div className="w-full flex-1 border-l border-gray-800 flex flex-col bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-none">
        <span className="font-semibold text-sm text-white">Thread</span>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 transition-colors w-6 h-6 flex items-center justify-center rounded hover:bg-gray-800"
        >
          ✕
        </button>
      </div>

      {/* Parent message */}
      <div className="flex-none px-4 py-3 border-b border-gray-800 bg-gray-900/40">
        <div className="flex items-start gap-2">
          <Avatar sender={parentSender} />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 mb-0.5">
              <span className="font-semibold text-xs text-white">{parentSender?.display_name ?? 'Unknown'}</span>
              <span className="text-xs text-gray-600">{formatTime(parentMessage.created_at)}</span>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap break-words line-clamp-4">
              {parentMessage.content}
            </p>
          </div>
        </div>
        {replies.length > 0 && (
          <div className="mt-2 text-xs text-gray-500">{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</div>
        )}
      </div>

      {/* Replies */}
      <div className="flex-1 overflow-y-auto w-full px-4 py-3 space-y-3">
        {replies.length === 0 && (
          <p className="text-xs text-gray-600 text-center py-4">No replies yet — be the first!</p>
        )}
        {replies.map(reply => {
          const sender = normSender(reply.sender)
          return (
            <div key={reply.id} className="flex items-start gap-2">
              <Avatar sender={sender} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-0.5">
                  <span className="font-semibold text-xs text-white">{sender?.display_name ?? 'Unknown'}</span>
                  <span className="text-xs text-gray-600">{formatTime(reply.created_at)}</span>
                </div>
                <p className="hub-message-text text-sm text-gray-200 leading-relaxed whitespace-pre-wrap break-words" style={msgFontSize ? { fontSize: msgFontSize } : undefined}>
                  {reply.content}
                  {reply.edited_at && <span className="ml-1 text-xs text-gray-600">(edited)</span>}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Reply composer */}
      <div className="flex-none border-t border-gray-800 px-3 py-3">
        <div className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 focus-within:border-[#2E7EB8] transition-colors flex items-start gap-2">
          <textarea
            ref={textareaRef}
            value={replyContent}
            onChange={e => setReplyContent(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() }
            }}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Reply in thread…"
            rows={2}
            disabled={sending}
            className="flex-1 bg-transparent text-base md:text-sm text-white placeholder-gray-500 resize-none outline-none leading-relaxed"
          />
          {isFocused && (
            <button
              type="button"
              onClick={() => textareaRef.current?.blur()}
              className="md:hidden flex-none text-gray-400 hover:text-white transition-colors mt-0.5"
              aria-label="Hide keyboard"
              title="Hide keyboard"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}
        </div>
        <div className="flex justify-end mt-1.5">
          <button
            onClick={sendReply}
            disabled={!replyContent.trim() || sending}
            className="text-xs bg-[#2E7EB8] hover:bg-[#2470a8] disabled:opacity-30 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            Reply
          </button>
        </div>
      </div>
    </div>
  )
}
