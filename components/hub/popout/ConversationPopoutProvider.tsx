'use client'

// Conversation pop-out — Document Picture-in-Picture for messaging threads.
//
// Mirrors the dialer pop-out (components/hub/dialer/DialerProvider.tsx +
// hooks/use-document-pip.ts), but for TEXT threads instead of a call. A user can
// float a txt conversation or a Hub DM/room above every desktop app and keep
// reading + replying while they work elsewhere in Hub or in another app.
//
// Why a shell-level provider (not a per-page hook): the PiP window must survive
// in-Hub navigation. Owned here — wrapped around the whole Hub shell — the
// floating thread stays open as the user clicks around Hub, exactly like the
// dialer bar. A hard reload or leaving Hub tears down the shell and closes it
// (same honest limit as the dialer).
//
// Unlike the dialer PiP (which can only render *controls* because the live audio
// connection can't leave the main document), a text thread has no such tether —
// so the popped-out view is a fully working conversation: it fetches its own
// data, runs its own Supabase realtime subscription, and sends through the same
// APIs the in-page view uses. See PopoutTxtConversation / PopoutDmConversation.
//
// Only ONE PiP window exists per tab (a browser limit), so popping out a second
// thread swaps the target in the same window rather than opening another.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useDocumentPip } from '@/hooks/use-document-pip'
import PopoutHost from './PopoutHost'

// What's currently floating. `txt` = external SMS thread (txt_conversations);
// `dm` = internal Hub chat, either a room (room_id) or a DM (conversation_id).
export type PopoutTarget =
  | { kind: 'txt'; id: string; title: string; companyId: string }
  | {
      kind: 'dm'
      roomId?: string
      conversationId?: string
      title: string
      currentUserId: string
    }

export type ConversationPopout = {
  // False on Safari / native / old browsers — the button never renders there.
  supported: boolean
  isOpen: boolean
  current: PopoutTarget | null
  popout: (target: PopoutTarget) => void
  close: () => void
  // True when `target` is the one currently floating (drives the button's
  // active/close state).
  isActive: (target: PopoutTarget) => boolean
}

const Ctx = createContext<ConversationPopout | null>(null)

export function useConversationPopout(): ConversationPopout | null {
  return useContext(Ctx)
}

// Stable identity for a target so the button can tell "this thread is the one
// that's popped out" apart from "a different thread is popped out".
function targetKey(t: PopoutTarget): string {
  if (t.kind === 'txt') return `txt:${t.id}`
  return `dm:${t.roomId ?? ''}:${t.conversationId ?? ''}`
}

export default function ConversationPopoutProvider({
  children,
}: {
  children: ReactNode
}) {
  const pip = useDocumentPip()
  const [target, setTarget] = useState<PopoutTarget | null>(null)

  const popout = useCallback(
    (next: PopoutTarget) => {
      setTarget(next)
      // requestWindow needs a user gesture — this runs from the button click.
      // If a window is already open (a different thread), open() no-ops and the
      // swap above just re-points the existing window at `next`.
      void pip.open({ width: 380, height: 620, title: next.title })
    },
    [pip]
  )

  const close = useCallback(() => {
    pip.close()
    setTarget(null)
  }, [pip])

  const isOpen = !!pip.pipWindow

  const value = useMemo<ConversationPopout>(
    () => ({
      supported: pip.supported,
      isOpen,
      current: target,
      popout,
      close,
      isActive: (t) => isOpen && !!target && targetKey(t) === targetKey(target),
    }),
    [pip.supported, isOpen, target, popout, close]
  )

  return (
    <Ctx.Provider value={value}>
      {children}
      {pip.pipWindow && target && (
        <PopoutHost pipWindow={pip.pipWindow} target={target} onClose={close} />
      )}
    </Ctx.Provider>
  )
}
