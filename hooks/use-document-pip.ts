'use client'

// Session 3 (Desktop Dialer Control) — Document Picture-in-Picture platform layer.
//
// Wraps the Chromium-only Document Picture-in-Picture API so the dialer can float
// its controls above ALL desktop apps while the user works elsewhere. Because a
// Document PiP window shares the SAME JS context as the main document, the Twilio
// Device + its audio sink stay in the main document untouched — the PiP only ever
// renders *controls*. Closing PiP can never drop the call.
//
// Hard constraints respected here:
//   - Feature-detected: `supported` is false on Safari / native / old browsers, so
//     the pop-out button simply never renders (never throws).
//   - `open()` MUST be called from a user gesture (Chromium requires transient
//     activation for requestWindow) — it's wired to the pop-out button click.
//     There is NO way to auto-open on an inbound call; that's Session 5's
//     service-worker notification. An ALREADY-open PiP can still surface the
//     incoming call (updating an open window needs no gesture).
//   - Tailwind/global CSS must be injected into the PiP document (its own
//     document object has no stylesheets by default) — copyStyles() does this.

import { useCallback, useEffect, useRef, useState } from 'react'

type DocumentPictureInPicture = {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>
  window: Window | null
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture
  }
}

export type UseDocumentPip = {
  supported: boolean
  pipWindow: Window | null
  open: (size?: { width?: number; height?: number; title?: string }) => Promise<void>
  close: () => void
}

// Mirror the main document's stylesheets into the PiP document so Tailwind +
// global CSS apply inside the floating window. Same-origin sheets are copied
// rule-by-rule; cross-origin sheets (which throw on cssRules access) are cloned
// as a <link>.
function copyStyles(target: Window) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules
      const style = target.document.createElement('style')
      for (const rule of Array.from(rules)) {
        style.appendChild(target.document.createTextNode(rule.cssText))
      }
      target.document.head.appendChild(style)
    } catch {
      // Cross-origin stylesheet — can't read rules; clone the <link> instead.
      if (sheet.href) {
        const link = target.document.createElement('link')
        link.rel = 'stylesheet'
        link.href = sheet.href
        target.document.head.appendChild(link)
      }
    }
  }
}

export function useDocumentPip(): UseDocumentPip {
  const [supported] = useState(
    () => typeof window !== 'undefined' && 'documentPictureInPicture' in window
  )
  const [pipWindow, setPipWindow] = useState<Window | null>(null)
  const openingRef = useRef(false)

  const close = useCallback(() => {
    setPipWindow((w) => {
      try {
        w?.close()
      } catch {
        /* already gone */
      }
      return null
    })
  }, [])

  const open = useCallback(
    async (size?: { width?: number; height?: number; title?: string }) => {
      if (!supported || pipWindow || openingRef.current) return
      const api = window.documentPictureInPicture
      if (!api) return
      openingRef.current = true
      try {
        const w = await api.requestWindow({
          // Sized for the full floating dialer (number field + keypad + Call).
          // The shorter in-call view fits comfortably inside the same window.
          width: size?.width ?? 340,
          height: size?.height ?? 540,
        })
        copyStyles(w)
        w.document.title = size?.title ?? 'Hub'
        w.document.body.style.margin = '0'
        // When the user closes the PiP via the OS window chrome, drop our state so
        // React unmounts the portal and the controls return to the docked bar.
        w.addEventListener('pagehide', () => setPipWindow(null), { once: true })
        setPipWindow(w)
      } catch {
        // No transient activation, or the user dismissed the prompt — degrade
        // silently; the docked bar remains the experience.
      } finally {
        openingRef.current = false
      }
    },
    [supported, pipWindow]
  )

  // The PiP window closes automatically if the main document unloads, but clean
  // up on unmount too (e.g. provider teardown) so we never leak a window.
  useEffect(() => {
    return () => {
      try {
        pipWindow?.close()
      } catch {
        /* noop */
      }
    }
  }, [pipWindow])

  return { supported, pipWindow, open, close }
}
