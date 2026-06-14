// Shared loading spinner (audit #21). Replaces the ~3 hand-rolled animate-spin
// markups scattered across the app. Border-based (the most common variant).
import React from 'react'

type SpinnerProps = {
  /** Tailwind size, e.g. 4 = h-4 w-4 (default), 5, 6, 8. */
  size?: 4 | 5 | 6 | 8
  /** Override the ring color. Defaults to the brand accent. */
  className?: string
  label?: string
}

const SIZE: Record<NonNullable<SpinnerProps['size']>, string> = {
  4: 'h-4 w-4 border-2',
  5: 'h-5 w-5 border-2',
  6: 'h-6 w-6 border-2',
  8: 'h-8 w-8 border-[3px]',
}

export function Spinner({ size = 4, className, label }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label ?? 'Loading'}
      className={`inline-block animate-spin rounded-full border-brand border-t-transparent ${SIZE[size]} ${className ?? ''}`}
    />
  )
}

export default Spinner
