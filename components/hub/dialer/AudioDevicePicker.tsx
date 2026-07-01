'use client'

// Mic + speaker picker for the WEB softphone — the desktop/browser equivalent
// of the native earpiece/speaker route picker. Presentational only; all device
// state + persistence lives in use-twilio-device. Rendered wherever the call
// controls are (ActiveCall) and on the idle dialer so a user can pick their
// headset before dialing. Hidden on native (audioDeviceSupported is false).

type AudioDevice = { deviceId: string; label: string }

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
