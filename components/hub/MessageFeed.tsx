'use client'

import { useEffect, useLayoutEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import { createClient } from '@/lib/supabase/client'
import EmojiPicker from './EmojiPicker'
import ForwardModal, { type ForwardTarget } from './ForwardModal'
import SaveToFilesModal from './SaveToFilesModal'
import MessageActionsSheet from './MessageActionsSheet'
import MediaLightbox, { type LightboxItem } from './MediaLightbox'
import { renderContent } from './renderContent'
import {
  saveMessages,
  getMessages,
  patchMessage,
  deleteMessage as cacheDeleteMessage,
  saveMembers,
  saveReadReceipts,
} from '@/lib/hub-cache'

export type MessageFeedHandle = { addMessage: (msg: HubMessage) => void }

export type HubUser = { id: string; display_name: string; avatar_url: string | null; is_bot?: boolean; status?: string | null; effective_status?: string | null }
export type RxItem = { user_id: string; emoji: string }
export type FileItem = { id: string; filename: string; mime_type: string; size_bytes: number; storage_path: string; width_px?: number | null; height_px?: number | null; localUrl?: string }
export type Sender = HubUser
export type ForwardedOriginal = {
  id: string
  content: string
  room_id: string | null
  conversation_id: string | null
  sender: { display_name: string } | null
}
export type HubMessage = {
  id: string
  content: string
  created_at: string
  edited_at: string | null
  parent_id: string | null
  room_id?: string | null
  conversation_id?: string | null
  forwarded_from?: string | null
  forwarded_original?: ForwardedOriginal | null
  sender: Sender | Sender[] | null
  reactions?: RxItem[]
  files?: FileItem[]
  reply_count?: number
  source?: string | null
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
  if (sender.avatar_url) return <img src={`/api/profile/avatar/${sender.id}`} alt="" className="w-8 h-8 rounded-full flex-none object-cover" />
  const initials = sender.display_name.slice(0, 2).toUpperCase()
  return (
    <div className={`w-8 h-8 rounded-full flex-none flex items-center justify-center text-xs font-bold text-white ${sender.is_bot ? 'bg-[#2E7EB8]' : 'bg-gray-600'}`}>
      {initials}
    </div>
  )
}

// Layout constraints for chat image thumbnails — must match the CSS below.
const THUMB_MAX_W = 320 // max-w-xs = 20rem = 320px
const THUMB_MAX_H = 256 // max-h-64 = 16rem = 256px

// Compute the rendered box for a thumbnail given the source's intrinsic
// dimensions. Preserves aspect ratio, fits inside (THUMB_MAX_W × THUMB_MAX_H).
function fitThumbnail(w: number, h: number): { width: number; height: number } {
  const ratio = Math.min(THUMB_MAX_W / w, THUMB_MAX_H / h, 1)
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) }
}

function FileAttachment({ file, onOpenLightbox }: { file: FileItem; onOpenLightbox?: () => void }) {
  // Optimistic-send rows have a `localUrl` blob URL and a temp id; use
  // the blob URL until realtime delivers the row with a real DB id.
  const src = file.localUrl ?? `/api/hub/files/${file.id}`
  const size = formatBytes(file.size_bytes)

  if (file.mime_type.startsWith('image/')) {
    const hasDims = file.width_px != null && file.height_px != null && file.width_px > 0 && file.height_px > 0
    const box = hasDims ? fitThumbnail(file.width_px!, file.height_px!) : null

    // Lazy backfill: legacy image rows (uploaded before Session 47 image-dims
    // shipped) have null width/height. Once the browser decodes the image we
    // know the natural dimensions — PATCH them back to the DB so future
    // renders see the right aspect ratio from the first paint. Skip for
    // optimistic temp rows (no real DB id yet) and rows that already have
    // dimensions stored.
    const onImgLoad: React.ReactEventHandler<HTMLImageElement> = (e) => {
      if (hasDims) return
      if (file.id.startsWith('temp-')) return
      const img = e.currentTarget
      const w = img.naturalWidth
      const h = img.naturalHeight
      if (!w || !h) return
      fetch(`/api/hub/files/${file.id}/dimensions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ width_px: w, height_px: h }),
      }).catch(() => {})
    }

    return (
      <button
        type="button"
        onClick={onOpenLightbox}
        className="block p-0 border-0 bg-transparent"
        aria-label={`Open ${file.filename}`}
        style={box ? { width: box.width, height: box.height } : undefined}
      >
        <img
          src={src}
          alt={file.filename}
          width={box?.width}
          height={box?.height}
          loading="lazy"
          decoding="async"
          onLoad={onImgLoad}
          className="rounded-lg mt-1.5 border border-gray-700 hover:border-gray-500 transition-colors cursor-pointer object-cover max-w-xs max-h-64"
          style={box ? { width: box.width, height: box.height } : undefined}
        />
      </button>
    )
  }

  if (file.mime_type.startsWith('video/')) {
    return (
      <video
        src={src}
        controls
        preload="metadata"
        playsInline
        className="max-w-xs max-h-64 rounded-lg mt-1.5 border border-gray-700 bg-black"
      >
        {file.filename}
      </video>
    )
  }

  if (file.mime_type === 'application/pdf' && onOpenLightbox) {
    return (
      <button
        type="button"
        onClick={onOpenLightbox}
        className="flex items-center gap-2.5 bg-gray-800 border border-gray-700 hover:border-gray-600 rounded-lg px-3 py-2 mt-1.5 text-sm text-gray-300 max-w-xs transition-colors text-left"
      >
        <span className="text-xl">📄</span>
        <div className="min-w-0">
          <div className="truncate text-white text-xs font-medium">{file.filename}</div>
          <div className="text-xs text-gray-500">{size}</div>
        </div>
      </button>
    )
  }

  // Fallback: download link for any other file type
  return (
    <a href={src} target="_blank" rel="noopener" download={file.filename} className="flex items-center gap-2.5 bg-gray-800 border border-gray-700 hover:border-gray-600 rounded-lg px-3 py-2 mt-1.5 text-sm text-gray-300 max-w-xs transition-colors">
      <span className="text-xl">📎</span>
      <div className="min-w-0">
        <div className="truncate text-white text-xs font-medium">{file.filename}</div>
        <div className="text-xs text-gray-500">{size}</div>
      </div>
    </a>
  )
}

function ForwardedBanner({ original, rooms, hubUsers }: { original: ForwardedOriginal; rooms?: { id: string; name: string }[]; hubUsers: HubUser[] }) {
  const roomName = rooms?.find(r => r.id === original.room_id)?.name
  const source = roomName ? `#${roomName}` : original.conversation_id ? 'a DM' : 'another conversation'
  const senderName = original.sender?.display_name ?? 'Unknown'
  return (
    <div className="mt-1 mb-1.5 border-l-2 border-gray-600 pl-3 rounded-r-lg bg-gray-800/40 py-1.5 pr-3">
      <div className="text-xs text-gray-500 mb-0.5">
        ↗ Forwarded from {source} · {senderName}
      </div>
      <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap break-words line-clamp-4">
        {original.content ? renderContent(original.content, hubUsers) : <span className="italic text-gray-500">Attachment</span>}
      </p>
    </div>
  )
}

const MessageFeed = forwardRef<MessageFeedHandle, {
  roomId?: string
  conversationId?: string
  initialMessages: HubMessage[]
  currentUserId: string
  hubUsers: HubUser[]
  isAdmin?: boolean
  onOpenThread?: (msg: HubMessage) => void
  openThreadMsgId?: string | null
  rooms?: { id: string; name: string }[]
  // DM-only: members of this conversation and their read receipts.
  // Drives the "Read by..." indicator under the user's latest self-send.
  conversationMembers?: HubUser[]
  initialMemberReadReceipts?: { user_id: string; last_read_at: string }[]
}>(function MessageFeed({
  roomId,
  conversationId,
  initialMessages,
  currentUserId,
  hubUsers,
  isAdmin,
  onOpenThread,
  openThreadMsgId,
  rooms,
  conversationMembers,
  initialMemberReadReceipts,
}, ref) {
  // Message bubbles inherit size from root font-size (S/M/L on <html>) via
  // the same `text-lg md:text-sm` class the sidebar uses — no per-size
  // override here, so sidebar and messages stay visually in sync.

  const [messages, setMessages] = useState<HubMessage[]>(initialMessages)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [pickerMsgId, setPickerMsgId] = useState<string | null>(null)
  const [fullPickerMsgId, setFullPickerMsgId] = useState<string | null>(null)
  const [forwardingMsg, setForwardingMsg] = useState<HubMessage | null>(null)
  const [saveToFilesMsg, setSaveToFilesMsg] = useState<HubMessage | null>(null)
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null)
  const [addToBoardMsgId, setAddToBoardMsgId] = useState<string | null>(null)
  const [boardPickerBoards, setBoardPickerBoards] = useState<{ id: string; name: string }[]>([])
  const [addingToBoard, setAddingToBoard] = useState(false)
  const [tappedMsgId, setTappedMsgId] = useState<string | null>(null)
  const [actionSheetMsgId, setActionSheetMsgId] = useState<string | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)
  const [rxMap, setRxMap] = useState<Record<string, RxItem[]>>(() => {
    const map: Record<string, RxItem[]> = {}
    for (const m of initialMessages) map[m.id] = normReactions(m.reactions)
    return map
  })
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    for (const m of initialMessages) map[m.id] = m.reply_count ?? 0
    return map
  })
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // Hide the scroll container for the brief window between first render and
  // the initial scroll-to-bottom pin. Without this, the user sees the list
  // paint at scrollTop=0 and then jump down — the long-standing "scroll
  // glitch." useLayoutEffect below flips ready=true synchronously before the
  // browser paints, so the first visible paint is already pinned to the bottom.
  const [feedReady, setFeedReady] = useState(false)
  const supabase = createClient()

  // Read receipts for other members of this DM (DMs only — rooms are
  // Slack-style: no read receipts). Keyed by user_id → last_read_at ISO.
  const [memberReceipts, setMemberReceipts] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const r of initialMemberReadReceipts ?? []) map[r.user_id] = r.last_read_at
    return map
  })

  // Latest top-level message authored by the current user in this feed —
  // the indicator anchors here. Falls back to null when there are no
  // self-sent messages yet.
  const latestSelfMsg = (() => {
    if (!conversationId) return null
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.parent_id) continue
      const sender = normSender(m.sender)
      if (sender?.id === currentUserId) return m
    }
    return null
  })()

  // Build the "Read by ..." label. Excludes self + bots. Returns null
  // when no other member has read up to this message.
  function readersLabelFor(msgCreatedAt: string): string | null {
    if (!conversationId || !conversationMembers) return null
    const others = conversationMembers.filter(m => m.id !== currentUserId && !m.is_bot)
    if (others.length === 0) return null
    const readers = others.filter(m => {
      const rr = memberReceipts[m.id]
      return rr && rr >= msgCreatedAt
    })
    if (readers.length === 0) return null
    // 1-on-1 — no need to name the single other person.
    if (others.length === 1) return 'Read'
    // Group — name up to two readers, then "& N more".
    if (readers.length === others.length) return 'Read by everyone'
    const names = readers.map(r => r.display_name.split(' ')[0])
    if (names.length === 1) return `Read by ${names[0]}`
    if (names.length === 2) return `Read by ${names[0]} & ${names[1]}`
    return `Read by ${names[0]}, ${names[1]} & ${names.length - 2} more`
  }

  useImperativeHandle(ref, () => ({
    addMessage(msg: HubMessage) {
      setMessages(prev => {
        const idx = prev.findIndex(m => m.id === msg.id)
        if (idx >= 0) {
          // Race: if realtime already delivered this message with real
          // DB file rows, don't let an optimistic insert (temp ids +
          // blob URLs) clobber them.
          const existing = prev[idx]
          const existingHasRealFiles = (existing.files ?? []).some(f => !f.id.startsWith('temp-'))
          const incomingHasTempFiles = (msg.files ?? []).some(f => f.id.startsWith('temp-'))
          const merged = existingHasRealFiles && incomingHasTempFiles
            ? { ...msg, files: existing.files }
            : msg
          const next = [...prev]
          next[idx] = merged
          return next
        }
        return [...prev, msg]
      })
      setRxMap(prev => ({ ...prev, [msg.id]: normReactions(msg.reactions) }))
      // Skip caching optimistic rows with temp file ids — realtime delivery
      // of the real row will overwrite the cache moments later. Caching the
      // temp row would persist blob URLs that won't resolve on next entry.
      const hasTempFiles = (msg.files ?? []).some(f => f.id.startsWith('temp-'))
      if (!hasTempFiles) patchMessage(msg)
    },
  }))

  // Initial paint: jump to bottom instantly before the browser paints, so the
  // user never sees the list render from the top and animate down. Subsequent
  // message arrivals keep the smooth-scroll behavior below.
  //
  // Images load asynchronously and grow scrollHeight after our initial jump,
  // landing the user above the true bottom on first entry. Re-pin via a
  // ResizeObserver for ~2s after mount (covers image decode + layout), and
  // also listen for image load events directly so we don't have to throttle.
  useLayoutEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    let pinning = true
    const pin = () => { if (pinning) el.scrollTop = el.scrollHeight }
    pin()

    // Reveal logic — keep visibility:hidden until either (a) all images
    // in the visible message set have settled (warm cache resolves this
    // synchronously, cold cache resolves it after network), or (b) a
    // 1500ms cap fires so we never hang forever on a slow/broken image.
    // This is what kills the "scroll jump as images load" glitch on
    // cold-cache room entries.
    let revealed = false
    const reveal = () => {
      if (revealed) return
      revealed = true
      pin() // one last pin right before the user sees anything
      setFeedReady(true)
    }

    const imgs = Array.from(el.querySelectorAll('img'))
    let pending = imgs.filter(img => !(img.complete && img.naturalHeight !== 0)).length
    if (pending === 0) {
      // Warm cache: every image is already decoded. Reveal now so React's
      // re-render lands before the browser paints — first paint is correct.
      reveal()
    }
    const onImgSettled = () => {
      pin()
      pending -= 1
      if (pending <= 0) reveal()
    }
    imgs.forEach(img => {
      if (img.complete && img.naturalHeight !== 0) return
      img.addEventListener('load', onImgSettled, { once: true })
      img.addEventListener('error', onImgSettled, { once: true })
    })
    // Cap: reveal no later than 1500ms regardless of image state so a slow
    // attachment never blocks the whole feed from appearing.
    const revealCap = setTimeout(reveal, 1500)

    // Belt-and-suspenders: multiple async re-pins in case layout settles late.
    const timers = [0, 50, 150, 400, 900, 1800].map(ms => setTimeout(pin, ms))
    const ro = new ResizeObserver(pin)
    ro.observe(el)
    const stopAt = setTimeout(() => { pinning = false; ro.disconnect() }, 2500)
    return () => {
      pinning = false
      clearTimeout(revealCap)
      timers.forEach(clearTimeout)
      clearTimeout(stopAt)
      ro.disconnect()
      imgs.forEach(img => {
        img.removeEventListener('load', onImgSettled)
        img.removeEventListener('error', onImgSettled)
      })
    }
  }, [])

  useEffect(() => {
    // Snap to bottom on new messages (own send or incoming). Direct scrollTop
    // assignment is cheaper than scrollTo({behavior:'smooth'}) and feels
    // snappier — the smooth-scroll animation cost ~16 frames per message,
    // visible on slower devices when the room is busy.
    const el = scrollContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  // Persist conversation members + initial read receipts (DMs only) to cache
  // so the next entry can hydrate them instantly. The realtime receipts
  // channel below keeps the cache current after that.
  useEffect(() => {
    if (!conversationId) return
    if (conversationMembers && conversationMembers.length) {
      saveMembers(conversationId, conversationMembers)
    }
    if (initialMemberReadReceipts && initialMemberReadReceipts.length) {
      saveReadReceipts(conversationId, initialMemberReadReceipts)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  // Persist initialMessages (the server-rendered top-level set) to the Hub
  // cache so the next entry into this scope can hydrate instantly. Best-effort.
  // If initialMessages is empty (rare — server fetch returned nothing), try to
  // hydrate from cache as a fallback so the user sees prior history while a
  // background fetch is presumably running elsewhere.
  useEffect(() => {
    const scope: 'room' | 'conv' | null = roomId ? 'room' : conversationId ? 'conv' : null
    const scopeId = roomId ?? conversationId ?? null
    if (!scope || !scopeId) return
    if (initialMessages.length > 0) {
      saveMessages(scope, scopeId, initialMessages)
      return
    }
    let cancelled = false
    ;(async () => {
      const cached = await getMessages(scope, scopeId)
      if (cancelled || !cached || !cached.length) return
      setMessages(prev => (prev.length === 0 ? cached : prev))
      setRxMap(prev => {
        if (Object.keys(prev).length > 0) return prev
        const map: Record<string, RxItem[]> = {}
        for (const m of cached) map[m.id] = normReactions(m.reactions)
        return map
      })
      setReplyCounts(prev => {
        if (Object.keys(prev).length > 0) return prev
        const map: Record<string, number> = {}
        for (const m of cached) map[m.id] = m.reply_count ?? 0
        return map
      })
    })()
    return () => { cancelled = true }
    // initialMessages is captured by reference from the server fetch; it does
    // not change for the lifetime of this scope. Intentionally exclude it from
    // deps so we don't re-write the cache on every realtime state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, conversationId])

  // Realtime: messages
  useEffect(() => {
    const filter = roomId
      ? `room_id=eq.${roomId}`
      : `conversation_id=eq.${conversationId}`

    const channel = supabase
      .channel(`feed:${roomId ?? conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter }, async (payload) => {
        if (payload.new.parent_id) {
          setReplyCounts(prev => ({
            ...prev,
            [payload.new.parent_id]: (prev[payload.new.parent_id] ?? 0) + 1,
          }))
          return
        }
        // If someone else just sent a message into the conversation
        // we're actively viewing, advance our read receipt immediately
        // so the sender sees "Read" without us leaving and re-entering.
        // (The sidebar pathname effect only fires on NAVIGATE INTO,
        // not on incoming messages while we're already here.)
        if (payload.new.sender_id !== currentUserId) {
          fetch('/api/hub/read-receipts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(roomId ? { room_id: roomId } : { conversation_id: conversationId }),
          }).catch(() => {})
        }
        const { data } = await supabase
          .from('messages')
          .select(`id, content, created_at, edited_at, parent_id, room_id, conversation_id, forwarded_from,
            sender:hub_users!sender_id (id, display_name, avatar_url, is_bot),
            reactions (message_id, user_id, emoji),
            files (id, filename, mime_type, size_bytes, storage_path, width_px, height_px)`)
          .eq('id', payload.new.id)
          .single()
        if (data) {
          const msg = data as unknown as HubMessage
          if (msg.forwarded_from) {
            const { data: orig } = await supabase
              .from('messages')
              .select('id, content, room_id, conversation_id, sender:hub_users!sender_id (display_name)')
              .eq('id', msg.forwarded_from)
              .single()
            if (orig) {
              const o = orig as { id: string; content: string; room_id: string | null; conversation_id: string | null; sender: { display_name: string } | { display_name: string }[] | null }
              msg.forwarded_original = { ...o, sender: Array.isArray(o.sender) ? o.sender[0] : o.sender }
            }
          }
          // Replace optimistic message (if present) with full server version including files
          setMessages(prev => {
            const idx = prev.findIndex(m => m.id === msg.id)
            if (idx >= 0) { const next = [...prev]; next[idx] = msg; return next }
            return [...prev, msg]
          })
          setRxMap(prev => ({ ...prev, [msg.id]: normReactions(msg.reactions) }))
          patchMessage(msg)
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter }, (payload) => {
        const u = payload.new as { id: string; content: string; edited_at: string; deleted_at: string | null }
        if (u.deleted_at) {
          setMessages(prev => prev.filter(m => m.id !== u.id))
          cacheDeleteMessage(u.id)
        } else {
          setMessages(prev => {
            const next = prev.map(m => m.id === u.id ? { ...m, content: u.content, edited_at: u.edited_at } : m)
            const updated = next.find(m => m.id === u.id)
            if (updated) patchMessage(updated)
            return next
          })
        }
      })
      // Fallback path for INSERT — Chat Synx events route (and any other
      // admin-client writer) fires this broadcast after inserting, so an
      // open MessageFeed picks it up even if postgres_changes drops the WAL
      // event. setMessages dedupes by id so receiving both is harmless.
      .on('broadcast', { event: 'message-inserted' }, async (payload) => {
        const p = (payload.payload ?? {}) as { id?: string; parent_id?: string | null; sender_id?: string }
        if (!p.id) return
        if (p.parent_id) {
          setReplyCounts(prev => ({ ...prev, [p.parent_id!]: (prev[p.parent_id!] ?? 0) + 1 }))
          return
        }
        if (p.sender_id && p.sender_id !== currentUserId) {
          fetch('/api/hub/read-receipts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(roomId ? { room_id: roomId } : { conversation_id: conversationId }),
          }).catch(() => {})
        }
        const { data } = await supabase
          .from('messages')
          .select(`id, content, created_at, edited_at, parent_id, room_id, conversation_id, forwarded_from,
            sender:hub_users!sender_id (id, display_name, avatar_url, is_bot),
            reactions (message_id, user_id, emoji),
            files (id, filename, mime_type, size_bytes, storage_path, width_px, height_px)`)
          .eq('id', p.id)
          .single()
        if (!data) return
        const msg = data as unknown as HubMessage
        setMessages(prev => {
          const idx = prev.findIndex(m => m.id === msg.id)
          if (idx >= 0) { const next = [...prev]; next[idx] = msg; return next }
          return [...prev, msg]
        })
        setRxMap(prev => ({ ...prev, [msg.id]: normReactions(msg.reactions) }))
        patchMessage(msg)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [roomId, conversationId])

  // Realtime: reactions
  useEffect(() => {
    const channel = supabase
      .channel(`reactions:${roomId ?? conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reactions' }, (payload) => {
        const r = payload.new as { message_id: string; user_id: string; emoji: string }
        setRxMap(prev => {
          if (!(r.message_id in prev)) return prev
          const existing = prev[r.message_id] ?? []
          if (existing.some(x => x.user_id === r.user_id && x.emoji === r.emoji)) return prev
          const nextReactions = [...existing, { user_id: r.user_id, emoji: r.emoji }]
          // Keep the cached message's embedded reactions in sync so the next
          // entry into this scope sees the latest set without waiting for the
          // server refetch.
          setMessages(curr => {
            const msg = curr.find(m => m.id === r.message_id)
            if (msg) patchMessage({ ...msg, reactions: nextReactions })
            return curr
          })
          return { ...prev, [r.message_id]: nextReactions }
        })
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reactions' }, (payload) => {
        const r = payload.old as { message_id: string; user_id: string; emoji: string }
        setRxMap(prev => {
          if (!(r.message_id in prev)) return prev
          const nextReactions = (prev[r.message_id] ?? []).filter(x => !(x.user_id === r.user_id && x.emoji === r.emoji))
          setMessages(curr => {
            const msg = curr.find(m => m.id === r.message_id)
            if (msg) patchMessage({ ...msg, reactions: nextReactions })
            return curr
          })
          return { ...prev, [r.message_id]: nextReactions }
        })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [roomId, conversationId])

  // Realtime: read receipts (DMs only). Lets "Read by ..." update live
  // the moment another member opens the conversation. RLS policy
  // hub_read_receipts_select_dm_members controls who receives events.
  useEffect(() => {
    if (!conversationId) return
    const channel = supabase
      .channel(`receipts:${conversationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hub_read_receipts', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as { user_id: string; last_read_at?: string } | null
          if (!row?.user_id) return
          if (payload.eventType === 'DELETE') {
            setMemberReceipts(prev => {
              if (!(row.user_id in prev)) return prev
              const next = { ...prev }
              delete next[row.user_id]
              // Write through to cache so the next entry reflects this delete.
              saveReadReceipts(
                conversationId,
                Object.entries(next).map(([user_id, last_read_at]) => ({ user_id, last_read_at })),
              )
              return next
            })
          } else if (row.last_read_at) {
            setMemberReceipts(prev => {
              const next = { ...prev, [row.user_id]: row.last_read_at! }
              saveReadReceipts(
                conversationId,
                Object.entries(next).map(([user_id, last_read_at]) => ({ user_id, last_read_at })),
              )
              return next
            })
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [conversationId])

  const toggleReaction = useCallback(async (msgId: string, emoji: string) => {
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
    const res = await fetch(`/api/hub/messages/${msgId}`, { method: 'DELETE' })
    if (res.ok) {
      setMessages(prev => prev.filter(m => m.id !== msgId))
      cacheDeleteMessage(msgId)
    }
  }, [])

  const handleForward = useCallback(async (target: ForwardTarget, comment: string) => {
    if (!forwardingMsg) return
    const body: Record<string, unknown> = {
      forwarded_from: forwardingMsg.id,
      content: comment,
    }
    if (target.type === 'room') body.room_id = target.id
    else body.conversation_id = target.id
    await fetch('/api/hub/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setForwardingMsg(null)
  }, [forwardingMsg])

  function openBoardPicker(msgId: string) {
    setAddToBoardMsgId(msgId)
    fetch('/api/hub/boards')
      .then(r => r.json())
      .then(d => setBoardPickerBoards(d.boards ?? []))
      .catch(() => {})
  }

  async function addToBoard(boardId: string, msg: HubMessage) {
    setAddingToBoard(true)
    await fetch(`/api/hub/boards/${boardId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: msg.content, forwarded_from_message_id: msg.id }),
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

  // Group messages by date
  const groups: { date: string; messages: HubMessage[] }[] = []
  for (const msg of messages) {
    const date = formatDate(msg.created_at)
    const last = groups[groups.length - 1]
    if (last && last.date === date) last.messages.push(msg)
    else groups.push({ date, messages: [msg] })
  }

  return (
    <>
      <div ref={scrollContainerRef} style={{ visibility: feedReady ? 'visible' : 'hidden' }} className="flex-1 overflow-y-auto w-full px-1 md:px-4 py-3 space-y-1">
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

              const rxGroups: Record<string, string[]> = {}
              for (const r of reactions) {
                if (!rxGroups[r.emoji]) rxGroups[r.emoji] = []
                rxGroups[r.emoji].push(r.user_id)
              }

              const isActionsVisible = tappedMsgId === msg.id

              return (
                <div
                  key={msg.id}
                  className={`group relative flex items-start gap-2 py-0.5 rounded hover:bg-gray-900/50 transition-colors select-none md:select-text ${isThreadOpen ? 'bg-[#2E7EB8]/5 border-l-2 border-[#2E7EB8]' : ''}`}
                  onClick={() => {
                    if (longPressFired.current) { longPressFired.current = false; return }
                    if (!isEditing) setTappedMsgId(prev => prev === msg.id ? null : msg.id)
                  }}
                  onTouchStart={() => { if (!isEditing) startLongPress(msg.id) }}
                  onTouchMove={cancelLongPress}
                  onTouchEnd={cancelLongPress}
                  onTouchCancel={cancelLongPress}
                  onContextMenu={e => e.preventDefault()}
                  style={{ touchAction: 'pan-y', WebkitTouchCallout: 'none' }}
                >
                  <div className="flex-none w-7 md:w-8 mt-0.5">
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
                          {msg.source === 'slack' && (
                            <span title="Sent from Slack" className="ml-1.5 text-xs bg-[#4A154B]/40 text-[#ECB22E] px-1.5 py-0.5 rounded font-normal">S</span>
                          )}
                        </span>
                        <span className="text-xs text-gray-500">{formatTime(msg.created_at)}</span>
                      </div>
                    )}

                    {/* Forwarded message banner */}
                    {msg.forwarded_original && (
                      <ForwardedBanner original={msg.forwarded_original} rooms={rooms} hubUsers={hubUsers} />
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
                      msg.content && (
                        <p className="hub-message-text text-lg md:text-sm text-gray-200 leading-relaxed whitespace-pre-wrap break-words">
                          {renderContent(msg.content, hubUsers)}
                          {msg.edited_at && <span className="ml-1.5 text-xs text-gray-600">(edited)</span>}
                        </p>
                      )
                    )}

                    {/* File attachments */}
                    {files.length > 0 && (() => {
                      // Pre-compute lightbox items (images + PDFs) and their indices so
                      // clicking any image/PDF opens the lightbox at the right slot, with
                      // prev/next flipping through all media in this message.
                      const mediaItems: LightboxItem[] = []
                      const mediaIdxByFileId: Record<string, number> = {}
                      files.forEach(f => {
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
                      })
                      return (
                        <div className="flex flex-wrap gap-2 mt-0.5">
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
                      )
                    })()}

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

                    {/* Reply count */}
                    {(replyCounts[msg.id] ?? 0) > 0 && onOpenThread && (
                      <button
                        onClick={() => onOpenThread(msg)}
                        className="mt-1 text-xs text-[#6FB3E8] hover:underline"
                      >
                        {replyCounts[msg.id]} {replyCounts[msg.id] === 1 ? 'reply' : 'replies'}
                      </button>
                    )}

                    {/* Read / Read by ... — only on the user's most recent
                        self-sent top-level message in a DM. */}
                    {latestSelfMsg?.id === msg.id && (() => {
                      const label = readersLabelFor(msg.created_at)
                      return label ? (
                        <div className="mt-0.5 text-[11px] text-gray-500">{label}</div>
                      ) : null
                    })()}
                  </div>

                  {/* Hover actions — desktop only.
                      Mobile uses long-press → MessageActionsSheet instead. */}
                  {!isEditing && (
                    <div
                      className={`flex-none transition-opacity gap-0.5 relative hidden md:flex
                        ${isActionsVisible ? 'md:opacity-100' : 'md:opacity-0 md:group-hover:opacity-100'}`}
                      onClick={e => e.stopPropagation()}
                    >
                      <div className="relative">
                        <button
                          onClick={() => {
                            setFullPickerMsgId(null)
                            setPickerMsgId(pickerMsgId === msg.id ? null : msg.id)
                          }}
                          className="text-gray-500 hover:text-gray-300 px-2 py-1.5 rounded hover:bg-gray-800 text-base md:text-sm md:px-1.5 md:py-0.5"
                          title="Add reaction"
                        >
                          😊
                        </button>
                        {pickerMsgId === msg.id && (
                          <div
                            className="absolute bottom-full right-0 mb-1 z-50 flex items-center gap-0.5 bg-gray-900 border border-gray-700 rounded-full shadow-2xl px-1 py-0.5"
                            onClick={e => e.stopPropagation()}
                          >
                            {['✅', '👍', '👀'].map(emoji => (
                              <button
                                key={emoji}
                                onClick={() => { toggleReaction(msg.id, emoji); setPickerMsgId(null) }}
                                className="w-8 h-8 flex items-center justify-center text-base rounded-full hover:bg-gray-800"
                                title={`React with ${emoji}`}
                              >
                                {emoji}
                              </button>
                            ))}
                            <button
                              onClick={() => { setPickerMsgId(null); setFullPickerMsgId(msg.id) }}
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
                        {fullPickerMsgId === msg.id && (
                          <EmojiPicker
                            onSelect={emoji => toggleReaction(msg.id, emoji)}
                            onClose={() => setFullPickerMsgId(null)}
                          />
                        )}
                      </div>

                      <button
                        onClick={() => setForwardingMsg(msg)}
                        className="text-gray-500 hover:text-gray-300 px-2 py-1.5 rounded hover:bg-gray-800 text-base md:text-xs md:px-1.5 md:py-0.5"
                        title="Forward message"
                      >
                        ↗
                      </button>

                      {files.some(f => f.mime_type.startsWith('image/')) && (
                        <button
                          onClick={() => setSaveToFilesMsg(msg)}
                          className="text-gray-500 hover:text-gray-300 px-2 py-1.5 rounded hover:bg-gray-800 text-base md:text-sm md:px-1.5 md:py-0.5"
                          title="Save to Files"
                        >
                          📁
                        </button>
                      )}

                      <div className="relative">
                        <button
                          onClick={() => addToBoardMsgId === msg.id ? setAddToBoardMsgId(null) : openBoardPicker(msg.id)}
                          className="text-gray-500 hover:text-gray-300 px-2 py-1.5 rounded hover:bg-gray-800 text-base md:text-xs md:px-1.5 md:py-0.5"
                          title="Add to Board"
                        >
                          ☑
                        </button>
                        {addToBoardMsgId === msg.id && (
                          <div className="absolute right-0 top-9 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl py-1 min-w-[180px]" onClick={e => e.stopPropagation()}>
                            <div className="px-3 py-1.5 text-xs text-white/40 font-semibold uppercase tracking-wider border-b border-gray-800">Add to Board</div>
                            {boardPickerBoards.length === 0 && (
                              <p className="px-3 py-2 text-xs text-gray-500">No boards yet</p>
                            )}
                            {boardPickerBoards.map(board => (
                              <button
                                key={board.id}
                                disabled={addingToBoard}
                                onClick={() => addToBoard(board.id, msg)}
                                className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-800 transition-colors"
                              >
                                {board.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {onOpenThread && (
                        <button
                          onClick={() => onOpenThread(msg)}
                          className="text-gray-500 hover:text-gray-300 px-2 py-1.5 rounded hover:bg-gray-800 text-base md:text-xs md:px-1.5 md:py-0.5"
                          title="Reply in thread"
                        >
                          💬
                        </button>
                      )}

                      {isOwn && (
                        <button
                          onClick={() => { setEditingId(msg.id); setEditContent(msg.content); setTappedMsgId(null) }}
                          className="text-gray-500 hover:text-gray-300 px-2 py-1.5 rounded hover:bg-gray-800 text-base md:text-xs md:px-1.5 md:py-0.5"
                          title="Edit"
                        >
                          ✏️
                        </button>
                      )}
                      {(isOwn || isAdmin) && (
                        <button
                          onClick={() => deleteMessage(msg.id)}
                          className="text-gray-500 hover:text-red-400 px-2 py-1.5 rounded hover:bg-gray-800 text-base md:text-xs md:px-1.5 md:py-0.5"
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
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {actionSheetMsgId && (() => {
        const msg = messages.find(m => m.id === actionSheetMsgId)
        if (!msg) return null
        const sender = normSender(msg.sender)
        const isOwn = sender?.id === currentUserId
        const files = normFiles(msg.files)
        return (
          <MessageActionsSheet
            hasText={!!msg.content?.trim()}
            hasImages={files.some(f => f.mime_type.startsWith('image/'))}
            isOwn={isOwn}
            isAdmin={!!isAdmin}
            hasOnOpenThread={!!onOpenThread}
            onClose={() => setActionSheetMsgId(null)}
            onCopy={() => { navigator.clipboard?.writeText(msg.content ?? '').catch(() => {}) }}
            onAddReaction={emoji => toggleReaction(msg.id, emoji)}
            onForward={() => setForwardingMsg(msg)}
            onSaveToFiles={() => setSaveToFilesMsg(msg)}
            onAddToBoard={() => openBoardPicker(msg.id)}
            onOpenThread={() => onOpenThread?.(msg)}
            onEdit={() => { setEditingId(msg.id); setEditContent(msg.content) }}
            onDelete={() => deleteMessage(msg.id)}
          />
        )
      })()}

      {/* Mobile-only board picker. Desktop uses the inline dropdown anchored
          to the hover action bar; that bar is hidden on mobile. */}
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
                      const msg = messages.find(m => m.id === addToBoardMsgId)
                      if (msg) addToBoard(board.id, msg)
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

      {forwardingMsg && (
        <ForwardModal
          currentUserId={currentUserId}
          messagePreview={forwardingMsg.content}
          onClose={() => setForwardingMsg(null)}
          onForward={handleForward}
        />
      )}

      {saveToFilesMsg && (
        <SaveToFilesModal
          attachments={normFiles(saveToFilesMsg.files)}
          onClose={() => setSaveToFilesMsg(null)}
        />
      )}

      {lightbox && (
        <MediaLightbox
          items={lightbox.items}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  )
})

export default MessageFeed
