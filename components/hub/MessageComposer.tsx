'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { HubMessage, HubUser } from './MessageFeed'

type PendingFile = {
  storage_path: string
  filename: string
  mime_type: string
  size_bytes: number
  localUrl?: string
}

export default function MessageComposer({
  roomId,
  conversationId,
  currentUserId,
  hubUsers,
  placeholder,
  onSent,
}: {
  roomId?: string
  conversationId?: string
  currentUserId?: string
  hubUsers: HubUser[]
  placeholder?: string
  onSent?: (msg: HubMessage) => void
}) {
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStart, setMentionStart] = useState(-1)
  const [mentionIndex, setMentionIndex] = useState(0)

  // Scheduled send
  const [scheduledAt, setScheduledAt] = useState<string>('') // ISO datetime-local string
  const [showScheduler, setShowScheduler] = useState(false)
  const schedulerRef = useRef<HTMLDivElement>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const filteredUsers = mentionQuery !== null
    ? hubUsers.filter(u =>
        u.display_name.toLowerCase().includes(mentionQuery.toLowerCase())
      ).slice(0, 6)
    : []

  const mentionedDndUsers = hubUsers.filter(u => {
    if (u.status !== 'dnd') return false
    const firstName = u.display_name.split(' ')[0].toLowerCase()
    return content.includes(`@${firstName}`) || content.includes(`@${u.display_name.split(' ')[0]}`)
  })

  // Close scheduler on outside click
  useEffect(() => {
    if (!showScheduler) return
    function handler(e: MouseEvent) {
      if (schedulerRef.current && !schedulerRef.current.contains(e.target as Node)) {
        setShowScheduler(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showScheduler])

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    const cursor = e.target.selectionStart ?? val.length
    setContent(val)

    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 144) + 'px'

    const beforeCursor = val.slice(0, cursor)
    const match = beforeCursor.match(/@(\w*)$/)
    if (match) {
      setMentionQuery(match[1])
      setMentionStart(beforeCursor.lastIndexOf('@'))
      setMentionIndex(0)
    } else {
      setMentionQuery(null)
      setMentionStart(-1)
    }
  }

  function insertMention(user: HubUser) {
    const firstName = user.display_name.split(' ')[0]
    const before = content.slice(0, mentionStart)
    const after = content.slice(mentionStart + 1 + (mentionQuery?.length ?? 0))
    const newVal = before + '@' + firstName + ' ' + after
    setContent(newVal)
    setMentionQuery(null)
    setMentionStart(-1)
    textareaRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && filteredUsers.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, filteredUsers.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(filteredUsers[mentionIndex]); return }
      if (e.key === 'Escape') { setMentionQuery(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  async function uploadFile(file: File) {
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/hub/upload', { method: 'POST', body: form })
    setUploading(false)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }))
      alert(err.error ?? 'Upload failed')
      return
    }
    const data = await res.json()
    const localUrl = URL.createObjectURL(file)
    setPendingFiles(prev => [...prev, { ...data, localUrl }])
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    files.forEach(uploadFile)
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    Array.from(e.dataTransfer.files).forEach(uploadFile)
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData.items)
    const fileItems = items.filter(i => i.kind === 'file')
    if (fileItems.length > 0) {
      e.preventDefault()
      fileItems.forEach(item => {
        const f = item.getAsFile()
        if (f) uploadFile(f)
      })
    }
  }

  function removeFile(idx: number) {
    setPendingFiles(prev => {
      const f = prev[idx]
      if (f.localUrl) URL.revokeObjectURL(f.localUrl)
      return prev.filter((_, i) => i !== idx)
    })
  }

  const send = useCallback(async () => {
    const trimmed = content.trim()
    if ((!trimmed && pendingFiles.length === 0) || sending) return
    setSending(true)
    setContent('')
    const files = pendingFiles.map(({ localUrl: _, ...f }) => f)
    setPendingFiles([])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    if (scheduledAt) {
      // Scheduled send
      await fetch('/api/hub/scheduled-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_id: roomId ?? null,
          conversation_id: conversationId ?? null,
          content: trimmed || ' ',
          files: files.length > 0 ? files : undefined,
          send_at: new Date(scheduledAt).toISOString(),
        }),
      })
      setScheduledAt('')
      setShowScheduler(false)
    } else {
      // Immediate send
      const res = await fetch('/api/hub/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_id: roomId ?? null,
          conversation_id: conversationId ?? null,
          content: trimmed || ' ',
          files: files.length > 0 ? files : undefined,
        }),
      })
      // Optimistic UI: show message immediately before realtime fires
      if (res.ok && onSent && currentUserId) {
        const data = await res.json()
        const sender = hubUsers.find(u => u.id === currentUserId) ?? { id: currentUserId, display_name: 'You', avatar_url: null }
        onSent({
          id: data.id,
          content: data.content ?? trimmed,
          created_at: data.created_at ?? new Date().toISOString(),
          edited_at: null,
          parent_id: null,
          room_id: roomId ?? null,
          conversation_id: conversationId ?? null,
          sender,
          reactions: [],
          files: [],
        })
      }
    }

    setSending(false)
    textareaRef.current?.focus()
  }, [content, pendingFiles, sending, scheduledAt, roomId, conversationId, onSent, currentUserId, hubUsers])

  // Min datetime for scheduler — 1 minute from now
  const minDateTime = new Date(Date.now() + 60000).toISOString().slice(0, 16)

  return (
    <div
      className="flex-none border-t border-gray-800 px-4 py-3"
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
    >
      {/* Pending file previews */}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {pendingFiles.map((f, i) => (
            <div key={i} className="relative group">
              {f.mime_type.startsWith('image/') && f.localUrl ? (
                <img src={f.localUrl} alt={f.filename} className="w-16 h-16 object-cover rounded-lg border border-gray-700" />
              ) : (
                <div className="w-16 h-16 bg-gray-800 border border-gray-700 rounded-lg flex flex-col items-center justify-center text-xs text-gray-400 px-1 text-center">
                  <span className="text-lg">📎</span>
                  <span className="truncate w-full text-center">{f.filename.slice(0, 8)}</span>
                </div>
              )}
              <button
                onClick={() => removeFile(i)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 hover:bg-red-400 rounded-full text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>
          ))}
          {uploading && (
            <div className="w-16 h-16 bg-gray-800 border border-gray-700 rounded-lg flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-[#2E7EB8] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      )}

      {/* Scheduled send indicator */}
      {scheduledAt && (
        <div className="mb-2 px-3 py-2 bg-[#2E7EB8]/10 border border-[#2E7EB8]/30 rounded-lg flex items-center justify-between text-xs text-[#2E7EB8]">
          <span>
            🕐 Scheduled for {new Date(scheduledAt).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}
          </span>
          <button onClick={() => { setScheduledAt(''); setShowScheduler(false) }} className="text-[#2E7EB8]/60 hover:text-[#2E7EB8] ml-2">✕</button>
        </div>
      )}

      {/* DND warning */}
      {mentionedDndUsers.length > 0 && (
        <div className="mb-2 px-3 py-2 bg-yellow-900/30 border border-yellow-700/40 rounded-lg flex items-center gap-2 text-xs text-yellow-300">
          <span>🔴</span>
          <span>
            {mentionedDndUsers.map(u => u.display_name.split(' ')[0]).join(', ')}
            {mentionedDndUsers.length === 1 ? ' has' : ' have'} Do Not Disturb on — they may not be notified.
          </span>
        </div>
      )}

      {/* Mention autocomplete */}
      {mentionQuery !== null && filteredUsers.length > 0 && (
        <div className="mb-2 bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-xl">
          {filteredUsers.map((user, i) => (
            <button
              key={user.id}
              onMouseDown={e => { e.preventDefault(); insertMention(user) }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                i === mentionIndex ? 'bg-[#2E7EB8]/20 text-white' : 'text-gray-300 hover:bg-gray-700'
              }`}
            >
              <div className="relative flex-none">
                <div className="w-6 h-6 rounded-full bg-gray-600 flex items-center justify-center text-xs font-bold">
                  {user.display_name.slice(0, 1).toUpperCase()}
                </div>
                {user.status === 'dnd' && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 ring-1 ring-gray-800" title="Do Not Disturb" />
                )}
                {user.status === 'busy' && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-yellow-400 ring-1 ring-gray-800" title="Busy" />
                )}
              </div>
              <span>{user.display_name}</span>
              {user.status === 'dnd' && (
                <span className="ml-auto text-xs text-red-400">DND</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Composer box */}
      <div className="flex items-end gap-3 bg-gray-900 border border-gray-700 rounded-xl px-4 py-2.5 focus-within:border-[#2E7EB8] transition-colors">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex-none text-gray-500 hover:text-gray-300 disabled:opacity-30 transition-colors pb-0.5"
          title="Attach file"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>

        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          placeholder={placeholder ?? 'Message…'}
          rows={1}
          disabled={sending}
          className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 resize-none outline-none leading-relaxed min-h-[24px] max-h-36"
        />

        {/* Schedule button */}
        <div className="relative flex-none pb-0.5" ref={schedulerRef}>
          <button
            type="button"
            onClick={() => setShowScheduler(v => !v)}
            className={`transition-colors ${scheduledAt ? 'text-[#2E7EB8]' : 'text-gray-500 hover:text-gray-300'}`}
            title="Schedule send"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>

          {showScheduler && (
            <div className="absolute bottom-full right-0 mb-2 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-3 z-50 w-64">
              <p className="text-xs text-gray-400 mb-2 font-medium">Schedule for later</p>
              <input
                type="datetime-local"
                min={minDateTime}
                value={scheduledAt}
                onChange={e => setScheduledAt(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#2E7EB8]"
              />
              {scheduledAt && (
                <button
                  onClick={() => { setScheduledAt(''); setShowScheduler(false) }}
                  className="mt-2 w-full text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Clear schedule
                </button>
              )}
            </div>
          )}
        </div>

        <button
          onClick={send}
          disabled={(!content.trim() && pendingFiles.length === 0) || sending}
          className={`flex-none w-8 h-8 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors ${
            scheduledAt ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-[#2E7EB8] hover:bg-[#2470a8]'
          }`}
          title={scheduledAt ? 'Schedule message' : 'Send (Enter)'}
        >
          {scheduledAt ? (
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-white" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
          )}
        </button>
      </div>

      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />
      <p className="text-xs text-gray-600 mt-1.5 px-1">Enter to send · Shift+Enter for new line · @ to mention</p>
    </div>
  )
}
