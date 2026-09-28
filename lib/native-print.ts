'use client'

// Printing, which a webview cannot do on its own.
//
// ⚠⚠ window.print() IS A SILENT NO-OP IN THE ANDROID WEBVIEW. It returns
// normally and no print dialog ever appears, so every print button in the Hub
// looked like it worked and did nothing on a phone. MainActivity has shipped a
// LynxedoPrint bridge since Sep 2026 — and nothing on the website ever called
// it. The bridge was built, tested on the device, and then left unreachable.
//
// Three real daily workflows print: the route sheet (from RouteBuilder and from
// advanced-route-sheet, both of which render into /hub/routing/print in the MAIN
// webview, so the bridge is reachable there) and the Mix Sheet.
//
// ⏭ iOS still has no print path. WKWebView's window.print() is a no-op too, so
// an iPhone silently does nothing — it needs a plugin of its own, the same
// shape as capacitor-web-download. Until then this at least stops pretending.

type PrintBridge = { printPage(): void }

function androidPrint(): PrintBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { LynxedoPrint?: PrintBridge }).LynxedoPrint
}

/** Print what is on screen. Returns false when there is no way to print on this
 *  platform, so a caller can say so rather than appear to have worked. */
export function printPage(): boolean {
  const bridge = androidPrint()
  if (bridge) {
    try {
      bridge.printPage()
      return true
    } catch {
      return false
    }
  }
  // Desktop browsers, Electron and the PWA all print properly.
  if (typeof window !== 'undefined' && typeof window.print === 'function') {
    window.print()
    return true
  }
  return false
}

/** The same choice, as a string to inline into generated print-sheet HTML.
 *  ⚠ The sheet is a separate DOCUMENT built as a string, so it cannot import
 *  this module — but it renders in the main webview, where the bridge lives. */
export const INLINE_PRINT_HANDLER =
  'window.LynxedoPrint ? window.LynxedoPrint.printPage() : window.print()'
