'use client'

// Session 1 (Desktop Dialer Control) — the persistent global call bar.
//
// Supersedes the Session 58.5 ActiveCallBanner (which could only navigate back
// to /hub/dialer). This bar lives on EVERY Hub page via the shell, reads the
// shared call state from DialerProvider, and exposes the call controls inline so
// a user keeps full call control while working anywhere in Hub:
//   - slim docked bar: caller + live timer + Mute / Hold / Transfer / End
//   - Expand → drops the full in-call dialer (the existing ActiveCall: DTMF
//     keypad, transfer panel, audio-route picker) WITHOUT navigating away.
//   - tap the caller label → jump to /hub/dialer (preserves the 58.5 affordance).
//
// Capability-gating mirrors the dialer page: Hold only when the active call
// supports it (conference room or hold-capable native build), Transfer only on a
// conference call. No provider context (non-dialer user) → renders nothing.
// Hidden on /hub/dialer itself, where the full DialerPanel already renders.

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useDialerContext, usePipControls } from './DialerProvider'
import ActiveCall from './ActiveCall'

function formatPhone(raw: string | null): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return raw
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const mm = Math.floor(total / 60)
  const ss = total % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

export default function GlobalCallBar() {
  const device = useDialerContext()
  const pip = usePipControls()
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  // When the slim-bar Transfer button is what opened the panel, mount ActiveCall
  // straight into its transfer form (vs. the generic action grid the chevron opens).
  const [transferIntent, setTransferIntent] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const inActiveCall = !!device && (device.state === 'placing' || device.state === 'in-call')

  // Tick once a second so the bar timer updates while a call is live.
  useEffect(() => {
    if (!inActiveCall) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [inActiveCall])

  // Collapse the expanded dialer when the call ends.
  useEffect(() => {
    if (!inActiveCall) {
      setExpanded(false)
      setTransferIntent(false)
    }
  }, [inActiveCall])

  // Recording settings — mirror DialerPanel so the expanded ActiveCall shows the
  // REC indicator + pause control with the same behavior off-page as on it. The
  // bar never renders on /hub/dialer, so there's no double pause-state conflict.
  const [recordingEnabled, setRecordingEnabled] = useState(false)
  const [pauseAutoResumeSec, setPauseAutoResumeSec] = useState(60)
  const [recordingPaused, setRecordingPaused] = useState(false)

  useEffect(() => {
    if (!device) return
    fetch('/api/dialer/settings/recording')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        setRecordingEnabled(!!d.recording_enabled)
        if (d.recording_pause_auto_resume_sec) setPauseAutoResumeSec(d.recording_pause_auto_resume_sec)
      })
      .catch(() => {})
  }, [device])

  useEffect(() => {
    if (!inActiveCall) setRecordingPaused(false)
  }, [inActiveCall])

  const handleToggleRecordingPause = useCallback(async () => {
    const action = recordingPaused ? 'resume' : 'pause'
    setRecordingPaused(!recordingPaused)
    try {
      const res = await fetch('/api/dialer/voice/recording/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) setRecordingPaused(recordingPaused)
    } catch {
      setRecordingPaused(recordingPaused)
    }
  }, [recordingPaused])

  if (!device) return null
  if (!inActiveCall) return null

  // On the dialer page the full DialerPanel is already on screen — no bar.
  const onDialerPage = pathname === '/hub/dialer' || pathname.startsWith('/hub/dialer/')
  if (onDialerPage) return null

  const elapsed = device.callStartedAt ? now - device.callStartedAt : 0
  const label =
    device.state === 'placing'
      ? `Dialing ${formatPhone(device.inCallWith)}…`
      : `${formatPhone(device.inCallWith) || 'On call'} · ${formatDuration(elapsed)}`

  const showHold = device.holdSupported
  const showTransfer = device.conferenceActive

  return (
    <div className="relative flex-none z-40">
      {/* Slim docked bar */}
      <div
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-white text-sm border-b ${
          device.held
            ? 'bg-amber-700/90 border-amber-900/40'
            : 'bg-emerald-700/95 border-emerald-900/40'
        }`}
      >
        {/* Caller label + timer → tap returns to the full dialer page */}
        <button
          type="button"
          onClick={() => router.push('/hub/dialer')}
          className="flex items-center gap-2 min-w-0 flex-1 text-left hover:opacity-90"
          aria-label="Open dialer"
        >
          <svg className="w-4 h-4 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 4h3l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v3a2 2 0 01-2 2A14 14 0 014 6a2 2 0 012-2z" />
          </svg>
          <span className="truncate font-medium">{device.held ? `On hold · ${label}` : label}</span>
        </button>

        {/* Inline controls */}
        <div className="flex items-center gap-1.5 flex-none">
          <BarButton
            active={device.muted}
            onClick={device.toggleMute}
            label={device.muted ? 'Unmute' : 'Mute'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              {device.muted ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l4-4m0 4l-4-4" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              )}
            </svg>
          </BarButton>

          {showHold && (
            <BarButton
              active={device.held}
              onClick={device.toggleHold}
              label={device.held ? 'Resume' : 'Hold'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                {device.held ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.05 4.575a1.575 1.575 0 10-3.15 0v3m3.15-3v-1.5a1.575 1.575 0 013.15 0v1.5m-3.15 0l.075 5.925m3.075.75V4.575m0 0a1.575 1.575 0 013.15 0V15M6.9 7.575a1.575 1.575 0 10-3.15 0v8.175a6.75 6.75 0 006.75 6.75h2.018a5.25 5.25 0 003.712-1.538l1.732-1.732a5.25 5.25 0 001.538-3.712l.003-2.024a.668.668 0 01.198-.471 1.575 1.575 0 10-2.228-2.228 3.818 3.818 0 00-1.12 2.687M6.9 7.575V12m6.27 4.318A4.49 4.49 0 0116.35 15m.002 0h-.002" />
                )}
              </svg>
            </BarButton>
          )}

          {showTransfer && (
            <BarButton
              active={expanded && transferIntent}
              onClick={() => { setTransferIntent(true); setExpanded(true) }}
              label="Transfer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </BarButton>
          )}

          {/* Pop out to a floating Picture-in-Picture window (Chromium only —
              hidden where Document PiP is unsupported: Safari / native / Electron
              old). Floats above all desktop apps so the user keeps call control
              while working elsewhere; persists across calls once opened. */}
          {pip?.supported && (
            <BarButton
              active={pip.isOpen}
              onClick={() => (pip.isOpen ? pip.close() : pip.open())}
              label={pip.isOpen ? 'Close pop-out' : 'Pop out'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 4h6m0 0v6m0-6L10 14M19 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h4" />
              </svg>
            </BarButton>
          )}

          {/* Expand / collapse the full inline dialer */}
          <BarButton
            active={expanded && !transferIntent}
            onClick={() => { setTransferIntent(false); setExpanded((v) => !v) }}
            label={expanded ? 'Collapse' : 'Expand'}
          >
            <svg
              className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </BarButton>

          {/* End call */}
          <button
            type="button"
            onClick={device.hangup}
            className="ml-0.5 w-8 h-8 rounded-full bg-red-600 hover:bg-red-500 active:scale-95 transition-all flex items-center justify-center flex-none"
            aria-label="End call"
          >
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" transform="rotate(135 12 12)" d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.8a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.35 1.84.59 2.8.72A2 2 0 0122 16.92z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded full in-call dialer — absolute overlay so it never reflows the
          page. Reuses the existing ActiveCall component for keypad / transfer /
          audio-route, so it stays in lockstep with the /hub/dialer experience. */}
      {expanded && (
        <div className="absolute top-full left-0 right-0 z-50 bg-[#0b2236] border-b border-white/10 shadow-2xl px-4 py-5 max-h-[70vh] overflow-y-auto">
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
            autoOpenTransfer={transferIntent}
          />
        </div>
      )}
    </div>
  )
}

function BarButton({
  children,
  onClick,
  active,
  label,
}: {
  children: ReactNode
  onClick: () => void
  active: boolean
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors flex-none ${
        active ? 'bg-white text-gray-900' : 'bg-white/15 text-white hover:bg-white/25'
      }`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}
