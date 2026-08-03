'use client'

import { useEffect, type RefObject } from 'react'

/**
 * Closes a popover when the user clicks/taps outside it, or presses Escape.
 *
 * Prefer this over the `fixed inset-0` backdrop pattern, which misbehaves twice
 * over in the Hub shell:
 *
 *  1. The backdrop SWALLOWS the first click on anything else. With a header
 *     menu open, the first tap on the conversation list or the thread body only
 *     dismissed the menu — so switching conversations took two clicks.
 *  2. Inside a `transform`ed ancestor (the Hub sidebar wrapper has one), a
 *     `fixed` element resolves against that ancestor's box instead of the
 *     viewport, so the backdrop silently fails to cover the page at all and
 *     outside clicks never register.
 *
 * It also gets Escape-to-close for free, and keeps a full-screen `<button>` out
 * of the tab order.
 *
 * Opening popover B while A is open works without extra bookkeeping: the
 * mousedown on B's trigger is outside A, so A closes before B opens.
 */
export function useOutsideClose(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void
) {
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent | TouchEvent) {
      const el = ref.current
      if (el && e.target instanceof Node && !el.contains(e.target)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    // mousedown (not click) so the menu is gone before the click lands on
    // whatever is underneath — that's what makes the underlying tap work.
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [ref, open, onClose])
}
