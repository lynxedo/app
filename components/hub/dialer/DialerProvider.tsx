'use client'

// Session 58.5 — lifts useTwilioDevice up to HubShell so the Twilio Voice
// Device is alive on every Hub page (not just /hub/dialer). Renders the
// IncomingCall overlay at shell level so the accept/reject card pops anywhere
// in Hub with caller ID. DialerPanel consumes this context when it's mounted;
// when the provider is absent (e.g. user has dialer_global_ring = false),
// DialerPanel falls back to its own local hook instance — original Session 56
// behavior preserved.
//
// Session 3 (Desktop Dialer Control) — the provider also owns the Document
// Picture-in-Picture window (useDocumentPip) and renders PipDialer into it. The
// window is owned HERE, not in GlobalCallBar, so it persists across calls (the
// bar unmounts between calls): once popped out it survives a call ending and
// catches the NEXT incoming call. PiP controls are exposed via usePipControls()
// so the GlobalCallBar's pop-out button can drive open/close.

import { createContext, useContext, type ReactNode } from 'react'
import { useTwilioDevice, type UseTwilioDevice } from '@/hooks/use-twilio-device'
import { useDocumentPip } from '@/hooks/use-document-pip'
import IncomingCall from './IncomingCall'
import PipDialer from './PipDialer'

const DialerContext = createContext<UseTwilioDevice | null>(null)

export function useDialerContext(): UseTwilioDevice | null {
  return useContext(DialerContext)
}

// Lightweight PiP-controls context for the GlobalCallBar pop-out button.
// `supported` is false on Safari / native / old browsers (button hidden).
export type PipControls = {
  supported: boolean
  isOpen: boolean
  open: () => void
  close: () => void
}

const PipContext = createContext<PipControls | null>(null)

export function usePipControls(): PipControls | null {
  return useContext(PipContext)
}

export default function DialerProvider({ children }: { children: ReactNode }) {
  // autoRegister so the user's Voice Device comes online on the first Hub
  // route load — needed for incoming calls to surface without visiting
  // /hub/dialer first.
  const device = useTwilioDevice({ autoRegister: true })
  const pip = useDocumentPip()
  const showIncoming = device.state === 'incoming'

  const pipControls: PipControls = {
    supported: pip.supported,
    isOpen: !!pip.pipWindow,
    open: () => { void pip.open() },
    close: pip.close,
  }

  return (
    <PipContext.Provider value={pipControls}>
      <DialerContext.Provider value={device}>
        {children}
        {showIncoming && (
          <IncomingCall
            from={device.incomingFrom}
            onAccept={device.acceptIncoming}
            onReject={device.rejectIncoming}
          />
        )}
        {pip.pipWindow && <PipDialer pipWindow={pip.pipWindow} />}
      </DialerContext.Provider>
    </PipContext.Provider>
  )
}
