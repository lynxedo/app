'use client'

import { useState } from 'react'
import { useTwilioDevice } from '@/hooks/use-twilio-device'
import Dialpad from '@/components/hub/dialer/Dialpad'
import ActiveCall from '@/components/hub/dialer/ActiveCall'
import IncomingCall from '@/components/hub/dialer/IncomingCall'

export default function DialerPanel({ isAdmin }: { isAdmin: boolean }) {
  const device = useTwilioDevice({ autoRegister: true })
  const [injecting, setInjecting] = useState(false)
  const [injectError, setInjectError] = useState<string | null>(null)

  async function injectTestCall(direction: 'inbound' | 'outbound') {
    setInjecting(true)
    setInjectError(null)
    try {
      const res = await fetch('/api/dialer/dev/inject-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setInjectError(body.error || `inject_failed_${res.status}`)
      }
    } catch (err) {
      setInjectError(err instanceof Error ? err.message : 'inject_failed')
    } finally {
      setInjecting(false)
    }
  }

  const showActiveCall = device.state === 'placing' || device.state === 'in-call'
  const showIncoming = device.state === 'incoming'

  return (
    <div className="h-full flex flex-col">
      <div className="flex-none px-4 py-3 border-b border-white/5">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Dialer</h1>
          <StatusPill state={device.state} />
        </div>
        {device.errorMessage && device.state === 'error' && (
          <div className="mt-2 text-xs text-red-300 bg-red-900/30 border border-red-800 rounded px-2 py-1">
            {device.errorMessage}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 flex flex-col items-center justify-center">
        {showActiveCall ? (
          <ActiveCall
            status={device.state === 'placing' ? 'placing' : 'in-call'}
            who={device.inCallWith}
            startedAt={device.callStartedAt}
            muted={device.muted}
            onToggleMute={device.toggleMute}
            onSendDigit={device.sendDigit}
            onHangup={device.hangup}
          />
        ) : (
          <Dialpad
            onCall={(num) => device.placeCall(num)}
            disabled={device.state === 'not-configured' || device.state === 'connecting'}
          />
        )}

        {device.state === 'not-configured' && (
          <div className="mt-8 max-w-sm mx-auto text-center text-xs text-white/50 bg-amber-900/10 border border-amber-900/30 rounded px-3 py-2">
            Dialer is wired but Twilio credentials aren&apos;t configured on this environment yet.
            Calls won&apos;t connect until <code className="font-mono text-amber-300">TWILIO_API_KEY_SID</code>,
            {' '}<code className="font-mono text-amber-300">TWILIO_API_KEY_SECRET</code>, and
            {' '}<code className="font-mono text-amber-300">TWILIO_TWIML_APP_SID</code> are set.
          </div>
        )}

        {isAdmin && (
          <div className="mt-10 pt-6 border-t border-white/5 w-full max-w-sm mx-auto">
            <div className="text-xs text-white/50 uppercase tracking-wider mb-3 text-center">
              Dev — inject test call
            </div>
            <div className="flex gap-2 justify-center">
              <button
                type="button"
                onClick={() => injectTestCall('inbound')}
                disabled={injecting}
                className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-xs disabled:opacity-50"
              >
                + Inbound (missed)
              </button>
              <button
                type="button"
                onClick={() => injectTestCall('outbound')}
                disabled={injecting}
                className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-xs disabled:opacity-50"
              >
                + Outbound (completed)
              </button>
            </div>
            {injectError && <div className="text-[11px] text-red-300 mt-2 text-center">{injectError}</div>}
          </div>
        )}
      </div>

      {showIncoming && (
        <IncomingCall
          from={device.incomingFrom}
          onAccept={device.acceptIncoming}
          onReject={device.rejectIncoming}
        />
      )}
    </div>
  )
}

function StatusPill({ state }: { state: ReturnType<typeof useTwilioDevice>['state'] }) {
  const map: Record<typeof state, { label: string; color: string }> = {
    'idle': { label: 'Idle', color: 'bg-white/5 text-white/50' },
    'connecting': { label: 'Connecting…', color: 'bg-amber-500/20 text-amber-300' },
    'ready': { label: 'Ready', color: 'bg-emerald-500/20 text-emerald-300' },
    'incoming': { label: 'Ringing', color: 'bg-sky-500/20 text-sky-300' },
    'placing': { label: 'Dialing', color: 'bg-sky-500/20 text-sky-300' },
    'in-call': { label: 'On call', color: 'bg-emerald-500/20 text-emerald-300' },
    'ended': { label: 'Ended', color: 'bg-white/5 text-white/50' },
    'error': { label: 'Error', color: 'bg-red-500/20 text-red-300' },
    'not-configured': { label: 'Not configured', color: 'bg-amber-500/20 text-amber-300' },
  }
  const m = map[state]
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${m.color}`}>
      {m.label}
    </span>
  )
}
