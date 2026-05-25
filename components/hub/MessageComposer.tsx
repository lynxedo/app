'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import data from '@emoji-mart/data'
import { init, SearchIndex } from 'emoji-mart'
import type { HubMessage, HubUser } from './MessageFeed'
import ScheduledMessagesModal from './ScheduledMessagesModal'

// emoji-mart needs its data registered once before SearchIndex.search() works.
// Calling init() multiple times is a no-op, so module-load is fine.
init({ data })

const EmojiMartPicker = dynamic(() => import('@emoji-mart/react').then(m => m.default), {
  ssr: false,
})

type PendingFile = {
  storage_path: string
  filename: string
  mime_type: string
  size_bytes: number
  width_px?: number | null
  height_px?: number | null
  localUrl?: string
}

// Read intrinsic dimensions from an image File before upload so the chat
// thumbnail can reserve the right aspect ratio when it renders. Returns
// {width, height} on success, null for non-images or read failures.
async function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith('image/')) return null
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth
      const h = img.naturalHeight
      URL.revokeObjectURL(url)
      resolve(w > 0 && h > 0 ? { width: w, height: h } : null)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

type EmojiSuggestion = {
  id: string
  name: string
  native: string
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
  // Mention autocomplete
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStart, setMentionStart] = useState(-1)
  const [mentionIndex, setMentionIndex] = useState(0)
  // Emoji :name: autocomplete
  const [emojiQuery, setEmojiQuery] = useState<string | null>(null)
  const [emojiStart, setEmojiStart] = useState(-1)
  const [emojiIndex, setEmojiIndex] = useState(0)
  const [emojiResults, setEmojiResults] = useState<EmojiSuggestion[]>([])
  // Scheduled send
  const [scheduledAt, setScheduledAt] = useState<string>('') // ISO datetime-local string
  const [showScheduler, setShowScheduler] = useState(false)
  const [showScheduledModal, setShowScheduledModal] = useState(false)
  const schedulerRef = useRef<HTMLDivElement>(null)
  // Emoji picker popover (toolbar 😀 button)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const emojiPickerRef = useRef<HTMLDivElement>(null)
  // Format picker popover (toolbar Aa button)
  const [showFormatPicker, setShowFormatPicker] = useState(false)
  const formatPickerRef = useRef<HTMLDivElement>(null)
  // Expand chevron — does NOT persist across mounts or sessions; every
  // room/DM open starts collapsed (Session 39 PRD).
  const [expanded, setExpanded] = useState(false)

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

  // Run emoji search whenever the :name: query changes.
  useEffect(() => {
    if (emojiQuery === null || emojiQuery.length === 0) {
      setEmojiResults([])
      return
    }
    let cancelled = false
    ;(async () => {
      // SearchIndex.search returns up to 90 results sorted by relevance.
      const found: Array<{ id: string; name: string; skins: { native: string }[] }> =
        await SearchIndex.search(emojiQuery) ?? []
      if (cancelled) return
      setEmojiResults(
        found.slice(0, 6).map(e => ({ id: e.id, name: e.name, native: e.skins?.[0]?.native ?? '' }))
      )
      setEmojiIndex(0)
    })()
    return () => { cancelled = true }
  }, [emojiQuery])

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

  // Close format picker on outside click
  useEffect(() => {
    if (!showFormatPicker) return
    function handler(e: MouseEvent) {
      if (formatPickerRef.current && !formatPickerRef.current.contains(e.target as Node)) {
        setShowFormatPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showFormatPicker])

  function autoSize() {
    const el = textareaRef.current
    if (!el) return
    if (expanded) {
      // Expanded — let the wrapping flex layout dictate height. Reset
      // inline height so the percentage class wins.
      el.style.height = ''
      return
    }
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 144) + 'px'
  }

  // Resize when we toggle expanded or content changes.
  useEffect(() => { autoSize() }, [expanded, content])

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    const cursor = e.target.selectionStart ?? val.length
    setContent(val)

    const beforeCursor = val.slice(0, cursor)

    // Mention detection: @ followed by word chars at end of beforeCursor
    const mentionMatch = beforeCursor.match(/@(\w*)$/)
    if (mentionMatch) {
      setMentionQuery(mentionMatch[1])
      setMentionStart(beforeCursor.lastIndexOf('@'))
      setMentionIndex(0)
    } else {
      setMentionQuery(null)
      setMentionStart(-1)
    }

    // Emoji shortcode detection: : followed by 1+ word chars, not part of
    // a URL (no preceding `/` or `:` immediately before — `https://` would
    // otherwise trigger us). Require at least one letter to avoid showing
    // a giant list on bare `:`.
    const emojiMatch = beforeCursor.match(/(?:^|\s):(\w{1,})$/)
    if (emojiMatch) {
      setEmojiQuery(emojiMatch[1])
      setEmojiStart(beforeCursor.length - emojiMatch[1].length - 1)
    } else {
      setEmojiQuery(null)
      setEmojiStart(-1)
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

  function insertEmojiFromSuggestion(emoji: EmojiSuggestion) {
    const before = content.slice(0, emojiStart)
    const after = content.slice(emojiStart + 1 + (emojiQuery?.length ?? 0))
    const newVal = before + emoji.native + after
    setContent(newVal)
    setEmojiQuery(null)
    setEmojiStart(-1)
    // Restore caret position just after the inserted emoji.
    const caret = (before + emoji.native).length
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  function insertEmojiAtCaret(native: string) {
    const el = textareaRef.current
    const start = el?.selectionStart ?? content.length
    const end = el?.selectionEnd ?? content.length
    const newVal = content.slice(0, start) + native + content.slice(end)
    setContent(newVal)
    const caret = start + native.length
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  function insertMentionTrigger() {
    // Toolbar @ button — insert "@" at the caret and let the existing
    // mention autocomplete fire as the user types the name.
    const el = textareaRef.current
    const start = el?.selectionStart ?? content.length
    const end = el?.selectionEnd ?? content.length
    const before = content.slice(0, start)
    const needsSpace = before.length > 0 && !/\s$/.test(before)
    const insert = (needsSpace ? ' ' : '') + '@'
    const newVal = before + insert + content.slice(end)
    setContent(newVal)
    const caret = before.length + insert.length
    setMentionQuery('')
    setMentionStart(caret - 1)
    setMentionIndex(0)
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  // Wrap the current selection (or insert markers at the caret) with a
  // Slack-style formatter — *bold*, _italic_, ~strike~, `code`. If there's
  // a selection it stays selected (wrapped); otherwise the caret lands
  // between the two markers so the user can type.
  function wrapSelection(marker: string) {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart ?? content.length
    const end = el.selectionEnd ?? content.length
    const before = content.slice(0, start)
    const selected = content.slice(start, end)
    const after = content.slice(end)
    setContent(before + marker + selected + marker + after)
    const newStart = start + marker.length
    const newEnd = end + marker.length
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      if (selected.length > 0) el.setSelectionRange(newStart, newEnd)
      else el.setSelectionRange(newStart, newStart)
    })
  }

  // Insert `> ` at the start of the line containing the caret.
  function prependQuoteToLine() {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart ?? content.length
    const lineStart = content.lastIndexOf('\n', start - 1) + 1
    if (content.slice(lineStart, lineStart + 2) === '> ') return // already quoted
    const newVal = content.slice(0, lineStart) + '> ' + content.slice(lineStart)
    setContent(newVal)
    const newCaret = start + 2
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(newCaret, newCaret)
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Emoji autocomplete navigation takes priority over mention because
    // the two can't be open at the same time (different trigger chars).
    if (emojiQuery !== null && emojiResults.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setEmojiIndex(i => Math.min(i + 1, emojiResults.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setEmojiIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertEmojiFromSuggestion(emojiResults[emojiIndex]); return }
      if (e.key === 'Escape') { setEmojiQuery(null); return }
    }
    if (mentionQuery !== null && filteredUsers.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, filteredUsers.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(filteredUsers[mentionIndex]); return }
      if (e.key === 'Escape') { setMentionQuery(null); return }
    }
    // Formatting shortcuts — Cmd on Mac, Ctrl elsewhere.
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase()
      if (k === 'b' && !e.shiftKey) { e.preventDefault(); wrapSelection('*'); return }
      if (k === 'i' && !e.shiftKey) { e.preventDefault(); wrapSelection('_'); return }
      if (k === 'x' && e.shiftKey)  { e.preventDefault(); wrapSelection('~'); return }
    }
    // Enter sends on desktop only. On mobile (≤767px) Enter inserts a
    // newline — sending requires tapping the Send button. This matches
    // how every native mobile messaging app behaves and avoids the
    // "I accidentally sent a half-typed message" papercut.
    if (e.key === 'Enter' && !e.shiftKey) {
      const isMobile = typeof window !== 'undefined'
        && window.matchMedia('(max-width: 767px)').matches
      if (!isMobile) {
        e.preventDefault()
        send()
      }
    }
  }

  async function uploadFile(file: File) {
    setUploading(true)
    const dims = await readImageDimensions(file)
    const form = new FormData()
    form.append('file', file)
    if (dims) {
      form.append('width_px', String(dims.width))
      form.append('height_px', String(dims.height))
    }
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
    // Snapshot the pending files with their blob URLs for the optimistic
    // insert. Real DB ids arrive via the realtime INSERT a moment later.
    const optimisticFiles = pendingFiles.map((f, i) => ({
      id: `temp-file-${Date.now()}-${i}`,
      filename: f.filename,
      mime_type: f.mime_type,
      size_bytes: f.size_bytes,
      storage_path: f.storage_path,
      width_px: f.width_px ?? null,
      height_px: f.height_px ?? null,
      localUrl: f.localUrl,
    }))
    setPendingFiles([])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    // Auto-collapse the expanded composer on send (PRD).
    setExpanded(false)

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
          files: optimisticFiles,
        })
      }
    }

    setSending(false)
    textareaRef.current?.focus()
  }, [content, pendingFiles, sending, scheduledAt, roomId, conversationId, onSent, currentUserId, hubUsers])

  // Min datetime for scheduler — 1 minute from now
  const minDateTime = new Date(Date.now() + 60000).toISOString().slice(0, 16)

  const hasContent = content.trim().length > 0 || pendingFiles.length > 0

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

      {/* Emoji :name: autocomplete */}
      {emojiQuery !== null && emojiResults.length > 0 && (
        <div className="mb-2 bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-xl">
          {emojiResults.map((emoji, i) => (
            <button
              key={emoji.id}
              onMouseDown={e => { e.preventDefault(); insertEmojiFromSuggestion(emoji) }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                i === emojiIndex ? 'bg-[#2E7EB8]/20 text-white' : 'text-gray-300 hover:bg-gray-700'
              }`}
            >
              <span className="text-xl flex-none w-6 text-center">{emoji.native}</span>
              <span className="text-gray-400">:{emoji.id}:</span>
              <span className="ml-auto text-xs text-gray-500 truncate">{emoji.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Expand chevron — sits ABOVE the input rectangle, flush right.
          Ben's explicit ask: outside the input, not inside it. */}
      <div className="flex justify-end mb-1">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="text-gray-500 hover:text-gray-300 transition-colors p-1 -mr-1"
          title={expanded ? 'Shrink composer' : 'Expand composer'}
          aria-label={expanded ? 'Shrink composer' : 'Expand composer'}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {expanded ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 15l-7-7-7 7" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 9l7 7 7-7" />
            )}
          </svg>
        </button>
      </div>

      {/* Input rectangle — clean, just the textarea. Attach/send/emoji
          live in the toolbar bar below. */}
      <div
        className={`bg-gray-900 border border-gray-700 rounded-xl px-4 py-2.5 focus-within:border-[#2E7EB8] transition-colors ${
          expanded ? 'h-[50vh] flex' : ''
        }`}
      >
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
          className={`w-full bg-transparent text-base md:text-sm text-white placeholder-gray-500 resize-none outline-none leading-relaxed ${
            expanded ? 'flex-1 h-full' : 'min-h-[24px] max-h-36'
          }`}
        />
      </div>

      {/* Toolbar bar below the input. Order (Slack-style):
          📎 attach · Aa format · 😀 emoji · @ mention · ⏰ schedule · ▶ Send */}
      <div className="flex items-center gap-1 mt-1.5 px-1">
        {/* Attach */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="text-gray-500 hover:text-gray-300 disabled:opacity-30 transition-colors p-1.5 rounded-md hover:bg-gray-800"
          title="Attach file"
          aria-label="Attach file"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>

        {/* Aa format — Slack-style markdown wrappers. Popover stays open
            until outside-click; each action closes it so typing flows. */}
        <div className="relative" ref={formatPickerRef}>
          <button
            type="button"
            onClick={() => setShowFormatPicker(v => !v)}
            className="text-gray-500 hover:text-gray-300 transition-colors p-1.5 rounded-md hover:bg-gray-800 font-semibold text-sm"
            title="Format text"
            aria-label="Format text"
          >
            Aa
          </button>
          {showFormatPicker && (
            <div className="absolute bottom-full left-0 mb-2 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-1 z-50 flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => { wrapSelection('*'); setShowFormatPicker(false) }}
                className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-white hover:bg-gray-800 rounded-md font-bold"
                title="Bold (⌘B)"
                aria-label="Bold"
              >
                B
              </button>
              <button
                type="button"
                onClick={() => { wrapSelection('_'); setShowFormatPicker(false) }}
                className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-white hover:bg-gray-800 rounded-md italic font-serif"
                title="Italic (⌘I)"
                aria-label="Italic"
              >
                I
              </button>
              <button
                type="button"
                onClick={() => { wrapSelection('~'); setShowFormatPicker(false) }}
                className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-white hover:bg-gray-800 rounded-md line-through"
                title="Strikethrough (⌘⇧X)"
                aria-label="Strikethrough"
              >
                S
              </button>
              <button
                type="button"
                onClick={() => { wrapSelection('`'); setShowFormatPicker(false) }}
                className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-white hover:bg-gray-800 rounded-md font-mono text-xs"
                title="Inline code"
                aria-label="Inline code"
              >
                {'<>'}
              </button>
              <button
                type="button"
                onClick={() => { prependQuoteToLine(); setShowFormatPicker(false) }}
                className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-white hover:bg-gray-800 rounded-md text-base"
                title="Quote line"
                aria-label="Quote line"
              >
                ❝
              </button>
            </div>
          )}
        </div>

        {/* Emoji picker */}
        <div className="relative" ref={emojiPickerRef}>
          <button
            type="button"
            onClick={() => setShowEmojiPicker(v => !v)}
            className="text-gray-500 hover:text-gray-300 transition-colors p-1.5 rounded-md hover:bg-gray-800"
            title="Insert emoji"
            aria-label="Insert emoji"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
            </svg>
          </button>
          {showEmojiPicker && (
            <div className="absolute bottom-full left-0 mb-2 z-50">
              <EmojiMartPicker
                data={data}
                theme="dark"
                previewPosition="none"
                skinTonePosition="search"
                navPosition="bottom"
                perLine={8}
                maxFrequentRows={2}
                onEmojiSelect={(e: { native: string }) => {
                  insertEmojiAtCaret(e.native)
                  setShowEmojiPicker(false)
                }}
                onClickOutside={() => setShowEmojiPicker(false)}
              />
            </div>
          )}
        </div>

        {/* Mention trigger */}
        <button
          type="button"
          onClick={insertMentionTrigger}
          className="text-gray-500 hover:text-gray-300 transition-colors p-1.5 rounded-md hover:bg-gray-800 font-semibold text-base"
          title="Mention someone"
          aria-label="Mention someone"
        >
          @
        </button>

        {/* Schedule */}
        <div className="relative" ref={schedulerRef}>
          <button
            type="button"
            onClick={() => setShowScheduler(v => !v)}
            className={`transition-colors p-1.5 rounded-md hover:bg-gray-800 ${
              scheduledAt ? 'text-[#2E7EB8]' : 'text-gray-500 hover:text-gray-300'
            }`}
            title="Schedule send"
            aria-label="Schedule send"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>

          {showScheduler && (
            <div className="absolute bottom-full mb-2 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-3 z-50 w-64 max-w-[calc(100vw-1rem)] left-1/2 -translate-x-1/2 md:left-0 md:translate-x-0">
              <p className="text-xs text-gray-400 mb-2 font-medium">Schedule for later</p>
              <input
                type="datetime-local"
                min={minDateTime}
                value={scheduledAt}
                onChange={e => setScheduledAt(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-base md:text-sm text-white outline-none focus:border-[#2E7EB8]"
              />
              {scheduledAt && (
                <button
                  onClick={() => { setScheduledAt(''); setShowScheduler(false) }}
                  className="mt-2 w-full text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Clear schedule
                </button>
              )}
              <button
                type="button"
                onClick={() => { setShowScheduler(false); setShowScheduledModal(true) }}
                className="mt-2 w-full text-xs text-[#2E7EB8] hover:text-[#5aa3d4] transition-colors border-t border-gray-700 pt-2"
              >
                View scheduled messages
              </button>
            </div>
          )}
        </div>

        {/* Spacer pushes Send to the right edge */}
        <div className="flex-1" />

        {/* Send button. Fixed pixel size so it doesn't balloon when the
            user picks L for root font-size (Session 36.6). Hidden when
            nothing to send. */}
        {hasContent && (
          <button
            onClick={send}
            disabled={sending}
            style={{ width: '32px', height: '32px' }}
            className={`flex-none rounded-lg disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors ${
              scheduledAt ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-[#2E7EB8] hover:bg-[#2470a8]'
            }`}
            title={scheduledAt ? 'Schedule message' : 'Send'}
            aria-label={scheduledAt ? 'Schedule message' : 'Send'}
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
        )}
      </div>

      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />

      {showScheduledModal && (
        <ScheduledMessagesModal onClose={() => setShowScheduledModal(false)} />
      )}
    </div>
  )
}
