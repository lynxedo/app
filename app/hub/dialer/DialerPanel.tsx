'use client'

import { useState, useCallback, useEffect } from 'react'
import { useTwilioDevice } from '@/hooks/use-twilio-device'
import { friendlyCallError } from '@/lib/dialer-errors'
import Dialpad from '@/components/hub/dialer/Dialpad'
import ActiveCall from '@/components/hub/dialer/ActiveCall'
import AudioDevicePicker from '@/components/hub/dialer/AudioDevicePicker'
import IncomingCall from '@/components/hub/dialer/IncomingCall'
import CallWaiting from '@/components/hub/dialer/CallWaiting'
import { useDialerContext, usePipControls } from '@/components/hub/dialer/DialerProvider'
import { formatPhone } from '@/lib/format'

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

  // Session 3: pop the dialer out into a floating Document PiP window. Available
  // even when idle, so the PiP is a standalone floating softphone (it shows the
  // full dial pad until a call starts). Only present when the shell provider is
  // mounted (global-ring users) and Document PiP is supported (Chromium).
  const pip = usePipControls()

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
  const [showAudioSetup, setShowAudioSetup] = useState(false)

  // From-number picker. /api/txt/numbers returns this user's access-allowed
  // numbers (the shared registry, filtered by user_phone_number_access). We only
  // surface the picker when there's a real choice (>1 number); with one number
  // the dialer just uses it / the company default, no clutter.
  const [numbers, setNumbers] = useState<
    { id: string; twilio_number: string; label: string | null; is_default: boolean }[]
  >([])
  const [fromNumber, setFromNumber] = useState<string>('')
  useEffect(() => {
    fetch('/api/txt/numbers')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const nums = (d?.numbers || []) as typeof numbers
        setNumbers(nums)
        const def = nums.find((n) => n.is_default) || nums[0]
        if (def) setFromNumber(def.twilio_number)
      })
      .catch(() => {})
  }, [])

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
      <div className="flex-none px-4 py-2 md:py-3 border-b border-white/5 max-md:pl-14">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Dialer</h1>
          <div className="flex items-center gap-2">
            {pip?.supported && !pip.isOpen && (
              <button
                type="button"
                onClick={pip.open}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white/80 transition-colors"
                title="Pop the dialer out into a floating window"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 4h6m0 0v6m0-6L10 14M19 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h4" />
                </svg>
                Pop out
              </button>
            )}
            <StatusPill state={device.state} />
          </div>
        </div>
        {device.errorMessage && device.state === 'error' && (
          <div className="mt-2 text-xs text-red-300 bg-red-900/30 border border-red-800 rounded px-2 py-1">
            {friendlyCallError(device.errorMessage)}
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
            audioRoute={device.audioRoute}
            audioRouteSupported={device.audioRouteSupported}
            audioRoutesAvailable={device.audioRoutesAvailable}
            onSetAudioRoute={device.setAudioRoute}
            conferenceActive={device.conferenceActive}
            consulting={device.consulting}
            onTransfer={device.transfer}
            onSendDigit={device.sendDigit}
            onHangup={device.hangup}
            recordingEnabled={recordingEnabled}
            recordingPaused={recordingPaused}
            onToggleRecordingPause={handleToggleRecordingPause}
            pauseAutoResumeSec={pauseAutoResumeSec}
            audioDeviceSupported={device.audioDeviceSupported}
            audioInputs={device.audioInputs}
            audioOutputs={device.audioOutputs}
            selectedInputId={device.selectedInputId}
            selectedOutputId={device.selectedOutputId}
            outputSelectionSupported={device.outputSelectionSupported}
            onSelectAudioInput={device.setAudioInput}
            onSelectAudioOutput={device.setAudioOutput}
            onTestAudioOutput={device.testAudioOutput}
            onOpenAudioDevices={device.ensureAudioDevices}
            headsetMode={device.headsetMode}
            onToggleHeadsetMode={device.setHeadsetMode}
            contact={device.contactMatch}
          />
        ) : (
          <div className="flex flex-col items-center gap-3">
            {numbers.length > 1 && (
              <label className="flex items-center gap-2 text-xs text-white/60">
                <span>Call from</span>
                <select
                  value={fromNumber}
                  onChange={(e) => setFromNumber(e.target.value)}
                  className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white/80 text-xs"
                >
                  {numbers.map((n) => (
                    <option key={n.id} value={n.twilio_number}>
                      {n.label ? `${n.label} · ${formatPhone(n.twilio_number)}` : formatPhone(n.twilio_number)}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
                  callerId: fromNumber || null,
                })
              }
              disabled={device.state === 'not-configured' || device.state === 'connecting'}
            />
            {device.audioDeviceSupported && (
              <div className="w-full max-w-xs">
                <button
                  type="button"
                  onClick={() => { if (!showAudioSetup) device.ensureAudioDevices(); setShowAudioSetup((v) => !v) }}
                  className="flex items-center gap-1.5 mx-auto text-xs text-white/50 hover:text-white/80 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 13v-1a8 8 0 1116 0v1" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2 16a2 2 0 012-2h1v5H4a2 2 0 01-2-2v-1zm18-2a2 2 0 012 2v1a2 2 0 01-2 2h-1v-5h1z" />
                  </svg>
                  {showAudioSetup ? 'Hide audio settings' : 'Audio settings'}
                </button>
                {showAudioSetup && (
                  <div className="mt-3">
                    <AudioDevicePicker
                      inputs={device.audioInputs}
                      outputs={device.audioOutputs}
                      selectedInputId={device.selectedInputId}
                      selectedOutputId={device.selectedOutputId}
                      outputSelectionSupported={device.outputSelectionSupported}
                      onSelectInput={device.setAudioInput}
                      onSelectOutput={device.setAudioOutput}
                      onTest={device.testAudioOutput}
                      headsetMode={device.headsetMode}
                      onToggleHeadsetMode={device.setHeadsetMode}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
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
          contact={device.contactMatch}
          onAccept={device.acceptIncoming}
          onReject={device.rejectIncoming}
        />
      )}
      {/* Silent call-waiting notice — only on the fallback (no-provider) path, so
          it isn't double-rendered when DialerProvider is mounted at shell level. */}
      {!ctxDevice && device.waitingFrom && (
        <CallWaiting
          from={device.waitingFrom}
          contact={device.waitingContactMatch}
          onDismiss={device.dismissWaiting}
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
