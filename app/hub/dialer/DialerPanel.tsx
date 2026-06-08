'use client'

import { useState, useCallback, useEffect } from 'react'
import { useTwilioDevice } from '@/hooks/use-twilio-device'
import Dialpad from '@/components/hub/dialer/Dialpad'
import ActiveCall from '@/components/hub/dialer/ActiveCall'
import IncomingCall from '@/components/hub/dialer/IncomingCall'
import { useDialerContext } from '@/components/hub/dialer/DialerProvider'

export default function DialerPanel({
  initialNumber = null,
  txtConversationId = null,
  txtContactId = null,
}: {
  initialNumber?: string | null
  txtConversationId?: string | null
  txtContactId?: string | null
}) {
  // Session 58.5: consume the lifted Device from HubShell when available so
  // the same Twilio Voice connection is reused instead of spinning up a second
  // one on this page. When the provider isn't mounted (user opted out of
  // dialer_global_ring, or this page is rendered outside HubShell), fall back
  // to a local autoRegister instance — original Session 56 behavior.
  const ctxDevice = useDialerContext()
  const localDevice = useTwilioDevice({ autoRegister: !ctxDevice })
  const device = ctxDevice ?? localDevice

  // Recording settings — fetched once on mount so we know whether to show
  // the recording indicator + pause button. Defaults to off; if the fetch
  // fails or the user lacks admin access it stays off (harmless).
  const [recordingEnabled, setRecordingEnabled] = useState(false)
  const [pauseAutoResumeSec, setPauseAutoResumeSec] = useState(60)
  useEffect(() => {
    fetch('/api/dialer/settings/recording').then(r => r.ok ? r.json() : null).then(d => {
      if (!d) return
      setRecordingEnabled(!!d.recording_enabled)
      if (d.recording_pause_auto_resume_sec) setPauseAutoResumeSec(d.recording_pause_auto_resume_sec)
    }).catch(() => {})
  }, [])

  const [recordingPaused, setRecordingPaused] = useState(false)

  // Reset pause state when the call ends.
  useEffect(() => {
    if (device.state !== 'in-call') setRecordingPaused(false)
  }, [device.state])

  const handleToggleRecordingPause = useCallback(async () => {
    const action = recordingPaused ? 'resume' : 'pause'
    setRecordingPaused(!recordingPaused)
    try {
      const res = await fetch('/api/dialer/voice/recording/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        // Revert if the API call failed.
        setRecordingPaused(recordingPaused)
      }
    } catch {
      setRecordingPaused(recordingPaused)
    }
  }, [recordingPaused])

  const showActiveCall = device.state === 'placing' || device.state === 'in-call'
  // When the provider is mounted, DialerProvider already renders the
  // IncomingCall overlay at shell level — don't double-render here.
  const showIncoming = !ctxDevice && device.state === 'incoming'

  return (
    <div className="h-full flex flex-col">
      <div className="flex-none px-4 py-2 md:py-3 border-b border-white/5">
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

      <div className="flex-1 overflow-y-auto px-4 py-3 md:py-6 flex flex-col items-center justify-center">
        {showActiveCall ? (
          <ActiveCall
            status={device.state === 'placing' ? 'placing' : 'in-call'}
            who={device.inCallWith}
            startedAt={device.callStartedAt}
            muted={device.muted}
            onToggleMute={device.toggleMute}
            held={device.held}
            holdSupported={device.holdSupported}
            onToggleHold={device.toggleHold}
            onSendDigit={device.sendDigit}
            onHangup={device.hangup}
            recordingEnabled={recordingEnabled}
            recordingPaused={recordingPaused}
            onToggleRecordingPause={handleToggleRecordingPause}
            pauseAutoResumeSec={pauseAutoResumeSec}
          />
        ) : (
          <Dialpad
            // key forces a remount when the user arrives via click-to-call
            // with a different number (e.g. swaps Txt threads then re-clicks
            // 📞). Keeps the rest of DialerPanel — and the Twilio Device —
            // alive across that nav.
            key={initialNumber ?? 'manual'}
            initialValue={initialNumber ?? undefined}
            onCall={(num) =>
              device.placeCall(num, {
                conversationId: txtConversationId,
                contactId: txtContactId,
              })
            }
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
