'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import data from '@emoji-mart/data'
import { init, SearchIndex } from 'emoji-mart'
import { createClient } from '@/lib/supabase/client'
import { FileAttachment } from './MessageFeed'
import type { HubMessage, HubUser, Sender, FileItem } from './MessageFeed'
import MediaLightbox, { type LightboxItem } from './MediaLightbox'
import { renderContent } from './renderContent'

init({ data })

const EmojiMartPicker = dynamic(() => import('@emoji-mart/react').then(m => m.default), {
  ssr: false,
})

type EmojiSuggestion = { id: string; name: string; native: string }

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
// thumbnail can reserve the right aspect ratio when it renders.
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

function normSender(raw: Sender | Sender[] | null): Sender | null {
  if (!raw) return null
  return Array.isArray(raw) ? (raw[0] ?? null) : raw
}

function normFiles(raw: unknown): FileItem[] {
  if (!raw || !Array.isArray(raw)) return []
  return raw as FileItem[]
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
  files?: FileItem[]
}

export default function ThreadPanel({
  parentMessage,
  currentUserId,
  hubUsers,
  onClose,
  onReplyPosted,
}: {
  parentMessage: HubMessage
  currentUserId: string
  hubUsers: HubUser[]
  onClose: () => void
  // Fired right after a thread reply lands in the DB so the main feed
  // can bump the parent's "N replies" indicator immediately. The realtime
  // path also bumps, but it's flaky enough that the local notify is the
  // reliable signal for the sender's own view. The dedupe ref on the
  // receiving side prevents double-counting when realtime ALSO delivers.
  onReplyPosted?: (parentId: string, replyId: string) => void
}) {
  const [replies, setReplies] = useState<Reply[]>([])
  const [replyContent, setReplyContent] = useState('')
  const [sending, setSending] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  // Pending attachments
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [uploading, setUploading] = useState(false)
  // Scheduled send — same shape as MessageComposer
  const [scheduledAt, setScheduledAt] = useState<string>('')
  const [showScheduler, setShowScheduler] = useState(false)
  const schedulerRef = useRef<HTMLDivElement>(null)
  // Lightbox for image/PDF previews in reply bubbles
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null)
  // Emoji :name: autocomplete
  const [emojiQuery, setEmojiQuery] = useState<string | null>(null)
  const [emojiStart, setEmojiStart] = useState(-1)
  const [emojiIndex, setEmojiIndex] = useState(0)
  const [emojiResults, setEmojiResults] = useState<EmojiSuggestion[]>([])
  // Emoji picker popover (toolbar 😀 button)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showFormatPicker, setShowFormatPicker] = useState(false)
  const formatPickerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const didInitialScroll = useRef(false)
  const supabase = createClient()
  // Keep the latest onReplyPosted in a ref so the realtime subscription
  // (keyed only on parentMessage.id) can call it without listing it in the
  // effect deps — it's a fresh closure each render and would otherwise force
  // a constant re-subscribe.
  const onReplyPostedRef = useRef(onReplyPosted)
  onReplyPostedRef.current = onReplyPosted

  useEffect(() => {
    if (emojiQuery === null || emojiQuery.length === 0) { setEmojiResults([]); return }
    let cancelled = false
    ;(async () => {
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

  function wrapSelection(marker: string) {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart ?? replyContent.length
    const end = el.selectionEnd ?? replyContent.length
    const before = replyContent.slice(0, start)
    const selected = replyContent.slice(start, end)
    const after = replyContent.slice(end)
    setReplyContent(before + marker + selected + marker + after)
    const newStart = start + marker.length
    const newEnd = end + marker.length
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      if (selected.length > 0) el.setSelectionRange(newStart, newEnd)
      else el.setSelectionRange(newStart, newStart)
    })
  }

  function prependQuoteToLine() {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart ?? replyContent.length
    const lineStart = replyContent.lastIndexOf('\n', start - 1) + 1
    if (replyContent.slice(lineStart, lineStart + 2) === '> ') return
    const newVal = replyContent.slice(0, lineStart) + '> ' + replyContent.slice(lineStart)
    setReplyContent(newVal)
    const newCaret = start + 2
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(newCaret, newCaret)
    })
  }

  function handleReplyChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    const cursor = e.target.selectionStart ?? val.length
    setReplyContent(val)
    const beforeCursor = val.slice(0, cursor)
    const emojiMatch = beforeCursor.match(/(?:^|\s):(\w{1,})$/)
    if (emojiMatch) {
      setEmojiQuery(emojiMatch[1])
      setEmojiStart(beforeCursor.length - emojiMatch[1].length - 1)
    } else {
      setEmojiQuery(null)
      setEmojiStart(-1)
    }
  }

  function insertEmojiFromSuggestion(emoji: EmojiSuggestion) {
    const before = replyContent.slice(0, emojiStart)
    const after = replyContent.slice(emojiStart + 1 + (emojiQuery?.length ?? 0))
    const newVal = before + emoji.native + after
    setReplyContent(newVal)
    setEmojiQuery(null)
    setEmojiStart(-1)
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
    const start = el?.selectionStart ?? replyContent.length
    const end = el?.selectionEnd ?? replyContent.length
    const newVal = replyContent.slice(0, start) + native + replyContent.slice(end)
    setReplyContent(newVal)
    const caret = start + native.length
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(caret, caret)
    })
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

  useEffect(() => {
    supabase
      .from('messages')
      .select('id, content, created_at, edited_at, sender:hub_users!sender_id(id, display_name, avatar_url, is_bot), files (id, filename, mime_type, size_bytes, storage_path, width_px, height_px)')
      .eq('parent_id', parentMessage.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setReplies((data ?? []) as unknown as Reply[])
      })
  }, [parentMessage.id])

  // First time replies arrive, jump to the bottom instantly before paint — no
  // visible scroll on thread open. Subsequent reply arrivals use smooth scroll.
  useLayoutEffect(() => {
    if (didInitialScroll.current || replies.length === 0) return
    bottomRef.current?.scrollIntoView({ block: 'end' })
    didInitialScroll.current = true
  }, [replies.length])

  useEffect(() => {
    if (!didInitialScroll.current) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [replies.length])

  useEffect(() => {
    // Apply a reply that arrived via either realtime path. Fetches the full
    // row, dedupes into the list (dropping any optimistic temp entry), and
    // bumps the parent's "N replies" count via onReplyPosted — deduped by
    // reply id on the receiving side, so postgres_changes + broadcast + the
    // sender's own local notify can't double-count.
    const applyIncomingReply = async (id: string) => {
      const { data } = await supabase
        .from('messages')
        .select('id, content, created_at, edited_at, sender:hub_users!sender_id(id, display_name, avatar_url, is_bot), files (id, filename, mime_type, size_bytes, storage_path, width_px, height_px)')
        .eq('id', id)
        .single()
      if (!data) return
      const reply = data as unknown as Reply
      setReplies(prev => {
        const withoutTemp = prev.filter(r => !r.id.startsWith('temp-'))
        if (withoutTemp.some(r => r.id === reply.id)) return withoutTemp
        return [...withoutTemp, reply]
      })
      onReplyPostedRef.current?.(parentMessage.id, reply.id)
    }

    const channel = supabase
      .channel(`thread:${parentMessage.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `parent_id=eq.${parentMessage.id}`,
      }, (payload) => { void applyIncomingReply(payload.new.id as string) })
      // Broadcast fallback — postgres_changes routinely drops admin-client
      // inserts (Guardian's async reply especially), so the server fires a
      // `thread:<parentId>` broadcast after inserting any threaded message.
      // Without this an open thread never shows Guardian's reply (or bumps
      // the count) until a hard refresh.
      .on('broadcast', { event: 'message-inserted' }, (payload) => {
        const p = (payload.payload ?? {}) as { id?: string; parent_id?: string | null }
        if (!p.id || p.parent_id !== parentMessage.id) return
        void applyIncomingReply(p.id)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [parentMessage.id])

  async function sendReply() {
    const trimmed = replyContent.trim()
    if ((!trimmed && pendingFiles.length === 0) || sending) return
    setSending(true)
    setReplyContent('')
    const filesPayload = pendingFiles.map(({ localUrl: _, ...f }) => f)
    const optimisticFiles: FileItem[] = pendingFiles.map((f, i) => ({
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

    const wasScheduled = !!scheduledAt
    if (wasScheduled) {
      await fetch('/api/hub/scheduled-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_id: parentMessage.room_id ?? null,
          conversation_id: parentMessage.conversation_id ?? null,
          parent_id: parentMessage.id,
          content: trimmed || ' ',
          files: filesPayload.length > 0 ? filesPayload : undefined,
          send_at: new Date(scheduledAt).toISOString(),
        }),
      })
      setScheduledAt('')
      setShowScheduler(false)
      setSending(false)
      return
    }

    const currentUser = hubUsers.find(u => u.id === currentUserId) ?? null
    const tempId = `temp-${Date.now()}`
    setReplies(prev => [...prev, {
      id: tempId,
      content: trimmed,
      created_at: new Date().toISOString(),
      edited_at: null,
      sender: currentUser,
      files: optimisticFiles,
    }])

    const res = await fetch('/api/hub/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: parentMessage.room_id ?? null,
        conversation_id: parentMessage.conversation_id ?? null,
        parent_id: parentMessage.id,
        content: trimmed || ' ',
        files: filesPayload.length > 0 ? filesPayload : undefined,
      }),
    })

    // Notify the main feed so the parent's "N replies" indicator updates
    // immediately for this sender — the realtime path that should do this
    // can drop events under iOS webview suspension and the broadcast
    // subscribe-vs-send race.
    if (res.ok && onReplyPosted) {
      const data = await res.clone().json().catch(() => null) as { id?: string } | null
      if (data?.id) onReplyPosted(parentMessage.id, data.id)
    }

    // Refetch all replies to replace the optimistic entry with the real one
    const { data: refreshed } = await supabase
      .from('messages')
      .select('id, content, created_at, edited_at, sender:hub_users!sender_id(id, display_name, avatar_url, is_bot), files (id, filename, mime_type, size_bytes, storage_path, width_px, height_px)')
      .eq('parent_id', parentMessage.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
    if (refreshed) setReplies(refreshed as unknown as Reply[])

    setSending(false)
  }

  const parentSender = normSender(parentMessage.sender)
  const minDateTime = new Date(Date.now() + 60000).toISOString().slice(0, 16)
  const hasContent = replyContent.trim().length > 0 || pendingFiles.length > 0

  return (
    <div
      className="w-full flex-1 border-l border-gray-800 flex flex-col bg-gray-950"
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
    >
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
              {renderContent(parentMessage.content, hubUsers)}
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
          const files = normFiles(reply.files)
          // Build the lightbox slice for THIS reply so navigation is scoped
          // to this message's media (matches MessageFeed's per-message scope).
          const mediaItems: LightboxItem[] = []
          const mediaIdxByFileId: Record<string, number> = {}
          for (const f of files) {
            const isImg = f.mime_type.startsWith('image/')
            const isPdf = f.mime_type === 'application/pdf'
            if (isImg || isPdf) {
              mediaIdxByFileId[f.id] = mediaItems.length
              mediaItems.push({
                type: isImg ? 'image' : 'pdf',
                src: f.localUrl ?? `/api/hub/files/${f.id}`,
                filename: f.filename,
              })
            }
          }
          return (
            <div key={reply.id} className="flex items-start gap-2">
              <Avatar sender={sender} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-0.5">
                  <span className="font-semibold text-xs text-white">{sender?.display_name ?? 'Unknown'}</span>
                  <span className="text-xs text-gray-600">{formatTime(reply.created_at)}</span>
                </div>
                {reply.content && reply.content.trim() && (
                  <p className="hub-message-text text-lg md:text-sm text-gray-200 leading-relaxed whitespace-pre-wrap break-words">
                    {renderContent(reply.content, hubUsers)}
                    {reply.edited_at && <span className="ml-1 text-xs text-gray-600">(edited)</span>}
                  </p>
                )}
                {files.length > 0 && (
                  <div className={files.length > 1 ? 'grid grid-cols-2 gap-1.5 mt-1' : ''}>
                    {files.map(f => {
                      const mIdx = mediaIdxByFileId[f.id]
                      return (
                        <FileAttachment
                          key={f.id}
                          file={f}
                          onOpenLightbox={
                            mIdx !== undefined
                              ? () => setLightbox({ items: mediaItems, index: mIdx })
                              : undefined
                          }
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Reply composer */}
      <div className="flex-none border-t border-gray-800 px-3 py-3">
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

        <div className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 focus-within:border-[#2E7EB8] transition-colors flex items-start gap-2">
          <textarea
            ref={textareaRef}
            value={replyContent}
            onChange={handleReplyChange}
            onPaste={handlePaste}
            onKeyDown={e => {
              if (emojiQuery !== null && emojiResults.length > 0) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setEmojiIndex(i => Math.min(i + 1, emojiResults.length - 1)); return }
                if (e.key === 'ArrowUp') { e.preventDefault(); setEmojiIndex(i => Math.max(i - 1, 0)); return }
                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertEmojiFromSuggestion(emojiResults[emojiIndex]); return }
                if (e.key === 'Escape') { setEmojiQuery(null); return }
              }
              if ((e.metaKey || e.ctrlKey) && !e.altKey) {
                const k = e.key.toLowerCase()
                if (k === 'b' && !e.shiftKey) { e.preventDefault(); wrapSelection('*'); return }
                if (k === 'i' && !e.shiftKey) { e.preventDefault(); wrapSelection('_'); return }
                if (k === 'x' && e.shiftKey)  { e.preventDefault(); wrapSelection('~'); return }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                const isMobile = typeof window !== 'undefined'
                  && window.matchMedia('(max-width: 767px)').matches
                if (!isMobile) { e.preventDefault(); sendReply() }
              }
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

          {/* Aa format */}
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
                <button type="button" onClick={() => { wrapSelection('*'); setShowFormatPicker(false) }} className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-white hover:bg-gray-800 rounded-md font-bold" title="Bold (⌘B)" aria-label="Bold">B</button>
                <button type="button" onClick={() => { wrapSelection('_'); setShowFormatPicker(false) }} className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-white hover:bg-gray-800 rounded-md italic font-serif" title="Italic (⌘I)" aria-label="Italic">I</button>
                <button type="button" onClick={() => { wrapSelection('~'); setShowFormatPicker(false) }} className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-white hover:bg-gray-800 rounded-md line-through" title="Strikethrough (⌘⇧X)" aria-label="Strikethrough">S</button>
                <button type="button" onClick={() => { wrapSelection('`'); setShowFormatPicker(false) }} className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-white hover:bg-gray-800 rounded-md font-mono text-xs" title="Inline code" aria-label="Inline code">{'<>'}</button>
                <button type="button" onClick={() => { prependQuoteToLine(); setShowFormatPicker(false) }} className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-white hover:bg-gray-800 rounded-md text-base" title="Quote line" aria-label="Quote line">❝</button>
              </div>
            )}
          </div>

          {/* Emoji picker */}
          <div className="relative">
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
              </div>
            )}
          </div>

          <div className="flex-1" />

          <button
            onClick={sendReply}
            disabled={!hasContent || sending}
            className={`text-xs disabled:opacity-30 text-white px-3 py-1.5 rounded-lg transition-colors ${
              scheduledAt ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-[#2E7EB8] hover:bg-[#2470a8]'
            }`}
          >
            {scheduledAt ? 'Schedule' : 'Reply'}
          </button>
        </div>
      </div>

      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />

      {lightbox && (
        <MediaLightbox
          items={lightbox.items}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}
