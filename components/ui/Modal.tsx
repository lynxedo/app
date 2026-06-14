'use client'
// Shared modal (audit #21). Consolidates the hand-built `fixed inset-0`
// overlay + centered card used across the app, and adds what the copies were
// missing: Escape-to-close and reliable backdrop-click (outer target only).
import React, { useEffect } from 'react'

type ModalProps = {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  children: React.ReactNode
  /** Footer area (buttons). Optional. */
  footer?: React.ReactNode
  /** max-width class, default max-w-md. */
  maxWidth?: string
  /** Hide the ✕ button (rare). */
  hideClose?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth = 'max-w-md',
  hideClose = false,
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`flex max-h-[85vh] w-full ${maxWidth} flex-col rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl`}
      >
        {(title || !hideClose) && (
          <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
            <h2 className="font-semibold text-white">{title}</h2>
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="text-gray-500 transition-colors hover:text-gray-300"
              >
                ✕
              </button>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-gray-800 px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export default Modal
