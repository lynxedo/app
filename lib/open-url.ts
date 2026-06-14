// #39 — open a URL in a new tab, falling back to in-webview navigation when the
// browser/webview blocks the popup. In the iOS Capacitor app `window.open(url,
// '_blank')` returns null and nothing happens, so the route-sheet button looked
// dead on iPhone. When the popup is refused we navigate the current webview to
// the URL instead (the user prints/views it, then taps Back). Desktop + mobile
// browsers still get the normal new tab.
export function openUrlWithFallback(url: string): void {
  let win: Window | null = null
  try {
    win = window.open(url, '_blank', 'noopener')
  } catch {
    win = null
  }
  if (!win) {
    // Popup blocked or unsupported (Capacitor webview) — navigate in place.
    window.location.assign(url)
  }
}
