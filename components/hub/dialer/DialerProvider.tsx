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
//
// Sessions 4–6 (Desktop Dialer Control) — the provider is also where the
// cross-cutting call pieces live: it passes the screen-pop contact match (S4)
// into the incoming popup, fires + closes the answer-from-notification and routes
// its action buttons back through the device (S5), and shows the after-call
// disposition prompt (S6). All are shell-level so they work on every Hub page.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTwilioDevice, type UseTwilioDevice } from '@/hooks/use-twilio-device'
import { useDocumentPip } from '@/hooks/use-document-pip'
import {
  showIncomingCallNotification,
  closeIncomingCallNotification,
} from '@/lib/dialer-call-notification'
import { DEFAULT_DISPOSITIONS } from '@/lib/dialer-dispositions'
import IncomingCall from './IncomingCall'
import PipDialer from './PipDialer'
import CallDisposition from './CallDisposition'

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

function formatPhone(raw: string | null): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  return raw
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

  // ── Session 6: after-call disposition options + prompt ────────────────────
  const [dispoOptions, setDispoOptions] = useState<string[]>([...DEFAULT_DISPOSITIONS])
  const [endedCall, setEndedCall] = useState<{ contactName: string | null } | null>(null)

  useEffect(() => {
    fetch('/api/dialer/settings/dispositions')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.options) && d.options.length) setDispoOptions(d.options) })
      .catch(() => {})
  }, [])

  // Track the live caller label so we can show it on the wrap-up prompt after the
  // call ends (contactMatch clears the instant the far-end number goes null).
  const lastLabelRef = useRef<string | null>(null)
  useEffect(() => {
    if (device.contactMatch?.name) lastLabelRef.current = device.contactMatch.name
    else if (device.inCallWith) lastLabelRef.current = formatPhone(device.inCallWith)
    else if (device.incomingFrom) lastLabelRef.current = formatPhone(device.incomingFrom)
  }, [device.contactMatch, device.inCallWith, device.incomingFrom])

  // Show the wrap-up prompt only after a CONNECTED call ends (not a failed dial
  // or a missed incoming). Clear any stale prompt when a new call starts.
  const prevStateRef = useRef(device.state)
  useEffect(() => {
    const prev = prevStateRef.current
    prevStateRef.current = device.state
    if (device.state === 'incoming' || device.state === 'placing' || device.state === 'in-call') {
      setEndedCall(null)
      return
    }
    if (prev === 'in-call') {
      setEndedCall({ contactName: lastLabelRef.current })
    }
  }, [device.state])

  // ── Session 5: answer-from-notification ───────────────────────────────────
  // Fire/replace the OS notification while ringing; close it once handled.
  useEffect(() => {
    if (device.state === 'incoming') {
      const name = device.contactMatch?.name
      const num = formatPhone(device.incomingFrom) || 'Unknown'
      const addr = device.contactMatch?.address
      void showIncomingCallNotification({
        title: name || 'Incoming call',
        body: name ? [num, addr].filter(Boolean).join(' · ') : num,
      })
    } else {
      void closeIncomingCallNotification()
    }
  }, [device.state, device.contactMatch, device.incomingFrom])

  // Route the notification's Answer / Decline back through the device. 'focus'
  // (a body click, or a browser without action buttons) just brings the window
  // forward — it must not auto-answer.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const handler = (e: MessageEvent) => {
      const d = e.data
      if (!d || d.type !== 'dialer-incoming-action') return
      if (d.action === 'answer') device.acceptIncoming()
      else if (d.action === 'decline') device.rejectIncoming()
    }
    navigator.serviceWorker.addEventListener('message', handler)
    return () => navigator.serviceWorker.removeEventListener('message', handler)
  }, [device.acceptIncoming, device.rejectIncoming])

  return (
    <PipContext.Provider value={pipControls}>
      <DialerContext.Provider value={device}>
        {children}
        {showIncoming && (
          <IncomingCall
            from={device.incomingFrom}
            contact={device.contactMatch}
            onAccept={device.acceptIncoming}
            onReject={device.rejectIncoming}
          />
        )}
        {endedCall && dispoOptions.length > 0 && (
          <CallDisposition
            options={dispoOptions}
            contactName={endedCall.contactName}
            onDismiss={() => setEndedCall(null)}
          />
        )}
        {pip.pipWindow && <PipDialer pipWindow={pip.pipWindow} />}
      </DialerContext.Provider>
    </PipContext.Provider>
  )
}
