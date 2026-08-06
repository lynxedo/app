'use client'

// Mic + speaker picker for the WEB softphone — the desktop/browser equivalent
// of the native earpiece/speaker route picker. Device selection + persistence
// lives in use-twilio-device; the live mic meter below is self-contained (see
// MicLevelMeter). Rendered wherever the call controls are (ActiveCall) and on
// the idle dialer so a user can pick their headset before dialing. Hidden on
// native (audioDeviceSupported is false).

import { useEffect, useState } from 'react'

type AudioDevice = { deviceId: string; label: string }

// Live input level for the selected mic, so "can the customer hear me?" is
// answerable on the spot instead of by calling someone back. The speaker has a
// Test button; this is the mic's equivalent — a bar that moves when you talk.
//
// It opens its own stream rather than tapping the Twilio SDK's (that stream is
// private API, and it doesn't exist at all while idle). The Dialer otherwise
// never holds the mic open when there's no call — so this runs ONLY while the
// audio panel is on screen (the user deliberately opened it to test) and every
// exit path below stops the tracks and closes the AudioContext.
function MicLevelMeter({ deviceId }: { deviceId: string | null }) {
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let raf = 0
    let cancelled = false

    const stop = () => {
      cancelled = true
      if (raf) cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      ctx?.close().catch(() => {})
      stream = null
      ctx = null
    }

    void (async () => {
      setError(null)
      try {
        stream =
          deviceId && deviceId !== 'default'
            ? await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } })
            : await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        // Saved device gone (or exact-match refused) — fall back to the default
        // mic so the meter can still say whether ANY mic is picking sound up.
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        } catch {
          if (!cancelled) setError('Can’t open the microphone — check the mic permission for this site.')
          return
        }
      }
      if (cancelled || !stream) {
        stream?.getTracks().forEach((t) => t.stop())
        return
      }
      try {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctor) throw new Error('no AudioContext')
        ctx = new Ctor()
        // A context created without user activation starts suspended, and a
        // suspended graph feeds the analyser pure silence — the bar would sit
        // flat and tell the user their working mic is dead. Opening this panel
        // is a click, so resume() should succeed; if it somehow doesn't, say so
        // instead of showing a flat bar we can't trust.
        if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
        if (cancelled) return
        if (ctx.state !== 'running') {
          setError('Click anywhere on the page, then reopen audio settings to test your mic.')
          return
        }
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        ctx.createMediaStreamSource(stream).connect(analyser)
        const buf = new Uint8Array(analyser.frequencyBinCount)
        const tick = () => {
          if (cancelled) return
          analyser.getByteTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128
            sum += v * v
          }
          const rms = Math.sqrt(sum / buf.length)
          // ×4 puts normal speech near full scale (a quiet room sits ~0.02).
          // Decay the previous value so the bar falls smoothly instead of
          // flickering between frames.
          setLevel((prev) => Math.max(Math.min(rms * 4, 1), prev * 0.82))
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      } catch {
        if (!cancelled) setError('This browser can’t show a mic level.')
      }
    })()

    return stop
  }, [deviceId])

  const pct = Math.round(level * 100)

  return (
    <div className="space-y-1 pt-0.5">
      <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden" aria-hidden>
        <div
          // Green only once there's real speech. Verified against synthetic
          // levels: a quiet room reads ~5% and stays grey; soft speech ~22%
          // and normal speech ~42% turn it green.
          className={`h-full rounded-full ${pct >= 8 ? 'bg-emerald-400' : 'bg-white/20'}`}
          style={{ width: `${Math.max(pct, 2)}%`, transition: 'width 80ms linear' }}
        />
      </div>
      <p className="px-1 text-xs text-white/40">
        {error ?? 'Talk — this bar should move. If it stays flat, the customer can’t hear you.'}
      </p>
    </div>
  )
}

function MicIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2M12 19v3" />
    </svg>
  )
}

function SpeakerIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H2v6h4l5 4V5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.54 8.46a5 5 0 010 7.07M18.36 5.64a9 9 0 010 12.73" />
    </svg>
  )
}

function DeviceRow({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left ${
        selected
          ? 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/30'
          : 'bg-white/5 text-white hover:bg-white/10'
      }`}
    >
      <span className="truncate flex-1">{label}</span>
      {selected && <span className="ml-auto flex-none text-sky-300">✓</span>}
    </button>
  )
}

export default function AudioDevicePicker({
  inputs,
  outputs,
  selectedInputId,
  selectedOutputId,
  outputSelectionSupported,
  onSelectInput,
  onSelectOutput,
  onTest,
  headsetMode,
  onToggleHeadsetMode,
}: {
  inputs: AudioDevice[]
  outputs: AudioDevice[]
  selectedInputId: string | null
  selectedOutputId: string | null
  outputSelectionSupported: boolean
  onSelectInput: (id: string) => void
  onSelectOutput: (id: string) => void
  onTest: () => void
  headsetMode: boolean
  onToggleHeadsetMode: (on: boolean) => void
}) {
  // null selection means "browser default" — highlight the 'default' entry.
  const inSel = selectedInputId ?? 'default'
  const outSel = selectedOutputId ?? 'default'
  // The saved mic is no longer plugged in / no longer has this id. Calls fall
  // back to the system default (see applyAudioForCall), but say so rather than
  // leaving a checkmark next to a device that isn't the one being used.
  const savedMicMissing =
    inSel !== 'default' && inputs.length > 0 && !inputs.some((d) => d.deviceId === inSel)

  return (
    <div className="w-full max-w-xs mx-auto text-left space-y-4">
      {/* Microphone */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-white/60 text-xs font-medium uppercase tracking-wide">
          <MicIcon /> Microphone
        </div>
        {inputs.length === 0 ? (
          <p className="px-1 text-xs text-white/40">No microphones found.</p>
        ) : (
          <>
            {savedMicMissing && (
              <p className="rounded-lg bg-amber-500/15 ring-1 ring-amber-400/30 px-2.5 py-2 text-xs text-amber-200">
                The microphone you picked before isn’t connected right now, so calls are using your
                computer’s default. Pick one below to be sure.
              </p>
            )}
            <div className="space-y-1.5">
              {inputs.map((d) => (
                <DeviceRow
                  key={d.deviceId}
                  label={d.label}
                  selected={inSel === d.deviceId}
                  onClick={() => onSelectInput(d.deviceId)}
                />
              ))}
            </div>
            <MicLevelMeter deviceId={savedMicMissing ? null : selectedInputId} />
          </>
        )}
      </div>

      {/* Speaker */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-white/60 text-xs font-medium uppercase tracking-wide">
            <SpeakerIcon /> Speaker
          </div>
          {outputSelectionSupported && outputs.length > 0 && (
            <button
              type="button"
              onClick={onTest}
              className="text-xs text-sky-300 hover:text-sky-200"
            >
              Test
            </button>
          )}
        </div>
        {!outputSelectionSupported ? (
          <p className="px-1 text-xs text-white/40">
            This browser plays call audio through your system default output. Set your headset as the
            default speaker in your computer&apos;s sound settings.
          </p>
        ) : outputs.length === 0 ? (
          <p className="px-1 text-xs text-white/40">No speakers found.</p>
        ) : (
          <div className="space-y-1.5">
            {outputs.map((d) => (
              <DeviceRow
                key={d.deviceId}
                label={d.label}
                selected={outSel === d.deviceId}
                onClick={() => onSelectOutput(d.deviceId)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Headset mode — reduce mic processing for fuller audio */}
      <label className="flex items-start gap-2 pt-1 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={headsetMode}
          onChange={(e) => onToggleHeadsetMode(e.target.checked)}
          className="mt-0.5 accent-sky-500"
        />
        <span className="text-xs text-white/70 leading-snug">
          <span className="font-medium text-white">Headset mode</span> — fuller, more natural audio.
          Turn on if you wear a headset; leave off if you use speakers (prevents echo).
        </span>
      </label>
    </div>
  )
}
