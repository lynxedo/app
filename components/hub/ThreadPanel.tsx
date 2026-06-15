'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useToast, useConfirm } from '@/components/ui'
import dynamic from 'next/dynamic'
import { init, SearchIndex } from 'emoji-mart'
import { createClient } from '@/lib/supabase/client'
import { FileAttachment } from './MessageFeed'
import EmojiPicker from './EmojiPicker'
import ForwardModal, { type ForwardTarget } from './ForwardModal'
import SaveToFilesModal from './SaveToFilesModal'
import MessageActionsSheet from './MessageActionsSheet'
import type { HubMessage, HubUser, Sender, FileItem, RxItem } from './MessageFeed'
import MediaLightbox, { type LightboxItem } from './MediaLightbox'
import { renderContent } from './renderContent'

// Lazy emoji data — keeps the ~250kb dataset out of the initial bundle. Loaded
// once on first need; init() then registers it so SearchIndex.search() works.
let _emojiDataPromise: Promise<void> | null = null
let _emojiData: unknown = null
function ensureEmojiData(): Promise<void> {
  if (!_emojiDataPromise) {
    _emojiDataPromise = import('@emoji-mart/data').then(m => {
      _emojiData = m.default
      init({ data: _emojiData })
    })
  }
  return _emojiDataPromise
}

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

function normReactions(raw: unknown): RxItem[] {
  if (!raw || !Array.isArray(raw)) return []
  return raw as RxItem[]
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function Avatar({ sender }: { sender: Sender | null }) {
  if (!sender) return <div className="w-7 h-7 rounded-full bg-gray-700 flex-none" />
  if (sender.avatar_url) return <img src={`/api/profile/avatar/${sender.id}`} alt="" className="w-7 h-7 rounded-full flex-none object-cover" />
  return (
    <div className={`w-7 h-7 rounded-full flex-none flex items-center justify-center text-xs font-bold text-white ${sender.is_bot ? 'bg-brand' : 'bg-gray-600'}`}>
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
  reactions?: RxItem[]
}

export default function ThreadPanel({
  parentMessage,
  currentUserId,
  hubUsers,
  isAdmin,
  expanded,
  onToggleExpand,
  onClose,
  onReplyPosted,
}: {
  parentMessage: HubMessage
  currentUserId: string
  hubUsers: HubUser[]
  isAdmin?: boolean
  // Desktop "Expand → full" toggle, driven by RoomView. Drag-resize is
  // unaffected; this just snaps the panel to fill the pane and back.
  expanded?: boolean
  onToggleExpand?: () => void
  onClose: () => void
  // Fired right after a thread reply lands in the DB so the main feed
  // can bump the parent's "N replies" indicator immediately. The realtime
  // path also bumps, but it's flaky enough that the local notify is the
  // reliable signal for the sender's own view. The dedupe ref on the
  // receiving side prevents double-counting when realtime ALSO delivers.
  onReplyPosted?: (parentId: string, replyId: string) => void
}) {
  const toast = useToast()
  const confirmDialog = useConfirm()
  const [replies, setReplies] = useState<Reply[]>([])
  const [replyContent, setReplyContent] = useState('')
  const [sending, setSending] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null) // #5
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
  const [emojiData, setEmojiData] = useState<unknown>(() => _emojiData)
  // Reactions on the parent message + replies (msgId → reactors). Mirrors the
  // main feed so reacting works the same inside a thread.
  const [rxMap, setRxMap] = useState<Record<string, RxItem[]>>({})
  // Which message's quick-reaction popover / full picker is open.
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null)
  const [fullReactionPickerMsgId, setFullReactionPickerMsgId] = useState<string | null>(null)
  // Per-reply action bar (desktop hover bar + mobile long-press sheet), so a
  // reply has the same actions as a message in the main feed. The bar's emoji
  // picker uses its own state (bar*) separate from the reaction-pill picker
  // above so the two don't fight over the shared outside-click handler.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [barPickerMsgId, setBarPickerMsgId] = useState<string | null>(null)
  const [barFullPickerMsgId, setBarFullPickerMsgId] = useState<string | null>(null)
  const [forwardingReply, setForwardingReply] = useState<Reply | null>(null)
  const [saveToFilesReply, setSaveToFilesReply] = useState<Reply | null>(null)
  const [addToBoardMsgId, setAddToBoardMsgId] = useState<string | null>(null)
  const [boardPickerBoards, setBoardPickerBoards] = useState<{ id: string; name: string }[]>([])
  const [addingToBoard, setAddingToBoard] = useState(false)
  const [actionSheetMsgId, setActionSheetMsgId] = useState<string | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)
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
    ensureEmojiData().then(() => setEmojiData(_emojiData))
  }, [])

  useEffect(() => {
    if (emojiQuery === null || emojiQuery.length === 0) { setEmojiResults([]); return }
    let cancelled = false
    ;(async () => {
      await ensureEmojiData()
      if (cancelled) return
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
    if (replyError) setReplyError(null)
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
      toast.error(err.error ?? 'Upload failed')
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
      .select('id, content, created_at, edited_at, sender:hub_users!sender_id(id, display_name, avatar_url, is_bot), files (id, filename, mime_type, size_bytes, storage_path, width_px, height_px), reactions (message_id, user_id, emoji)')
      .eq('parent_id', parentMessage.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        const rows = (data ?? []) as unknown as Reply[]
        setReplies(rows)
        setRxMap(prev => {
          const next = { ...prev }
          for (const r of rows) next[r.id] = normReactions(r.reactions)
          return next
        })
      })
  }, [parentMessage.id])

  // Parent message reactions: seed from the message passed in, then refresh in
  // case someone reacted to it after the feed loaded.
  useEffect(() => {
    setRxMap(prev => ({ ...prev, [parentMessage.id]: normReactions(parentMessage.reactions) }))
    supabase
      .from('reactions')
      .select('message_id, user_id, emoji')
      .eq('message_id', parentMessage.id)
      .then(({ data }) => {
        if (data) setRxMap(prev => ({ ...prev, [parentMessage.id]: data as unknown as RxItem[] }))
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
        .select('id, content, created_at, edited_at, sender:hub_users!sender_id(id, display_name, avatar_url, is_bot), files (id, filename, mime_type, size_bytes, storage_path, width_px, height_px), reactions (message_id, user_id, emoji)')
        .eq('id', id)
        .single()
      if (!data) return
      const reply = data as unknown as Reply
      setReplies(prev => {
        const withoutTemp = prev.filter(r => !r.id.startsWith('temp-'))
        if (withoutTemp.some(r => r.id === reply.id)) return withoutTemp
        return [...withoutTemp, reply]
      })
      setRxMap(prev => ({ ...prev, [reply.id]: normReactions(reply.reactions) }))
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
      // Live reaction sync for the parent + replies. We only touch message ids
      // already in rxMap (i.e. this thread), so other rooms' reactions are
      // ignored without needing a room filter on the reactions table.
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
  }, [parentMessage.id])

  async function sendReply() {
    const trimmed = replyContent.trim()
    if ((!trimmed && pendingFiles.length === 0) || sending) return
    setSending(true)
    setReplyError(null)
    const filesSnapshot = pendingFiles // #5 — keep for restore-on-failure
    // #5 — on failure, restore the unsent reply text + files (and drop the
    // optimistic bubble) so a thread reply is never silently lost.
    const restoreOnFailure = (tempId?: string) => {
      if (tempId) setReplies(prev => prev.filter(r => r.id !== tempId))
      setReplyContent(prev => (prev ? prev : trimmed))
      setPendingFiles(prev => (prev.length ? prev : filesSnapshot))
      setReplyError('Reply not sent — tap Send to retry.')
    }
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
      try {
        const res = await fetch('/api/hub/scheduled-messages', {
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
        if (!res.ok) throw new Error(`scheduled reply failed: ${res.status}`)
      } catch (err) {
        console.error('[thread] scheduled reply failed:', err)
        restoreOnFailure()
        setSending(false)
        return
      }
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

    try {
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
      if (!res.ok) throw new Error(`reply failed: ${res.status}`)

      // Notify the main feed so the parent's "N replies" indicator updates
      // immediately for this sender — the realtime path that should do this
      // can drop events under iOS webview suspension and the broadcast
      // subscribe-vs-send race.
      if (onReplyPosted) {
        const data = await res.clone().json().catch(() => null) as { id?: string } | null
        if (data?.id) onReplyPosted(parentMessage.id, data.id)
      }
    } catch (err) {
      console.error('[thread] reply failed:', err)
      restoreOnFailure(tempId)
      setSending(false)
      return
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

  // Close an open reaction picker when clicking anywhere outside the reaction
  // UI. Listens on mousedown so the opening click (which fires on click) is
  // never caught by the same cycle.
  useEffect(() => {
    if (!reactionPickerMsgId && !fullReactionPickerMsgId) return
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-reaction-ui]')) {
        setReactionPickerMsgId(null)
        setFullReactionPickerMsgId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [reactionPickerMsgId, fullReactionPickerMsgId])

  // Add or remove the current user's reaction. Optimistic, then persists via
  // the same endpoint the main feed uses (it toggles server-side).
  async function toggleReaction(msgId: string, emoji: string) {
    const current = rxMap[msgId] ?? []
    const mine = current.find(r => r.user_id === currentUserId && r.emoji === emoji)
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
  }

  // Reaction pills + add-reaction control for any message in the thread (the
  // parent or a reply). Mirrors the main feed's reaction UI.
  function renderReactions(msgId: string) {
    const reactions = rxMap[msgId] ?? []
    const rxGroups: Record<string, string[]> = {}
    for (const r of reactions) {
      if (!rxGroups[r.emoji]) rxGroups[r.emoji] = []
      rxGroups[r.emoji].push(r.user_id)
    }
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-1" data-reaction-ui>
        {Object.entries(rxGroups).map(([emoji, userIds]) => (
          <button
            key={emoji}
            onClick={() => toggleReaction(msgId, emoji)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
              userIds.includes(currentUserId)
                ? 'bg-brand/20 border-brand/50 text-brand'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
            }`}
          >
            <span>{emoji}</span>
            <span>{userIds.length}</span>
          </button>
        ))}
        <div className="relative">
          <button
            onClick={() => {
              setFullReactionPickerMsgId(null)
              setReactionPickerMsgId(prev => (prev === msgId ? null : msgId))
            }}
            className="text-gray-500 hover:text-gray-300 w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-800 text-sm opacity-70 hover:opacity-100"
            title="Add reaction"
            aria-label="Add reaction"
          >
            😊
          </button>
          {reactionPickerMsgId === msgId && (
            <div
              className="absolute bottom-full left-0 mb-1 z-50 flex items-center gap-0.5 bg-gray-900 border border-gray-700 rounded-full shadow-2xl px-1 py-0.5"
              onClick={e => e.stopPropagation()}
            >
              {['✅', '👍', '👀'].map(emoji => (
                <button
                  key={emoji}
                  onClick={() => { toggleReaction(msgId, emoji); setReactionPickerMsgId(null) }}
                  className="w-8 h-8 flex items-center justify-center text-base rounded-full hover:bg-gray-800"
                  title={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
              <button
                onClick={() => { setReactionPickerMsgId(null); setFullReactionPickerMsgId(msgId) }}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-800 text-gray-400"
                title="More reactions"
                aria-label="More reactions"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
          )}
          {fullReactionPickerMsgId === msgId && (
            <EmojiPicker
              align="left"
              onSelect={emoji => toggleReaction(msgId, emoji)}
              onClose={() => setFullReactionPickerMsgId(null)}
            />
          )}
        </div>
      </div>
    )
  }

  // Pills-only reaction render for replies — a reply's add-reaction entry point
  // lives in its hover bar / long-press sheet (like the main feed), so we don't
  // also show the persistent 😊 button that renderReactions() adds.
  function renderReactionPills(msgId: string) {
    const reactions = rxMap[msgId] ?? []
    if (reactions.length === 0) return null
    const rxGroups: Record<string, string[]> = {}
    for (const r of reactions) {
      if (!rxGroups[r.emoji]) rxGroups[r.emoji] = []
      rxGroups[r.emoji].push(r.user_id)
    }
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {Object.entries(rxGroups).map(([emoji, userIds]) => (
          <button
            key={emoji}
            onClick={() => toggleReaction(msgId, emoji)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
              userIds.includes(currentUserId)
                ? 'bg-brand/20 border-brand/50 text-brand'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
            }`}
          >
            <span>{emoji}</span>
            <span>{userIds.length}</span>
          </button>
        ))}
      </div>
    )
  }

  // Edit a reply. Optimistic — the thread's realtime channel only subscribes to
  // INSERTs (not UPDATEs), so the local list is the source of truth here.
  async function saveReplyEdit(msgId: string) {
    const trimmed = editContent.trim()
    if (!trimmed) return
    setReplies(prev => prev.map(r => (r.id === msgId ? { ...r, content: trimmed, edited_at: new Date().toISOString() } : r)))
    setEditingId(null)
    await fetch(`/api/hub/messages/${msgId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: trimmed }),
    })
  }

  // Delete a reply — own message, or any message if admin (same rule as the
  // main feed). Confirm first, then drop it from the local list on success.
  async function deleteReply(msgId: string) {
    if (!(await confirmDialog({ message: 'Delete this message?', danger: true }))) return
    const res = await fetch(`/api/hub/messages/${msgId}`, { method: 'DELETE' })
    if (res.ok) setReplies(prev => prev.filter(r => r.id !== msgId))
  }

  async function handleForward(target: ForwardTarget, comment: string) {
    if (!forwardingReply) return
    const files = normFiles(forwardingReply.files)
    const body: Record<string, unknown> = { forwarded_from: forwardingReply.id, content: comment }
    if (target.type === 'room') body.room_id = target.id
    else body.conversation_id = target.id
    if (files.length > 0) {
      body.files = files.map(f => ({
        storage_path: f.storage_path,
        filename: f.filename,
        mime_type: f.mime_type,
        size_bytes: f.size_bytes,
        width_px: f.width_px ?? null,
        height_px: f.height_px ?? null,
      }))
    }
    await fetch('/api/hub/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setForwardingReply(null)
  }

  function openBoardPicker(msgId: string) {
    setAddToBoardMsgId(msgId)
    fetch('/api/hub/boards')
      .then(r => r.json())
      .then(d => setBoardPickerBoards(d.boards ?? []))
      .catch(() => {})
  }

  async function addToBoard(boardId: string, reply: Reply) {
    setAddingToBoard(true)
    await fetch(`/api/hub/boards/${boardId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: reply.content, forwarded_from_message_id: reply.id }),
    })
    setAddingToBoard(false)
    setAddToBoardMsgId(null)
  }

  function startLongPress(msgId: string) {
    longPressFired.current = false
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      setActionSheetMsgId(msgId)
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(10)
    }, 500)
  }

  function cancelLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
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
      {/* Compact header. On mobile the thread is a full-screen takeover (the
          room-name bar is hidden underneath), so the back arrow returns to the
          feed; on desktop it collapses the side panel. The overlay is
          `fixed inset-0` on mobile, so it covers HubShell's safe-area spacer —
          pad the top by the iOS inset ourselves or the back arrow lands under
          the status bar in the native app (env() is 0 on desktop/PWA, no-op). */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-800 flex-none"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.625rem)' }}
      >
        <button
          onClick={onClose}
          aria-label="Close thread"
          className="text-gray-400 hover:text-white transition-colors w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-800 flex-none"
        >
          <svg className="w-5 h-5 md:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          <span className="hidden md:block text-base leading-none">✕</span>
        </button>
        <span className="font-semibold text-sm text-white">Thread</span>
        {replies.length > 0 && (
          <span className="text-xs text-gray-500">· {replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
        )}
        <div className="flex-1" />
        {/* Desktop-only Expand → full toggle. Drag-resize still works; this just
            snaps the panel to fill the pane (and back). Hidden on mobile, where
            the thread is already a full-screen takeover. */}
        {onToggleExpand && (
          <button
            onClick={onToggleExpand}
            aria-label={expanded ? 'Collapse thread' : 'Expand thread'}
            title={expanded ? 'Collapse' : 'Expand'}
            className="hidden md:flex text-gray-400 hover:text-white transition-colors w-7 h-7 items-center justify-center rounded-lg hover:bg-gray-800 flex-none"
          >
            {expanded ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Scrollable area — the original message is now the first item here (not
          a fixed bar), so it scrolls up out of the way as you read replies,
          giving the reply pane more room. */}
      <div className="flex-1 overflow-y-auto w-full px-4 py-4 space-y-5">
        {/* Original message */}
        <div className="flex items-start gap-3 pb-4 border-b border-gray-800/70">
          <Avatar sender={parentSender} />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="font-semibold text-sm text-white">{parentSender?.display_name ?? 'Unknown'}</span>
              <span className="text-xs text-gray-600">{formatTime(parentMessage.created_at)}</span>
            </div>
            <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap break-words">
              {renderContent(parentMessage.content, hubUsers)}
            </p>
            {renderReactions(parentMessage.id)}
          </div>
        </div>

        {replies.length === 0 && (
          <p className="text-sm text-gray-600 text-center py-4">No replies yet — be the first!</p>
        )}
        {replies.map(reply => {
          const sender = normSender(reply.sender)
          const files = normFiles(reply.files)
          const isOwn = sender?.id === currentUserId
          const isEditing = editingId === reply.id
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
                // PDFs are read as bytes by the in-app pdf.js viewer (same-origin,
                // no CORS); images load via the redirect. Download uses the redirect.
                src: isPdf && !f.localUrl ? `/api/hub/files/${f.id}?inline=pdf` : (f.localUrl ?? `/api/hub/files/${f.id}`),
                downloadSrc: f.localUrl ?? `/api/hub/files/${f.id}`,
                filename: f.filename,
              })
            }
          }
          return (
            <div
              key={reply.id}
              className="group relative flex items-start gap-3 rounded transition-colors hover:bg-gray-900/40 select-none md:select-text"
              onTouchStart={() => { if (!isEditing) startLongPress(reply.id) }}
              onTouchMove={cancelLongPress}
              onTouchEnd={cancelLongPress}
              onTouchCancel={cancelLongPress}
              onContextMenu={e => e.preventDefault()}
              style={{ touchAction: 'pan-y', WebkitTouchCallout: 'none' }}
            >
              <Avatar sender={sender} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="font-semibold text-sm text-white">{sender?.display_name ?? 'Unknown'}</span>
                  <span className="text-xs text-gray-600">{formatTime(reply.created_at)}</span>
                </div>
                {isEditing ? (
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveReplyEdit(reply.id) }
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white outline-none focus:border-brand"
                    />
                    <button onClick={() => saveReplyEdit(reply.id)} className="text-xs text-brand hover:text-blue-300 px-2">Save</button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 hover:text-gray-300 px-2">Cancel</button>
                  </div>
                ) : (
                  reply.content && reply.content.trim() && (
                    <p className="hub-message-text text-lg md:text-sm text-gray-200 leading-relaxed whitespace-pre-wrap break-words">
                      {renderContent(reply.content, hubUsers)}
                      {reply.edited_at && <span className="ml-1 text-xs text-gray-600">(edited)</span>}
                    </p>
                  )
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
                {renderReactionPills(reply.id)}
              </div>

              {/* Desktop hover actions — mobile uses long-press → the sheet
                  below. Mirrors the main feed's bar, minus "Reply in thread"
                  (we're already in the thread). */}
              {!isEditing && (
                <div
                  className="flex-none gap-0.5 relative hidden md:flex opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="relative">
                    <button
                      onClick={() => { setBarFullPickerMsgId(null); setBarPickerMsgId(barPickerMsgId === reply.id ? null : reply.id) }}
                      className="text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-800 text-sm"
                      title="Add reaction"
                    >
                      😊
                    </button>
                    {barPickerMsgId === reply.id && (
                      <div
                        className="absolute bottom-full right-0 mb-1 z-50 flex items-center gap-0.5 bg-gray-900 border border-gray-700 rounded-full shadow-2xl px-1 py-0.5"
                        onClick={e => e.stopPropagation()}
                      >
                        {['✅', '👍', '👀'].map(emoji => (
                          <button
                            key={emoji}
                            onClick={() => { toggleReaction(reply.id, emoji); setBarPickerMsgId(null) }}
                            className="w-8 h-8 flex items-center justify-center text-base rounded-full hover:bg-gray-800"
                            title={`React with ${emoji}`}
                          >
                            {emoji}
                          </button>
                        ))}
                        <button
                          onClick={() => { setBarPickerMsgId(null); setBarFullPickerMsgId(reply.id) }}
                          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-800 text-gray-400"
                          title="More reactions"
                          aria-label="More reactions"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                          </svg>
                        </button>
                      </div>
                    )}
                    {barFullPickerMsgId === reply.id && (
                      <EmojiPicker
                        onSelect={emoji => toggleReaction(reply.id, emoji)}
                        onClose={() => setBarFullPickerMsgId(null)}
                      />
                    )}
                  </div>

                  <button
                    onClick={() => setForwardingReply(reply)}
                    className="text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-800 text-xs"
                    title="Forward message"
                  >
                    ↗
                  </button>

                  {files.some(f => f.mime_type.startsWith('image/')) && (
                    <button
                      onClick={() => setSaveToFilesReply(reply)}
                      className="text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-800 text-sm"
                      title="Save to Files"
                    >
                      📁
                    </button>
                  )}

                  <div className="relative">
                    <button
                      onClick={() => (addToBoardMsgId === reply.id ? setAddToBoardMsgId(null) : openBoardPicker(reply.id))}
                      className="text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-800 text-xs"
                      title="Add to Board"
                    >
                      ☑
                    </button>
                    {addToBoardMsgId === reply.id && (
                      <div className="absolute right-0 top-9 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl py-1 min-w-[180px]" onClick={e => e.stopPropagation()}>
                        <div className="px-3 py-1.5 text-xs text-white/40 font-semibold uppercase tracking-wider border-b border-gray-800">Add to Board</div>
                        {boardPickerBoards.length === 0 && (
                          <p className="px-3 py-2 text-xs text-gray-500">No boards yet</p>
                        )}
                        {boardPickerBoards.map(board => (
                          <button
                            key={board.id}
                            disabled={addingToBoard}
                            onClick={() => addToBoard(board.id, reply)}
                            className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-800 transition-colors"
                          >
                            {board.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {isOwn && (
                    <button
                      onClick={() => { setEditingId(reply.id); setEditContent(reply.content) }}
                      className="text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-800 text-xs"
                      title="Edit"
                    >
                      ✏️
                    </button>
                  )}
                  {(isOwn || isAdmin) && (
                    <button
                      onClick={() => deleteReply(reply.id)}
                      className="text-gray-500 hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-gray-800 text-xs"
                      title="Delete"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              )}
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
                  aria-label="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
            {uploading && (
              <div className="w-16 h-16 bg-gray-800 border border-gray-700 rounded-lg flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
        )}

        {/* Uploading banner — prominent while an attachment is still uploading. */}
        {uploading && (
          <div className="mb-2 px-3 py-2 bg-brand/10 border border-brand/30 rounded-lg flex items-center gap-2.5 text-xs text-[#9cc7e6]">
            <div className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin flex-none" />
            <span>Uploading attachment… please wait before sending.</span>
          </div>
        )}

        {/* #5 — reply send failed: text + files restored above, offer retry. */}
        {replyError && (
          <div className="mb-2 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-1.5">
            {replyError}
          </div>
        )}

        {/* Scheduled send indicator */}
        {scheduledAt && (
          <div className="mb-2 px-3 py-2 bg-brand/10 border border-brand/30 rounded-lg flex items-center justify-between text-xs text-brand">
            <span>
              🕐 Scheduled for {new Date(scheduledAt).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
            <button onClick={() => { setScheduledAt(''); setShowScheduler(false) }} className="text-brand/60 hover:text-brand ml-2" aria-label="Remove">✕</button>
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
                  i === emojiIndex ? 'bg-brand/20 text-white' : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                <span className="text-xl flex-none w-6 text-center">{emoji.native}</span>
                <span className="text-gray-400">:{emoji.id}:</span>
                <span className="ml-auto text-xs text-gray-500 truncate">{emoji.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 focus-within:border-brand transition-colors flex items-start gap-2">
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
            {showEmojiPicker && !!emojiData && (
              <div className="absolute bottom-full left-0 mb-2 z-50">
                <EmojiMartPicker
                  data={emojiData}
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
                scheduledAt ? 'text-brand' : 'text-gray-500 hover:text-gray-300'
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
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-base md:text-sm text-white outline-none focus:border-brand"
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
            disabled={!hasContent || sending || uploading}
            className={`text-xs disabled:opacity-30 text-white px-3 py-1.5 rounded-lg transition-colors ${
              scheduledAt ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-brand hover:bg-brand-hover'
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

      {forwardingReply && (
        <ForwardModal
          currentUserId={currentUserId}
          messagePreview={forwardingReply.content}
          onClose={() => setForwardingReply(null)}
          onForward={handleForward}
        />
      )}

      {saveToFilesReply && (
        <SaveToFilesModal
          attachments={normFiles(saveToFilesReply.files)}
          onClose={() => setSaveToFilesReply(null)}
        />
      )}

      {/* Mobile long-press action sheet for a reply. */}
      {actionSheetMsgId && (() => {
        const reply = replies.find(r => r.id === actionSheetMsgId)
        if (!reply) return null
        const s = normSender(reply.sender)
        const isOwn = s?.id === currentUserId
        const files = normFiles(reply.files)
        return (
          <MessageActionsSheet
            hasText={!!reply.content?.trim()}
            hasImages={files.some(f => f.mime_type.startsWith('image/'))}
            isOwn={isOwn}
            isAdmin={!!isAdmin}
            hasOnOpenThread={false}
            onClose={() => setActionSheetMsgId(null)}
            onCopy={() => { navigator.clipboard?.writeText(reply.content ?? '').catch(() => {}) }}
            onAddReaction={emoji => toggleReaction(reply.id, emoji)}
            onForward={() => setForwardingReply(reply)}
            onSaveToFiles={() => setSaveToFilesReply(reply)}
            onAddToBoard={() => openBoardPicker(reply.id)}
            onOpenThread={() => {}}
            onEdit={() => { setEditingId(reply.id); setEditContent(reply.content) }}
            onDelete={() => deleteReply(reply.id)}
          />
        )
      })()}

      {/* Mobile board picker — desktop uses the inline dropdown in the hover bar. */}
      {addToBoardMsgId && (
        <div className="fixed inset-0 z-50 md:hidden flex items-end" onClick={() => setAddToBoardMsgId(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative w-full bg-gray-900 border-t border-gray-800 rounded-t-2xl shadow-2xl"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-700" />
            </div>
            <div className="px-5 py-2 text-xs text-white/40 font-semibold uppercase tracking-wider border-b border-gray-800">
              Add to Board
            </div>
            {boardPickerBoards.length === 0 ? (
              <p className="px-5 py-4 text-sm text-gray-500">No boards yet</p>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto">
                {boardPickerBoards.map(board => (
                  <button
                    key={board.id}
                    disabled={addingToBoard}
                    onClick={() => {
                      const reply = replies.find(r => r.id === addToBoardMsgId)
                      if (reply) addToBoard(board.id, reply)
                    }}
                    className="w-full text-left px-5 py-3.5 text-base text-gray-100 active:bg-gray-800 transition-colors disabled:opacity-50"
                  >
                    {board.name}
                  </button>
                ))}
              </div>
            )}
            <div className="border-t border-gray-800 px-4 py-1">
              <button
                onClick={() => setAddToBoardMsgId(null)}
                className="w-full py-3 text-base text-gray-400 active:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
