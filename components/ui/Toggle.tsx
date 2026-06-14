// Shared accessible toggle switch (audit #21 + AD-toolkit). Canonical version
// of the on/off switch that was hand-built ~a dozen times — some with
// role="switch", some without. This one is always accessible.
import React from 'react'

type ToggleProps = {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  /** Accessible label (required when no visible <label> is wired up). */
  label?: string
  size?: 'sm' | 'md'
  className?: string
}

const TRACK: Record<NonNullable<ToggleProps['size']>, string> = {
  sm: 'h-5 w-9',
  md: 'h-6 w-11',
}
const KNOB: Record<NonNullable<ToggleProps['size']>, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
}
const ON_X: Record<NonNullable<ToggleProps['size']>, string> = {
  sm: 'translate-x-4',
  md: 'translate-x-5',
}

export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
  size = 'md',
  className,
}: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex flex-shrink-0 items-center rounded-full border-2 border-transparent transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${TRACK[size]} ${checked ? 'bg-brand' : 'bg-white/20'} ${className ?? ''}`}
    >
      <span
        className={`pointer-events-none inline-block transform rounded-full bg-white shadow transition-transform ${KNOB[size]} ${checked ? ON_X[size] : 'translate-x-0.5'}`}
      />
    </button>
  )
}

export default Toggle
