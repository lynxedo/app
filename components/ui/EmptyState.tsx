// Shared empty-state placeholder (audit #21). Standardizes the "No items yet"
// blurbs that were one-off centered <p> tags with drifting padding/colors.
import React from 'react'

type EmptyStateProps = {
  /** Main line, e.g. "No items yet." */
  title: string
  /** Optional second line / hint. */
  hint?: string
  /** Optional icon or illustration above the text. */
  icon?: React.ReactNode
  /** Optional action (e.g. a Button). */
  action?: React.ReactNode
  /** Vertical padding size. */
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const PAD: Record<NonNullable<EmptyStateProps['size']>, string> = {
  sm: 'py-4',
  md: 'py-10',
  lg: 'py-16',
}

export function EmptyState({
  title,
  hint,
  icon,
  action,
  size = 'md',
  className,
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${PAD[size]} ${className ?? ''}`}>
      {icon && <div className="mb-3 text-gray-600">{icon}</div>}
      <p className="text-sm text-gray-400">{title}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export default EmptyState
