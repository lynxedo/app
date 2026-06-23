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
  /**
   * On phones, let the modal fill the screen edge-to-edge (square corners, full
   * height, tighter padding, safe-area aware) instead of a centered card with a
   * backdrop margin. Desktop is unchanged. Opt-in — use only for big content
   * modals (e.g. the email composer), never for small confirm/yes-no dialogs.
   */
  fullScreenOnMobile?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth = 'max-w-md',
  hideClose = false,
  fullScreenOnMobile = false,
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

  // Full-screen-on-mobile: overlay loses its backdrop margin and the card goes
  // edge-to-edge + full-height with square corners; desktop (sm+) restores the
  // centered card. Safe-area padding on the card keeps the header/footer clear
  // of the notch + home indicator on phones (env() resolves to 0 on desktop).
  const overlayCls = fullScreenOnMobile
    ? 'fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-0 sm:items-center sm:p-4'
    : 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4'
  const cardCls = fullScreenOnMobile
    ? `flex h-full max-h-none w-full ${maxWidth} flex-col border border-gray-700 bg-gray-900 shadow-2xl rounded-none sm:h-auto sm:max-h-[85vh] sm:rounded-2xl`
    : `flex max-h-[85vh] w-full ${maxWidth} flex-col rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl`
  const cardStyle = fullScreenOnMobile
    ? { paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }
    : undefined
  const headerCls = fullScreenOnMobile
    ? 'flex items-center justify-between border-b border-gray-800 px-4 py-3 sm:px-5 sm:py-4'
    : 'flex items-center justify-between border-b border-gray-800 px-5 py-4'
  const bodyCls = fullScreenOnMobile ? 'flex-1 overflow-y-auto p-3 sm:p-5' : 'flex-1 overflow-y-auto p-5'
  const footerCls = fullScreenOnMobile
    ? 'flex justify-end gap-2 border-t border-gray-800 px-4 py-3 sm:px-5 sm:py-4'
    : 'flex justify-end gap-2 border-t border-gray-800 px-5 py-4'

  return (
    <div
      className={overlayCls}
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className={cardCls} style={cardStyle}>
        {(title || !hideClose) && (
          <div className={headerCls}>
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
        <div className={bodyCls}>{children}</div>
        {footer && (
          <div className={footerCls}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export default Modal
