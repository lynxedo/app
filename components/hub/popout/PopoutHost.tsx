'use client'

// Renders the pop-out window's chrome (title bar + close) and routes to the
// right thread body. Portaled into the PiP window's document.body, exactly like
// PipDialer. The body components run their own fetch + realtime, so this host
// stays dumb: it just frames them and offers a Close that returns the thread to
// the docked in-page view.

import { createPortal } from 'react-dom'
import type { PopoutTarget } from './ConversationPopoutProvider'
import PopoutTxtConversation from './PopoutTxtConversation'
import PopoutDmConversation from './PopoutDmConversation'

export default function PopoutHost({
  pipWindow,
  target,
  onClose,
}: {
  pipWindow: Window
  target: PopoutTarget
  onClose: () => void
}) {
  // Key by the target so swapping the floating thread remounts the body with a
  // fresh loading state (no in-effect setState) instead of briefly showing the
  // previous thread's messages under the new title.
  const body =
    target.kind === 'txt' ? (
      <PopoutTxtConversation key={`txt:${target.id}`} id={target.id} companyId={target.companyId} />
    ) : (
      <PopoutDmConversation
        key={`dm:${target.roomId ?? ''}:${target.conversationId ?? ''}`}
        roomId={target.roomId}
        conversationId={target.conversationId}
        currentUserId={target.currentUserId}
      />
    )

  return createPortal(
    <div className="flex h-screen w-full flex-col bg-[var(--t-panel-deep)] text-white font-sans">
      {/* Title bar */}
      <div className="flex flex-none items-center gap-2 border-b border-white/10 px-3 py-2">
        <svg className="h-4 w-4 flex-none text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12a9 9 0 01-9 9c-1.6 0-3.1-.4-4.4-1.1L3 21l1.1-4.6A9 9 0 1121 12z" />
        </svg>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{target.title}</span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Close pop-out"
          title="Close pop-out"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {body}
    </div>,
    pipWindow.document.body
  )
}
