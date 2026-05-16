'use client'

import { useState } from 'react'
import MessageFeed, { type HubMessage, type HubUser } from './MessageFeed'
import MessageComposer from './MessageComposer'
import ThreadPanel from './ThreadPanel'

type RoomRef = { id: string; name: string }

export default function RoomView({
  roomId,
  conversationId,
  initialMessages,
  currentUserId,
  hubUsers,
  senderDisplayName,
  composerPlaceholder,
  rooms,
}: {
  roomId?: string
  conversationId?: string
  initialMessages: HubMessage[]
  currentUserId: string
  hubUsers: HubUser[]
  senderDisplayName: string
  composerPlaceholder?: string
  rooms?: RoomRef[]
}) {
  const [openThreadMsg, setOpenThreadMsg] = useState<HubMessage | null>(null)

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex flex-col flex-1 min-w-0">
        <MessageFeed
          roomId={roomId}
          conversationId={conversationId}
          initialMessages={initialMessages}
          currentUserId={currentUserId}
          hubUsers={hubUsers}
          onOpenThread={setOpenThreadMsg}
          openThreadMsgId={openThreadMsg?.id ?? null}
          rooms={rooms}
        />
        <MessageComposer
          roomId={roomId}
          conversationId={conversationId}
          hubUsers={hubUsers}
          placeholder={composerPlaceholder ?? `Message ${roomId ? '#' : ''}${senderDisplayName}`}
        />
      </div>

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
