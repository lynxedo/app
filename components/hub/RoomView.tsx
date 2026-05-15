'use client'

import { useState } from 'react'
import MessageFeed, { type HubMessage, type HubUser } from './MessageFeed'
import MessageComposer from './MessageComposer'
import ThreadPanel from './ThreadPanel'

export default function RoomView({
  roomId,
  conversationId,
  initialMessages,
  currentUserId,
  hubUsers,
  senderDisplayName,
  composerPlaceholder,
}: {
  roomId?: string
  conversationId?: string
  initialMessages: HubMessage[]
  currentUserId: string
  hubUsers: HubUser[]
  senderDisplayName: string
  composerPlaceholder?: string
}) {
  const [openThreadMsg, setOpenThreadMsg] = useState<HubMessage | null>(null)

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main: feed + composer */}
      <div className="flex flex-col flex-1 min-w-0">
        <MessageFeed
          roomId={roomId}
          conversationId={conversationId}
          initialMessages={initialMessages}
          currentUserId={currentUserId}
          hubUsers={hubUsers}
          onOpenThread={setOpenThreadMsg}
          openThreadMsgId={openThreadMsg?.id ?? null}
        />
        <MessageComposer
          roomId={roomId}
          conversationId={conversationId}
          hubUsers={hubUsers}
          placeholder={composerPlaceholder ?? `Message ${roomId ? '#' : ''}${senderDisplayName}`}
        />
      </div>

      {/* Thread panel — slides in from right */}
      {openThreadMsg && (
        <ThreadPanel
          parentMessage={openThreadMsg}
          currentUserId={currentUserId}
          hubUsers={hubUsers}
          onClose={() => setOpenThreadMsg(null)}
        />
      )}
    </div>
  )
}
