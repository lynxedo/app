'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import MessageFeed, { type HubMessage, type HubUser, type MessageFeedHandle } from './MessageFeed'
import MessageComposer from './MessageComposer'
import ThreadPanel from './ThreadPanel'

type RoomRef = { id: string; name: string }

const MIN_THREAD_W = 240
const MAX_THREAD_W = 600
const DEFAULT_THREAD_W = 320

export default function RoomView({
  roomId,
  conversationId,
  initialMessages,
  currentUserId,
  hubUsers,
  isAdmin,
  senderDisplayName,
  composerPlaceholder,
  rooms,
  conversationMembers,
  initialMemberReadReceipts,
}: {
  roomId?: string
  conversationId?: string
  initialMessages: HubMessage[]
  currentUserId: string
  hubUsers: HubUser[]
  isAdmin?: boolean
  senderDisplayName: string
  composerPlaceholder?: string
  rooms?: RoomRef[]
  // DM-only — drives the "Read by..." indicator.
  conversationMembers?: HubUser[]
  initialMemberReadReceipts?: { user_id: string; last_read_at: string }[]
}) {
  const [openThreadMsg, setOpenThreadMsg] = useState<HubMessage | null>(null)
  const feedRef = useRef<MessageFeedHandle>(null)

  // Thread pane width — persisted, desktop only.
  const [threadWidth, setThreadWidth] = useState(DEFAULT_THREAD_W)
  const widthRef = useRef(DEFAULT_THREAD_W)
  useEffect(() => {
    try {
      const n = parseInt(localStorage.getItem('hub-thread-width') || '', 10)
      if (!isNaN(n) && n >= MIN_THREAD_W && n <= MAX_THREAD_W) {
        setThreadWidth(n)
        widthRef.current = n
      }
    } catch {}
  }, [])

  const dragStartX = useRef(0)
  const dragStartW = useRef(DEFAULT_THREAD_W)

  const onDragMove = useCallback((e: MouseEvent) => {
    const delta = dragStartX.current - e.clientX
    const next = Math.max(MIN_THREAD_W, Math.min(MAX_THREAD_W, dragStartW.current + delta))
    widthRef.current = next
    setThreadWidth(next)
  }, [])

  const onDragUp = useCallback(() => {
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    document.removeEventListener('mousemove', onDragMove)
    document.removeEventListener('mouseup', onDragUp)
    try { localStorage.setItem('hub-thread-width', String(widthRef.current)) } catch {}
  }, [onDragMove])

  const onDragDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragStartX.current = e.clientX
    dragStartW.current = widthRef.current
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    document.addEventListener('mousemove', onDragMove)
    document.addEventListener('mouseup', onDragUp)
  }, [onDragMove, onDragUp])

  useEffect(() => () => {
    document.removeEventListener('mousemove', onDragMove)
    document.removeEventListener('mouseup', onDragUp)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }, [onDragMove, onDragUp])

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Feed + composer — hidden on mobile when thread is open */}
      <div className={`flex flex-col flex-1 min-w-0 ${openThreadMsg ? 'hidden md:flex' : 'flex'}`}>
        <MessageFeed
          ref={feedRef}
          roomId={roomId}
          conversationId={conversationId}
          initialMessages={initialMessages}
          currentUserId={currentUserId}
          hubUsers={hubUsers}
          isAdmin={isAdmin}
          onOpenThread={setOpenThreadMsg}
          openThreadMsgId={openThreadMsg?.id ?? null}
          rooms={rooms}
          conversationMembers={conversationMembers}
          initialMemberReadReceipts={initialMemberReadReceipts}
        />
        <MessageComposer
          roomId={roomId}
          conversationId={conversationId}
          currentUserId={currentUserId}
          hubUsers={hubUsers}
          placeholder={composerPlaceholder ?? `Message ${roomId ? '#' : ''}${senderDisplayName}`}
          onSent={msg => feedRef.current?.addMessage(msg)}
        />
      </div>

      {openThreadMsg && (
        /* Mobile: full width. Desktop: resizable side panel. */
        <div
          className="flex flex-1 md:flex-none"
          style={{ width: threadWidth }}
        >
          {/* Drag handle — desktop only. Dragging left widens, right narrows. */}
          <div
            className="hidden md:flex w-1.5 flex-none cursor-col-resize items-center justify-center group"
            onMouseDown={onDragDown}
          >
            <div className="w-px h-full bg-gray-700 group-hover:bg-indigo-500/60 transition-colors" />
          </div>
          <ThreadPanel
            parentMessage={openThreadMsg}
            currentUserId={currentUserId}
            hubUsers={hubUsers}
            onClose={() => setOpenThreadMsg(null)}
            onReplyPosted={(parentId, replyId) => feedRef.current?.bumpReplyCount(parentId, replyId)}
          />
        </div>
      )}
    </div>
  )
}
