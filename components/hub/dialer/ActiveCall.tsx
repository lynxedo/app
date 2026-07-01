'use client'

import { useEffect, useState, useRef, type ReactNode } from 'react'
import { formatPhone } from '@/lib/format'
import { nativePlatform, type NativeAudioRoute } from '@/lib/native-voice'
import type { DialerLookupMatch } from '@/lib/dialer-lookup'
import CallContactCard from './CallContactCard'
import AudioDevicePicker from './AudioDevicePicker'

const DTMF_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']

// The earpiece/handset route is named after the device it represents: "iPhone"
// on iOS, "Phone" on Android (and as a sane default elsewhere).
function audioRouteLabel(route: NativeAudioRoute): string {
  if (route === 'speaker') return 'Speaker'
  if (route === 'bluetooth') return 'Bluetooth'
  return nativePlatform() === 'ios' ? 'iPhone' : 'Phone'
}

// Stroked-outline glyphs (24×24, stroke-width 1.8) for each output route.
function AudioRouteIcon({ route }: { route: NativeAudioRoute }) {
  if (route === 'speaker') {
    return (
      <svg className="w-6 h-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H2v6h4l5 4V5z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.54 8.46a5 5 0 010 7.07M18.36 5.64a9 9 0 010 12.73" />
      </svg>
    )
  }
  if (route === 'bluetooth') {
    return (
      <svg className="w-6 h-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 7l10 10-5 4V3l5 4L7 17" />
      </svg>
    )
  }
  // earpiece / default — a phone handset
  return (
    <svg className="w-6 h-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.8a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.35 1.84.59 2.8.72A2 2 0 0122 16.92z" />
    </svg>
  )
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}


export default function ActiveCall({
  status,
  who,
  startedAt,
  muted,
  onToggleMute,
  held = false,
  holdSupported = false,
  onToggleHold,
  audioRoute = 'earpiece',
  audioRouteSupported = false,
  audioRoutesAvailable = ['earpiece', 'speaker'],
  onSetAudioRoute,
  conferenceActive = false,
  consulting = false,
  onTransfer,
  onSendDigit,
  onHangup,
  recordingEnabled = false,
  recordingPaused = false,
  onToggleRecordingPause,
  pauseAutoResumeSec = 60,
  autoOpenTransfer = false,
  audioDeviceSupported = false,
  audioInputs = [],
  audioOutputs = [],
  selectedInputId = null,
  selectedOutputId = null,
  outputSelectionSupported = false,
  onSelectAudioInput,
  onSelectAudioOutput,
  onTestAudioOutput,
  onOpenAudioDevices,
  contact = null,
}: {
  status: 'placing' | 'in-call'
  who: string | null
  startedAt: number | null
  muted: boolean
  onToggleMute: () => void
  held?: boolean
  holdSupported?: boolean
  onToggleHold?: () => void
  audioRoute?: NativeAudioRoute
  audioRouteSupported?: boolean
  audioRoutesAvailable?: NativeAudioRoute[]
  onSetAudioRoute?: (route: NativeAudioRoute) => void
  conferenceActive?: boolean
  consulting?: boolean
  onTransfer?: (mode: 'cold' | 'warm-consult' | 'warm-complete' | 'warm-cancel', to?: string) => Promise<{ ok: boolean; error?: string }>
  onSendDigit: (d: string) => void
  onHangup: () => void
  recordingEnabled?: boolean
  recordingPaused?: boolean
  onToggleRecordingPause?: () => void
  pauseAutoResumeSec?: number
  // When true, mount with the transfer entry panel already open. Used by the
  // GlobalCallBar so its slim-bar Transfer button is a one-tap shortcut into
  // the transfer form instead of dropping the user on the generic action grid.
  autoOpenTransfer?: boolean
  // Web audio device selection (mic + speaker picker). Hidden on native, which
  // uses the earpiece/speaker route picker (audioRoute*) instead.
  audioDeviceSupported?: boolean
  audioInputs?: { deviceId: string; label: string }[]
  audioOutputs?: { deviceId: string; label: string }[]
  selectedInputId?: string | null
  selectedOutputId?: string | null
  outputSelectionSupported?: boolean
  onSelectAudioInput?: (id: string) => void
  onSelectAudioOutput?: (id: string) => void
  onTestAudioOutput?: () => void
  onOpenAudioDevices?: () => void
  // Session 4/6: the matched customer identity for the screen-pop card + the
  // in-call quick actions (text / on-my-way / note / open-in-Jobber).
  contact?: DialerLookupMatch | null
}) {
  const [now, setNow] = useState(() => Date.now())
  const [showKeypad, setShowKeypad] = useState(false)
  const [showAudio, setShowAudio] = useState(false)
  const [showDevices, setShowDevices] = useState(false)
  // Transfer panel state.
  const [showTransfer, setShowTransfer] = useState(autoOpenTransfer)
  const [transferTarget, setTransferTarget] = useState('')
  const [transferBusy, setTransferBusy] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)
  // Countdown until auto-resume. Only active when recording is paused.
  const [countdown, setCountdown] = useState(0)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (status !== 'in-call') return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [status])

  // Start countdown when recording is paused, clear when resumed.
  useEffect(() => {
    if (recordingPaused && pauseAutoResumeSec > 0) {
      setCountdown(pauseAutoResumeSec)
      countdownRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            // Time's up — auto-resume.
            clearInterval(countdownRef.current!)
            onToggleRecordingPause?.()
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } else {
      if (countdownRef.current) clearInterval(countdownRef.current)
      setCountdown(0)
    }
    return () => { if (countdownRef.current) clearInterval(countdownRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingPaused])

  const elapsed = startedAt && status === 'in-call' ? Math.floor((now - startedAt) / 1000) : 0

  async function runTransfer(mode: 'cold' | 'warm-consult' | 'warm-complete' | 'warm-cancel') {
    if (!onTransfer) return
    if ((mode === 'cold' || mode === 'warm-consult') && !transferTarget.trim()) {
      setTransferError('Enter a number or extension')
      return
    }
    setTransferBusy(true)
    setTransferError(null)
    const res = await onTransfer(mode, transferTarget.trim() || undefined)
    setTransferBusy(false)
    if (!res.ok) {
      setTransferError(res.error || 'Transfer failed')
      return
    }
    // cold / warm-complete drop our leg → the call ends and this unmounts.
    // warm-consult moves into the consult panel; warm-cancel returns to the call.
    if (mode === 'warm-cancel') {
      setShowTransfer(false)
      setTransferTarget('')
    }
  }

  // In-call action buttons, assembled so the grid stays centered regardless of
  // which optional controls (Hold, recording Pause) are present.
  const actionButtons: ReactNode[] = [
    <button
      key="mute"
      type="button"
      onClick={onToggleMute}
      className={`aspect-square rounded-full flex flex-col items-center justify-center text-xs ${
        muted ? 'bg-white text-gray-900' : 'bg-white/5 text-white hover:bg-white/10'
      }`}
      aria-label="Mute"
    >
      <svg className="w-6 h-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        {muted ? (
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l4-4m0 4l-4-4" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M19.07 4.929a10 10 0 010 14.142M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
        )}
      </svg>
      <span>{muted ? 'Muted' : 'Mute'}</span>
    </button>,
    <button
      key="keypad"
      type="button"
      onClick={() => setShowKeypad(true)}
      disabled={status !== 'in-call'}
      className="aspect-square rounded-full bg-white/5 hover:bg-white/10 flex flex-col items-center justify-center text-xs text-white disabled:opacity-40"
      aria-label="Keypad"
    >
      <svg className="w-6 h-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 7h.01M5 12h.01M5 17h.01M12 7h.01M12 12h.01M12 17h.01M19 7h.01M19 12h.01M19 17h.01" />
      </svg>
      <span>Keypad</span>
    </button>,
  ]

  if (holdSupported && onToggleHold) {
    actionButtons.push(
      <button
        key="hold"
        type="button"
        onClick={onToggleHold}
        disabled={status !== 'in-call'}
        className={`aspect-square rounded-full flex flex-col items-center justify-center text-xs disabled:opacity-40 ${
          held ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' : 'bg-white/5 text-white hover:bg-white/10'
        }`}
        aria-label={held ? 'Resume call' : 'Hold call'}
      >
        <svg className="w-6 h-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          {held ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.05 4.575a1.575 1.575 0 10-3.15 0v3m3.15-3v-1.5a1.575 1.575 0 013.15 0v1.5m-3.15 0l.075 5.925m3.075.75V4.575m0 0a1.575 1.575 0 013.15 0V15M6.9 7.575a1.575 1.575 0 10-3.15 0v8.175a6.75 6.75 0 006.75 6.75h2.018a5.25 5.25 0 003.712-1.538l1.732-1.732a5.25 5.25 0 001.538-3.712l.003-2.024a.668.668 0 01.198-.471 1.575 1.575 0 10-2.228-2.228 3.818 3.818 0 00-1.12 2.687M6.9 7.575V12m6.27 4.318A4.49 4.49 0 0116.35 15m.002 0h-.002" />
          )}
        </svg>
        <span>{held ? 'Resume' : 'Hold'}</span>
      </button>
    )
  }

  if (audioRouteSupported && onSetAudioRoute) {
    actionButtons.push(
      <button
        key="audio"
        type="button"
        onClick={() => setShowAudio(true)}
        disabled={status !== 'in-call'}
        className={`aspect-square rounded-full flex flex-col items-center justify-center text-xs disabled:opacity-40 ${
          audioRoute !== 'earpiece' ? 'bg-sky-500/20 text-sky-300 hover:bg-sky-500/30' : 'bg-white/5 text-white hover:bg-white/10'
        }`}
        aria-label="Audio output"
      >
        <AudioRouteIcon route={audioRoute} />
        <span>{audioRouteLabel(audioRoute)}</span>
      </button>
    )
  }

  // Web mic/speaker picker (desktop/browser). Mutually exclusive with the native
  // route button above. Usable while placing too, so no in-call-only disable.
  if (audioDeviceSupported) {
    actionButtons.push(
      <button
        key="devices"
        type="button"
        onClick={() => { onOpenAudioDevices?.(); setShowDevices(true) }}
        className="aspect-square rounded-full bg-white/5 hover:bg-white/10 flex flex-col items-center justify-center text-xs text-white"
        aria-label="Audio devices"
      >
        <svg className="w-6 h-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 13v-1a8 8 0 1116 0v1" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M2 16a2 2 0 012-2h1v5H4a2 2 0 01-2-2v-1zm18-2a2 2 0 012 2v1a2 2 0 01-2 2h-1v-5h1z" />
        </svg>
        <span>Audio</span>
      </button>
    )
  }

  if (conferenceActive && onTransfer) {
    actionButtons.push(
      <button
        key="transfer"
        type="button"
        onClick={() => { setShowTransfer(true); setTransferError(null) }}
        disabled={status !== 'in-call'}
        className="aspect-square rounded-full bg-white/5 hover:bg-white/10 flex flex-col items-center justify-center text-xs text-white disabled:opacity-40"
        aria-label="Transfer call"
      >
        <svg className="w-6 h-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" />
        </svg>
        <span>Transfer</span>
      </button>
    )
  }

  if (recordingEnabled && onToggleRecordingPause) {
    actionButtons.push(
      <button
        key="rec"
        type="button"
        onClick={onToggleRecordingPause}
        disabled={status !== 'in-call'}
        className={`aspect-square rounded-full flex flex-col items-center justify-center text-xs disabled:opacity-40 ${
          recordingPaused ? 'bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30' : 'bg-white/5 text-white hover:bg-white/10'
        }`}
        aria-label={recordingPaused ? 'Resume recording' : 'Pause recording'}
      >
        <svg className="w-6 h-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          {recordingPaused ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6" />
          )}
        </svg>
        <span>{recordingPaused ? 'Resume' : 'Pause'}</span>
      </button>
    )
  }

  // Pad to a full row of three so an incomplete last row stays centered.
  while (actionButtons.length % 3 !== 0) {
    actionButtons.push(<div key={`filler-${actionButtons.length}`} />)
  }

  return (
    <div className="w-full max-w-xs mx-auto text-center">
      <div className="text-white/50 text-sm mb-2">
        {status === 'placing' ? 'Calling…' : held ? 'On hold' : 'On call'}
      </div>
      <div className="text-2xl font-light text-white mb-1">{formatPhone(who)}</div>
      <div className="text-white/50 text-sm mb-2">
        {status === 'in-call' ? formatTimer(elapsed) : '—'}
      </div>

      {/* Recording indicator */}
      {recordingEnabled && status === 'in-call' && (
        <div className="mb-4">
          {recordingPaused ? (
            <div className="space-y-1">
              <div className="flex items-center justify-center gap-1.5 text-yellow-400 text-xs font-medium">
                <span className="w-2 h-2 rounded-full bg-yellow-400" />
                Recording paused
              </div>
              <p className="text-white/40 text-xs">
                Auto-resume in {countdown}s
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-1.5 text-red-400 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              REC
            </div>
          )}
        </div>
      )}

      {/* Screen-pop identity + in-call quick actions (Sessions 4 + 6). Shown for
          real outside numbers, hidden for extension/internal dials. */}
      {who && who.replace(/\D/g, '').length >= 10 && !showTransfer && !consulting && !showAudio && !showDevices && (
        <div className="mb-4 max-w-xs mx-auto">
          <CallContactCard contact={contact} number={who} />
        </div>
      )}

      {consulting ? (
        // Warm transfer mid-consult: customer is on hold, agent talking to the
        // target. Merge them (drop self) or cancel back to the customer.
        <div className="mb-5 max-w-xs mx-auto space-y-3">
          <div className="text-amber-300 text-sm">Consulting — customer is on hold</div>
          {transferError && <div className="text-red-300 text-xs">{transferError}</div>}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => runTransfer('warm-complete')}
              disabled={transferBusy}
              className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm py-2.5 disabled:opacity-50"
            >
              Complete transfer
            </button>
            <button
              type="button"
              onClick={() => runTransfer('warm-cancel')}
              disabled={transferBusy}
              className="rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm py-2.5 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : showTransfer ? (
        // Transfer entry: pick a target, then warm (consult first) or cold (blind).
        <div className="mb-5 max-w-xs mx-auto space-y-3">
          <input
            type="tel"
            inputMode="tel"
            value={transferTarget}
            onChange={(e) => setTransferTarget(e.target.value)}
            placeholder="Number or extension"
            className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-base text-white placeholder-white/30 text-center"
          />
          {transferError && <div className="text-red-300 text-xs">{transferError}</div>}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => runTransfer('warm-consult')}
              disabled={transferBusy}
              className="rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm py-2.5 disabled:opacity-50"
            >
              Warm (talk first)
            </button>
            <button
              type="button"
              onClick={() => runTransfer('cold')}
              disabled={transferBusy}
              className="rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm py-2.5 disabled:opacity-50"
            >
              Cold (blind)
            </button>
          </div>
          <button
            type="button"
            onClick={() => { setShowTransfer(false); setTransferError(null) }}
            className="text-white/50 hover:text-white text-xs"
          >
            Back
          </button>
        </div>
      ) : showAudio ? (
        // Audio output picker. Only routes the device actually offers are shown
        // (Bluetooth appears when a headset is connected).
        <div className="mb-5 max-w-xs mx-auto space-y-2">
          {audioRoutesAvailable.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => { onSetAudioRoute?.(r); setShowAudio(false) }}
              className={`w-full flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm ${
                audioRoute === r
                  ? 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/30'
                  : 'bg-white/5 text-white hover:bg-white/10'
              }`}
            >
              <span className="[&>svg]:w-5 [&>svg]:h-5 [&>svg]:mb-0 flex">
                <AudioRouteIcon route={r} />
              </span>
              <span>{audioRouteLabel(r)}</span>
              {audioRoute === r && <span className="ml-auto text-sky-300">✓</span>}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowAudio(false)}
            className="text-white/50 hover:text-white text-xs pt-1"
          >
            Back
          </button>
        </div>
      ) : showDevices ? (
        <div className="mb-5 max-w-xs mx-auto">
          <AudioDevicePicker
            inputs={audioInputs}
            outputs={audioOutputs}
            selectedInputId={selectedInputId}
            selectedOutputId={selectedOutputId}
            outputSelectionSupported={outputSelectionSupported}
            onSelectInput={(id) => onSelectAudioInput?.(id)}
            onSelectOutput={(id) => onSelectAudioOutput?.(id)}
            onTest={() => onTestAudioOutput?.()}
          />
          <button
            type="button"
            onClick={() => setShowDevices(false)}
            className="text-white/50 hover:text-white text-xs pt-3"
          >
            Back
          </button>
        </div>
      ) : showKeypad ? (
        <div className="grid grid-cols-3 gap-3 mb-5 max-w-xs mx-auto">
          {DTMF_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onSendDigit(k)}
              className="aspect-square rounded-full bg-white/5 hover:bg-white/10 active:bg-white/20 text-xl font-light text-white"
            >
              {k}
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 mb-5 max-w-xs mx-auto">
          {actionButtons}
        </div>
      )}

      {showKeypad && !showTransfer && !consulting && (
        <button
          type="button"
          onClick={() => setShowKeypad(false)}
          className="text-white/50 hover:text-white text-xs mb-4"
        >
          Hide keypad
        </button>
      )}

      <button
        type="button"
        onClick={onHangup}
        className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 active:scale-95 transition-all flex items-center justify-center shadow-lg mx-auto"
        aria-label="Hang up"
      >
        <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" transform="rotate(135 12 12)" d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.8a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.35 1.84.59 2.8.72A2 2 0 0122 16.92z" />
        </svg>
      </button>
    </div>
  )
}
