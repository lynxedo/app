'use client'

import { useEffect, useLayoutEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle, memo } from 'react'
import { createClient } from '@/lib/supabase/client'
import EmojiPicker from './EmojiPicker'
import ForwardModal, { type ForwardTarget } from './ForwardModal'
import SaveToFilesModal from './SaveToFilesModal'
import MessageActionsSheet from './MessageActionsSheet'
import MediaLightbox, { type LightboxItem } from './MediaLightbox'
import { renderContent } from './renderContent'
import { useConfirm } from '@/components/ui'
import {
  saveMessages,
  getMessages,
  patchMessage,
  deleteMessage as cacheDeleteMessage,
  saveMembers,
  saveReadReceipts,
} from '@/lib/hub-cache'

// Module-level stable empty arrays so non-active rows always receive the
// same reference → React.memo sees no change → skips re-render.
const EMPTY_REACTIONS: RxItem[] = []
const EMPTY_BOARDS: { id: string; name: string }[] = []

export type MessageFeedHandle = {
  addMessage: (msg: HubMessage) => void
  bumpReplyCount: (parentId: string, replyId: string) => void
}

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
  if (sender.avatar_url) return <img src={`/api/profile/avatar/${sender.id}`} alt="" className="w-8 h-8 rounded-full flex-none object-cover ring-1 ring-inset ring-white/10" />
  const initials = sender.display_name.slice(0, 2).toUpperCase()
  return (
    <div className={`w-8 h-8 rounded-full flex-none flex items-center justify-center text-xs font-bold text-white ring-1 ring-inset ring-white/15 ${sender.is_bot ? 'bg-gradient-to-br from-[#38bdf8] to-brand' : 'bg-gradient-to-br from-slate-500 to-slate-700'}`}>
      {initials}
    </div>
  )
}

// Layout constraints for chat image thumbnails — must match the CSS below.
const THUMB_MAX_W = 320 // max-w-xs = 20rem = 320px
const THUMB_MAX_H = 256 // max-h-64 = 16rem = 256px

function fitThumbnail(w: number, h: number): { width: number; height: number } {
  const ratio = Math.min(THUMB_MAX_W / w, THUMB_MAX_H / h, 1)
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) }
}

export function FileAttachment({ file, onOpenLightbox }: { file: FileItem; onOpenLightbox?: () => void }) {
  const src = file.localUrl ?? `/api/hub/files/${file.id}`
  const size = formatBytes(file.size_bytes)

  if (file.mime_type.startsWith('image/')) {
    const hasDims = file.width_px != null && file.height_px != null && file.width_px > 0 && file.height_px > 0
    const box = hasDims ? fitThumbnail(file.width_px!, file.height_px!) : null

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
      <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap break-words">
        {original.content ? renderContent(original.content, hubUsers) : <span className="italic text-gray-500">Attachment</span>}
      </p>
    </div>
  )
}

const MESSAGE_PAGE_SIZE = 50

// ── MessageRow ─────────────────────────────────────────────────────────────
// Memoized per-message row. All ID-comparison state is promoted to boolean
// props so only the one affected row re-renders when pickerMsgId, tappedMsgId,
// editingId, etc. change. Callbacks are stable (useCallback with [] or ref-
// backed deps) so memo() sees no new function references.

type MessageRowProps = {
  msg: HubMessage
  currentUserId: string
  hubUsers: HubUser[]
  isAdmin: boolean
  rooms?: { id: string; name: string }[]
  isContinuation: boolean
  isOwn: boolean
  isEditing: boolean
  isActionsVisible: boolean
  isPickerOpen: boolean
  isFullPickerOpen: boolean
  isThreadOpen: boolean
  isAddToBoardOpen: boolean
  reactions: RxItem[]
  replyCount: number
  readersLabel: string | null
  editContent: string
  boardPickerBoards: { id: string; name: string }[]
  addingToBoard: boolean
  onTap: (msgId: string) => void
  onStartLongPress: (msgId: string) => void
  onCancelLongPress: () => void
  onToggleReaction: (msgId: string, emoji: string) => void
  onToggleQuickPicker: (msgId: string) => void
  onOpenFullPicker: (msgId: string) => void
  onCloseFullPicker: () => void
  onStartEdit: (msgId: string, content: string) => void
  onCancelEdit: () => void
  onSaveEdit: (msgId: string) => void
  onEditContentChange: (content: string) => void
  onDelete: (msgId: string) => void
  onSetForwardingMsg: (msg: HubMessage) => void
  onSaveToFiles: (msg: HubMessage) => void
  onOpenLightbox: (items: LightboxItem[], index: number) => void
  onOpenBoardPicker: (msgId: string) => void
  onAddToBoard: (boardId: string) => void
  onCloseBoardPicker: () => void
  onOpenThread?: (msg: HubMessage) => void
}

const MessageRow = memo(function MessageRow({
  msg,
  currentUserId,
  hubUsers,
  isAdmin,
  rooms,
  isContinuation,
  isOwn,
  isEditing,
  isActionsVisible,
  isPickerOpen,
  isFullPickerOpen,
  isThreadOpen,
  isAddToBoardOpen,
  reactions,
  replyCount,
  readersLabel,
  editContent,
  boardPickerBoards,
  addingToBoard,
  onTap,
  onStartLongPress,
  onCancelLongPress,
  onToggleReaction,
  onToggleQuickPicker,
  onOpenFullPicker,
  onCloseFullPicker,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditContentChange,
  onDelete,
  onSetForwardingMsg,
  onSaveToFiles,
  onOpenLightbox,
  onOpenBoardPicker,
  onAddToBoard,
  onCloseBoardPicker,
  onOpenThread,
}: MessageRowProps) {
  const sender = normSender(msg.sender)
  const files = normFiles(msg.files)
  const [rxPopoverKey, setRxPopoverKey] = useState<string | null>(null)

  const rxGroups: Record<string, string[]> = {}
  for (const r of reactions) {
    if (!rxGroups[r.emoji]) rxGroups[r.emoji] = []
    rxGroups[r.emoji].push(r.user_id)
  }

  // Pre-compute lightbox items once per render so the inline IIFE is self-contained.
  const mediaItems: LightboxItem[] = []
  const mediaIdxByFileId: Record<string, number> = {}
  files.forEach(f => {
    const isImg = f.mime_type.startsWith('image/')
    const isPdf = f.mime_type === 'application/pdf'
    if (isImg || isPdf) {
      mediaIdxByFileId[f.id] = mediaItems.length
      mediaItems.push({
        type: isImg ? 'image' : 'pdf',
        src: isPdf && !f.localUrl ? `/api/hub/files/${f.id}?inline=pdf` : (f.localUrl ?? `/api/hub/files/${f.id}`),
        downloadSrc: f.localUrl ?? `/api/hub/files/${f.id}`,
        filename: f.filename,
      })
    }
  })

  return (
    <div
      className={`group relative flex items-start gap-2 py-0.5 rounded hover:bg-gray-900/50 transition-colors select-none md:select-text ${isThreadOpen ? 'bg-brand/5 border-l-2 border-brand' : ''}`}
      onClick={() => { if (!isEditing) onTap(msg.id) }}
      onTouchStart={() => { if (!isEditing) onStartLongPress(msg.id) }}
      onTouchMove={onCancelLongPress}
      onTouchEnd={onCancelLongPress}
      onTouchCancel={onCancelLongPress}
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
                <span className="ml-1.5 text-xs bg-brand/30 text-brand px-1.5 py-0.5 rounded font-normal">Bot</span>
              )}
              {msg.source === 'slack' && (
                <span title="Sent from Slack" className="ml-1.5 text-xs bg-[#4A154B]/40 text-[#ECB22E] px-1.5 py-0.5 rounded font-normal">S</span>
              )}
            </span>
            <span className="text-xs text-gray-500">{formatTime(msg.created_at)}</span>
          </div>
        )}

        {msg.forwarded_original && (
          <ForwardedBanner original={msg.forwarded_original} rooms={rooms} hubUsers={hubUsers} />
        )}

        {isEditing ? (
          <div className="flex gap-2">
            <input
              autoFocus
              value={editContent}
              onChange={e => onEditContentChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSaveEdit(msg.id) }
                if (e.key === 'Escape') onCancelEdit()
              }}
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white outline-none focus:border-brand"
            />
            <button onClick={() => onSaveEdit(msg.id)} className="text-xs text-brand hover:text-blue-300 px-2">Save</button>
            <button onClick={onCancelEdit} className="text-xs text-gray-500 hover:text-gray-300 px-2">Cancel</button>
          </div>
        ) : (
          msg.content && (
            <p className="hub-message-text text-lg md:text-sm text-gray-200 leading-relaxed whitespace-pre-wrap break-words">
              {renderContent(msg.content, hubUsers)}
              {msg.edited_at && <span className="ml-1.5 text-xs text-gray-600">(edited)</span>}
            </p>
          )
        )}

        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-0.5">
            {files.map(f => {
              const mIdx = mediaIdxByFileId[f.id]
              return (
                <FileAttachment
                  key={f.id}
                  file={f}
                  onOpenLightbox={
                    mIdx !== undefined
                      ? () => onOpenLightbox(mediaItems, mIdx)
                      : undefined
                  }
                />
              )
            })}
          </div>
        )}

        {Object.keys(rxGroups).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {Object.entries(rxGroups).map(([emoji, userIds]) => {
              const names = userIds.map(id => hubUsers.find(u => u.id === id)?.display_name ?? 'Someone')
              const tooltipText = names.length <= 3
                ? names.join(', ')
                : `${names.slice(0, 3).join(', ')} +${names.length - 3} more`
              const pillKey = `${msg.id}-${emoji}`
              const isOpen = rxPopoverKey === pillKey
              const isMine = userIds.includes(currentUserId)
              return (
                <div key={emoji} className="relative group/rxpill">
                  {/* Desktop hover tooltip */}
                  <div className="absolute bottom-full left-0 mb-1.5 z-50 hidden group-hover/rxpill:block bg-gray-900 border border-gray-700 text-white text-xs rounded-md px-2.5 py-1.5 whitespace-nowrap pointer-events-none shadow-xl">
                    <span className="font-medium">{tooltipText}</span>
                    <span className="text-gray-400"> reacted with {emoji}</span>
                  </div>
                  {/* Mobile tap-on-count popover */}
                  {isOpen && (
                    <div className="absolute bottom-full left-0 mb-1.5 z-50 bg-gray-900 border border-gray-700 text-white text-xs rounded-md px-2.5 py-1.5 whitespace-nowrap shadow-xl pointer-events-none">
                      <span className="font-medium">{tooltipText}</span>
                      <span className="text-gray-400"> reacted with {emoji}</span>
                    </div>
                  )}
                  {/* Split pill: emoji = toggle reaction, count = show who reacted */}
                  <div className={`flex items-center rounded-full text-xs border overflow-hidden transition-colors ${
                    isMine
                      ? 'bg-brand/20 border-brand/50 text-brand'
                      : 'bg-gray-800 border-gray-700 text-gray-400'
                  }`}>
                    <button
                      onClick={e => { e.stopPropagation(); onToggleReaction(msg.id, emoji) }}
                      className="pl-2 pr-1 py-0.5 hover:bg-white/10 transition-colors"
                      title="Toggle reaction"
                    >{emoji}</button>
                    <button
                      onClick={e => { e.stopPropagation(); setRxPopoverKey(prev => prev === pillKey ? null : pillKey) }}
                      className="pl-1 pr-2 py-0.5 font-medium hover:bg-white/10 transition-colors"
                      title={tooltipText}
                    >{userIds.length}</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {replyCount > 0 && onOpenThread && (
          <button
            onClick={() => onOpenThread(msg)}
            className="mt-1 text-xs text-[#6FB3E8] hover:underline"
          >
            {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
          </button>
        )}

        {readersLabel && (
          <div className="mt-0.5 text-[11px] text-gray-500">{readersLabel}</div>
        )}
      </div>

      {/* Hover actions — desktop only. Mobile uses long-press → MessageActionsSheet. */}
      {!isEditing && (
        <div
          className={`flex-none transition-opacity gap-0.5 relative hidden md:flex
            ${isActionsVisible ? 'md:opacity-100' : 'md:opacity-0 md:group-hover:opacity-100'}`}
          onClick={e => e.stopPropagation()}
        >
          <div className="relative">
            <button
              onClick={() => onToggleQuickPicker(msg.id)}
              className="text-gray-500 hover:text-gray-300 px-2 py-1.5 rounded hover:bg-gray-800 text-base md:text-sm md:px-1.5 md:py-0.5"
              title="Add reaction"
            >
              😊
            </button>
            {isPickerOpen && (
              <div
                className="absolute bottom-full right-0 mb-1 z-50 flex items-center gap-0.5 bg-gray-900 border border-gray-700 rounded-full shadow-2xl px-1 py-0.5"
                onClick={e => e.stopPropagation()}
              >
                {['✅', '👍', '👀'].map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => { onToggleReaction(msg.id, emoji); onToggleQuickPicker(msg.id) }}
                    className="w-8 h-8 flex items-center justify-center text-base rounded-full hover:bg-gray-800"
                    title={`React with ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
                <button
                  onClick={() => onOpenFullPicker(msg.id)}
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
            {isFullPickerOpen && (
              <EmojiPicker
                onSelect={emoji => onToggleReaction(msg.id, emoji)}
                onClose={onCloseFullPicker}
              />
            )}
          </div>

          <button
            onClick={() => onSetForwardingMsg(msg)}
            className="text-gray-500 hover:text-gray-300 px-2 py-1.5 rounded hover:bg-gray-800 text-base md:text-xs md:px-1.5 md:py-0.5"
            title="Forward message"
          >
            ↗
          </button>

          {files.some(f => f.mime_type.startsWith('image/')) && (
            <button
              onClick={() => onSaveToFiles(msg)}
              className="text-gray-500 hover:text-gray-300 px-2 py-1.5 rounded hover:bg-gray-800 text-base md:text-sm md:px-1.5 md:py-0.5"
              title="Save to Files"
            >
              📁
            </button>
          )}

          <div className="relative">
            <button
              onClick={() => isAddToBoardOpen ? onCloseBoardPicker() : onOpenBoardPicker(msg.id)}
              className="text-gray-500 hover:text-gray-300 px-2 py-1.5 rounded hover:bg-gray-800 text-base md:text-xs md:px-1.5 md:py-0.5"
              title="Add to Board"
            >
              ☑
            </button>
            {isAddToBoardOpen && (
              <div className="absolute right-0 top-9 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl py-1 min-w-[180px]" onClick={e => e.stopPropagation()}>
                <div className="px-3 py-1.5 text-xs text-white/40 font-semibold uppercase tracking-wider border-b border-gray-800">Add to Board</div>
                {boardPickerBoards.length === 0 && (
                  <p className="px-3 py-2 text-xs text-gray-500">No boards yet</p>
                )}
                {boardPickerBoards.map(board => (
                  <button
                    key={board.id}
                    disabled={addingToBoard}
                    onClick={() => onAddToBoard(board.id)}
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
              onClick={() => onStartEdit(msg.id, msg.content)}
              className="text-gray-500 hover:text-gray-300 px-2 py-1.5 rounded hover:bg-gray-800 text-base md:text-xs md:px-1.5 md:py-0.5"
              title="Edit"
            >
              ✏️
            </button>
          )}
          {(isOwn || isAdmin) && (
            <button
              onClick={() => onDelete(msg.id)}
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
})

// ── MessageFeed ────────────────────────────────────────────────────────────

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
  const confirmDialog = useConfirm()
  const [messages, setMessages] = useState<HubMessage[]>(initialMessages)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMoreOlder, setHasMoreOlder] = useState(initialMessages.length >= MESSAGE_PAGE_SIZE)
  const prependingRef = useRef(false)
  const prevScrollHeightRef = useRef(0)
  const prevScrollTopRef = useRef(0)
  const topSentinelRef = useRef<HTMLDivElement>(null)
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
  const seenReplyIds = useRef<Set<string>>(new Set())
  const incrementReplyCount = useCallback((parentId: string, replyId: string) => {
    if (seenReplyIds.current.has(replyId)) return
    seenReplyIds.current.add(replyId)
    setReplyCounts(prev => ({ ...prev, [parentId]: (prev[parentId] ?? 0) + 1 }))
  }, [])
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [feedReady, setFeedReady] = useState(false)
  const supabase = createClient()

  const [memberReceipts, setMemberReceipts] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const r of initialMemberReadReceipts ?? []) map[r.user_id] = r.last_read_at
    return map
  })

  const [typingUsers, setTypingUsers] = useState<{ id: string; name: string }[]>([])
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

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

  function readersLabelFor(msgCreatedAt: string): string | null {
    if (!conversationId || !conversationMembers) return null
    const others = conversationMembers.filter(m => m.id !== currentUserId && !m.is_bot)
    if (others.length === 0) return null
    const readers = others.filter(m => {
      const rr = memberReceipts[m.id]
      return rr && rr >= msgCreatedAt
    })
    if (readers.length === 0) return null
    if (others.length === 1) return 'Read'
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
      const hasTempFiles = (msg.files ?? []).some(f => f.id.startsWith('temp-'))
      if (!hasTempFiles) patchMessage(msg)
    },
    bumpReplyCount(parentId: string, replyId: string) {
      incrementReplyCount(parentId, replyId)
    },
  }))

  useLayoutEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    let pinning = true
    const pin = () => { if (pinning) el.scrollTop = el.scrollHeight }
    pin()

    let revealed = false
    const reveal = () => {
      if (revealed) return
      revealed = true
      pin()
      setFeedReady(true)
    }

    const imgs = Array.from(el.querySelectorAll('img'))
    let pending = imgs.filter(img => !(img.complete && img.naturalHeight !== 0)).length
    if (pending === 0) {
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
    const revealCap = setTimeout(reveal, 1500)

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

  useLayoutEffect(() => {
    if (prependingRef.current) {
      const el = scrollContainerRef.current
      if (el) el.scrollTop = el.scrollHeight - prevScrollHeightRef.current + prevScrollTopRef.current
      prependingRef.current = false
      return
    }
    const el = scrollContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  // Keep latest messages reachable from the stable loadOlder closure.
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const loadingOlderRef = useRef(false)
  // Keep addToBoardMsgId reachable from the stable handleAddToBoard callback.
  const addToBoardMsgIdRef = useRef(addToBoardMsgId)
  addToBoardMsgIdRef.current = addToBoardMsgId

  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasMoreOlder) return
    const current = messagesRef.current
    const oldest = current[0]
    if (!oldest?.created_at) return

    loadingOlderRef.current = true
    setLoadingOlder(true)
    try {
      const scopeCol = roomId ? 'room_id' : 'conversation_id'
      const scopeVal = roomId ?? conversationId
      const { data } = await supabase
        .from('messages')
        .select(`id, content, created_at, edited_at, parent_id, room_id, conversation_id, forwarded_from,
          sender:hub_users!sender_id (id, display_name, avatar_url, is_bot),
          reactions (message_id, user_id, emoji),
          files (id, filename, mime_type, size_bytes, storage_path, width_px, height_px)`)
        .eq(scopeCol, scopeVal as string)
        .is('parent_id', null)
        .is('deleted_at', null)
        .lt('created_at', oldest.created_at)
        .order('created_at', { ascending: false })
        .limit(MESSAGE_PAGE_SIZE)

      const rows = ((data ?? []) as unknown as HubMessage[]).slice().reverse()
      if (rows.length < MESSAGE_PAGE_SIZE) setHasMoreOlder(false)
      if (rows.length === 0) return

      const fwdIds = rows.map(m => m.forwarded_from).filter(Boolean) as string[]
      if (fwdIds.length > 0) {
        const { data: origs } = await supabase
          .from('messages')
          .select('id, content, room_id, conversation_id, sender:hub_users!sender_id (display_name)')
          .in('id', fwdIds)
        const fwdMap: Record<string, ForwardedOriginal> = {}
        for (const o of origs ?? []) {
          const orig = o as { id: string; content: string; room_id: string | null; conversation_id: string | null; sender: { display_name: string } | { display_name: string }[] | null }
          fwdMap[orig.id] = { ...orig, sender: Array.isArray(orig.sender) ? orig.sender[0] : orig.sender }
        }
        for (const m of rows) if (m.forwarded_from) m.forwarded_original = fwdMap[m.forwarded_from] ?? null
      }

      const ids = rows.map(m => m.id)
      const { data: replyRows } = await supabase
        .from('messages').select('parent_id').in('parent_id', ids).is('deleted_at', null)
      const counts: Record<string, number> = {}
      for (const r of (replyRows ?? []) as { parent_id: string }[]) counts[r.parent_id] = (counts[r.parent_id] ?? 0) + 1

      const el = scrollContainerRef.current
      if (el) { prevScrollHeightRef.current = el.scrollHeight; prevScrollTopRef.current = el.scrollTop }
      prependingRef.current = true
      setMessages(prev => {
        const have = new Set(prev.map(m => m.id))
        const fresh = rows.filter(m => !have.has(m.id))
        if (fresh.length === 0) { prependingRef.current = false; return prev }
        return [...fresh, ...prev]
      })
      setRxMap(prev => {
        const next = { ...prev }
        for (const m of rows) next[m.id] = normReactions(m.reactions)
        return next
      })
      setReplyCounts(prev => {
        const next = { ...prev }
        for (const m of rows) if (next[m.id] === undefined) next[m.id] = counts[m.id] ?? 0
        return next
      })
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }, [hasMoreOlder, roomId, conversationId, supabase])

  useEffect(() => {
    if (!feedReady || !hasMoreOlder) return
    const root = scrollContainerRef.current
    const sentinel = topSentinelRef.current
    if (!root || !sentinel) return
    const io = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return
      if (root.scrollTop > 400) return
      void loadOlder()
    }, { root, rootMargin: '300px 0px 0px 0px', threshold: 0 })
    io.observe(sentinel)
    return () => io.disconnect()
  }, [feedReady, hasMoreOlder, loadOlder])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, conversationId])

  useEffect(() => {
    const filter = roomId
      ? `room_id=eq.${roomId}`
      : `conversation_id=eq.${conversationId}`

    const channel = supabase
      .channel(`feed:${roomId ?? conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter }, async (payload) => {
        if (payload.new.parent_id) {
          incrementReplyCount(payload.new.parent_id, payload.new.id)
          return
        }
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
      .on('broadcast', { event: 'message-inserted' }, async (payload) => {
        const p = (payload.payload ?? {}) as { id?: string; parent_id?: string | null; sender_id?: string }
        if (!p.id) return
        if (p.parent_id) {
          incrementReplyCount(p.parent_id, p.id)
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

  useEffect(() => {
    const id = roomId ?? conversationId
    if (!id) return
    const timers = typingTimers.current
    const channel = supabase
      .channel(`typing:${id}`)
      .on('broadcast', { event: 'typing' }, (payload) => {
        const p = (payload.payload ?? {}) as { user_id?: string; name?: string }
        if (!p.user_id || p.user_id === currentUserId) return
        const uid = p.user_id
        const name = p.name || 'Someone'
        setTypingUsers(prev => prev.some(u => u.id === uid) ? prev : [...prev, { id: uid, name }])
        clearTimeout(timers[uid])
        timers[uid] = setTimeout(() => {
          setTypingUsers(prev => prev.filter(u => u.id !== uid))
          delete timers[uid]
        }, 4000)
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      Object.values(timers).forEach(clearTimeout)
      setTypingUsers([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, conversationId])

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

  useEffect(() => {
    if (!conversationId) return

    function applyReceiptUpdate(userId: string, lastReadAt: string) {
      setMemberReceipts(prev => {
        if (prev[userId] && prev[userId] >= lastReadAt) return prev
        const next = { ...prev, [userId]: lastReadAt }
        saveReadReceipts(
          conversationId!,
          Object.entries(next).map(([user_id, last_read_at]) => ({ user_id, last_read_at })),
        )
        return next
      })
    }

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
              saveReadReceipts(
                conversationId,
                Object.entries(next).map(([user_id, last_read_at]) => ({ user_id, last_read_at })),
              )
              return next
            })
          } else if (row.last_read_at) {
            applyReceiptUpdate(row.user_id, row.last_read_at)
          }
        }
      )
      .on('broadcast', { event: 'receipt-updated' }, (payload) => {
        const p = (payload.payload ?? {}) as { user_id?: string; last_read_at?: string }
        if (p.user_id && p.last_read_at) applyReceiptUpdate(p.user_id, p.last_read_at)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [conversationId])

  // ── Stable refs for volatile state used inside callbacks ────────────────
  // Lets callbacks drop volatile deps so memo() sees the same function ref.
  const rxMapRef = useRef(rxMap)
  rxMapRef.current = rxMap
  const editContentRef = useRef(editContent)
  editContentRef.current = editContent

  // ── Stable callbacks ────────────────────────────────────────────────────

  const toggleReaction = useCallback(async (msgId: string, emoji: string) => {
    const current = rxMapRef.current[msgId] ?? []
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
  }, [currentUserId])

  const saveEdit = useCallback(async (msgId: string) => {
    const trimmed = editContentRef.current.trim()
    if (!trimmed) return
    await fetch(`/api/hub/messages/${msgId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: trimmed }),
    })
    setEditingId(null)
  }, [])

  const deleteMessage = useCallback(async (msgId: string) => {
    if (!(await confirmDialog({ message: 'Delete this message?', danger: true }))) return
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
    if (forwardingMsg.files && forwardingMsg.files.length > 0) {
      body.files = forwardingMsg.files.map(f => ({
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
    setForwardingMsg(null)
  }, [forwardingMsg])

  const openBoardPicker = useCallback((msgId: string) => {
    setAddToBoardMsgId(msgId)
    fetch('/api/hub/boards')
      .then(r => r.json())
      .then(d => setBoardPickerBoards(d.boards ?? []))
      .catch(() => {})
  }, [])

  const handleAddToBoard = useCallback(async (boardId: string) => {
    const msgId = addToBoardMsgIdRef.current
    const msg = messagesRef.current.find(m => m.id === msgId)
    if (!msg) return
    setAddingToBoard(true)
    await fetch(`/api/hub/boards/${boardId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: msg.content, forwarded_from_message_id: msg.id }),
    })
    setAddingToBoard(false)
    setAddToBoardMsgId(null)
  }, [])

  const startLongPress = useCallback((msgId: string) => {
    longPressFired.current = false
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      setActionSheetMsgId(msgId)
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(10)
    }, 500)
  }, [])

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const handleTap = useCallback((msgId: string) => {
    if (longPressFired.current) { longPressFired.current = false; return }
    setTappedMsgId(prev => prev === msgId ? null : msgId)
  }, [])

  const handleStartEdit = useCallback((msgId: string, content: string) => {
    setEditingId(msgId)
    setEditContent(content)
    setTappedMsgId(null)
  }, [])

  const handleCancelEdit = useCallback(() => {
    setEditingId(null)
  }, [])

  const handleEditContentChange = useCallback((content: string) => {
    setEditContent(content)
  }, [])

  const handleToggleQuickPicker = useCallback((msgId: string) => {
    setFullPickerMsgId(null)
    setPickerMsgId(prev => prev === msgId ? null : msgId)
  }, [])

  const handleOpenFullPicker = useCallback((msgId: string) => {
    setPickerMsgId(null)
    setFullPickerMsgId(msgId)
  }, [])

  const handleCloseFullPicker = useCallback(() => {
    setFullPickerMsgId(null)
  }, [])

  const handleCloseBoardPicker = useCallback(() => {
    setAddToBoardMsgId(null)
  }, [])

  const handleSetForwardingMsg = useCallback((msg: HubMessage) => {
    setForwardingMsg(msg)
  }, [])

  const handleSetSaveToFilesMsg = useCallback((msg: HubMessage) => {
    setSaveToFilesMsg(msg)
  }, [])

  const handleOpenLightbox = useCallback((items: LightboxItem[], index: number) => {
    setLightbox({ items, index })
  }, [])

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
      <div ref={scrollContainerRef} style={{ visibility: feedReady ? 'visible' : 'hidden', overscrollBehaviorX: 'none' }} className="flex-1 overflow-y-auto overflow-x-hidden w-full px-1 md:px-4 py-3 space-y-1">
        {hasMoreOlder && <div ref={topSentinelRef} className="h-px w-full" aria-hidden />}
        {loadingOlder && (
          <div className="flex items-center justify-center py-3">
            <div className="w-5 h-5 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
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
              const isLatestSelf = latestSelfMsg?.id === msg.id
              const readersLabel = isLatestSelf ? readersLabelFor(msg.created_at) : null

              return (
                <MessageRow
                  key={msg.id}
                  msg={msg}
                  currentUserId={currentUserId}
                  hubUsers={hubUsers}
                  isAdmin={!!isAdmin}
                  rooms={rooms}
                  isContinuation={!!isContinuation}
                  isOwn={isOwn}
                  isEditing={editingId === msg.id}
                  isActionsVisible={tappedMsgId === msg.id}
                  isPickerOpen={pickerMsgId === msg.id}
                  isFullPickerOpen={fullPickerMsgId === msg.id}
                  isThreadOpen={openThreadMsgId === msg.id}
                  isAddToBoardOpen={addToBoardMsgId === msg.id}
                  reactions={rxMap[msg.id] ?? EMPTY_REACTIONS}
                  replyCount={replyCounts[msg.id] ?? 0}
                  readersLabel={readersLabel}
                  editContent={editingId === msg.id ? editContent : ''}
                  boardPickerBoards={addToBoardMsgId === msg.id ? boardPickerBoards : EMPTY_BOARDS}
                  addingToBoard={addToBoardMsgId === msg.id ? addingToBoard : false}
                  onTap={handleTap}
                  onStartLongPress={startLongPress}
                  onCancelLongPress={cancelLongPress}
                  onToggleReaction={toggleReaction}
                  onToggleQuickPicker={handleToggleQuickPicker}
                  onOpenFullPicker={handleOpenFullPicker}
                  onCloseFullPicker={handleCloseFullPicker}
                  onStartEdit={handleStartEdit}
                  onCancelEdit={handleCancelEdit}
                  onSaveEdit={saveEdit}
                  onEditContentChange={handleEditContentChange}
                  onDelete={deleteMessage}
                  onSetForwardingMsg={handleSetForwardingMsg}
                  onSaveToFiles={handleSetSaveToFilesMsg}
                  onOpenLightbox={handleOpenLightbox}
                  onOpenBoardPicker={openBoardPicker}
                  onAddToBoard={handleAddToBoard}
                  onCloseBoardPicker={handleCloseBoardPicker}
                  onOpenThread={onOpenThread}
                />
              )
            })}
          </div>
        ))}

        {typingUsers.length > 0 && (
          <div className="px-1 pt-1 text-xs text-gray-400 flex items-center gap-1.5" aria-live="polite">
            <span className="flex gap-0.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-500 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-500 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-500" />
            </span>
            <span>
              {typingUsers.length === 1
                ? `${typingUsers[0].name.split(' ')[0]} is typing…`
                : typingUsers.length === 2
                  ? `${typingUsers[0].name.split(' ')[0]} & ${typingUsers[1].name.split(' ')[0]} are typing…`
                  : 'Several people are typing…'}
            </span>
          </div>
        )}

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

      {/* Mobile-only board picker */}
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
                    onClick={() => handleAddToBoard(board.id)}
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
