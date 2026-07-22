// Shared button (audit #21). One place for the primary / secondary / danger /
// ghost variants that were hand-typed across ~76 screens. Dark-theme idiom,
// uses the brand color tokens (#22). Renders a real <button> so all native
// props (type, onClick, disabled, aria-*) pass through.
import React from 'react'
import { Spinner } from './Spinner'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
type Size = 'sm' | 'md'

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  /** Shows a spinner + disables the button while true. */
  loading?: boolean
  /** Stretch to fill the container. */
  fullWidth?: boolean
}

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand hover:bg-brand-hover text-[#fff]',
  secondary:
    'border border-gray-700 text-gray-300 hover:text-white hover:border-gray-600 bg-transparent',
  danger: 'bg-danger hover:bg-red-500 text-[#fff]',
  ghost: 'bg-gray-800 hover:bg-gray-700 text-gray-300',
}

const SIZE: Record<Size, string> = {
  sm: 'text-xs px-3 py-1.5',
  md: 'text-sm px-4 py-2',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`${BASE} ${VARIANT[variant]} ${SIZE[size]} ${fullWidth ? 'w-full' : ''} ${className ?? ''}`}
      {...rest}
    >
      {loading && <Spinner size={4} className="border-white" />}
      {children}
    </button>
  )
}

export default Button
