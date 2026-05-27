'use client'

import { useRef, useState } from 'react'
import MessageFeed, { type HubMessage, type HubUser, type MessageFeedHandle } from './MessageFeed'
import MessageComposer from './MessageComposer'
import ThreadPanel from './ThreadPanel'

type RoomRef = { id: string; name: string }

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
        /* On mobile, thread takes full width. On md+, it's a 320px side panel. */
        <div className="flex flex-1 md:flex-none md:w-80">
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
