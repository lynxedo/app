// Cross-tab "am I on a call?" presence for the Dialer.
//
// WHY THIS EXISTS. Twilio fans an inbound call out to EVERY endpoint registered
// under a user's identity — and every open Hub tab registers its own Device. The
// tab holding the call silences its own ringtone, but a second tab has no call of
// its own, so it takes the "not busy" branch, turns the ring ON and rings out
// loud mid-conversation. Silent call waiting therefore only ever held for someone
// with exactly one tab open. (Same mechanism the hidden second Device is muted
// for life to avoid.)
//
// Tabs share their on-call state through localStorage: one key per tab, holding a
// heartbeat timestamp, refreshed while a call is up and removed when it ends.
//
// ⚠ The freshness window is the load-bearing part. A tab that is closed or
// crashes mid-call cannot clean up after itself, and a stale "someone is on a
// call" flag would silence a LEGITIMATE incoming call — far worse than a
// distracting ring. So a sibling counts as busy only while its heartbeat is
// recent; if the tab dies, the flag expires on its own within seconds.

const PREFIX = 'dialer:oncall:'
const HEARTBEAT_MS = 4000
// Must comfortably exceed HEARTBEAT_MS (a backgrounded tab's timers get throttled)
// while still expiring fast enough that a dead tab can't mute a real call for long.
const STALE_MS = 12000

// Per-tab id: a page load, not a user — two tabs must never share one.
const tabId = Math.random().toString(36).slice(2) + Date.now().toString(36)

let heartbeat: ReturnType<typeof setInterval> | null = null

function key(id: string): string {
  return `${PREFIX}${id}`
}

function safeSet(k: string, v: string) {
  try { window.localStorage.setItem(k, v) } catch { /* private mode — degrade to today's behaviour */ }
}

function safeRemove(k: string) {
  try { window.localStorage.removeItem(k) } catch { /* ignore */ }
}

/** True if ANOTHER tab reports a live call within the freshness window. */
export function isSiblingOnCall(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const now = Date.now()
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i)
      if (!k || !k.startsWith(PREFIX) || k === key(tabId)) continue
      const ts = Number(window.localStorage.getItem(k) || 0)
      if (ts > 0 && now - ts < STALE_MS) return true
    }
  } catch { /* ignore */ }
  return false
}

/**
 * Announce whether THIS tab is on a call. While true, a heartbeat keeps the flag
 * fresh so sibling tabs stay silent; false clears it immediately.
 */
export function announceOnCall(onCall: boolean): void {
  if (typeof window === 'undefined') return
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null }
  if (!onCall) {
    safeRemove(key(tabId))
    return
  }
  safeSet(key(tabId), String(Date.now()))
  heartbeat = setInterval(() => safeSet(key(tabId), String(Date.now())), HEARTBEAT_MS)
}

/**
 * Notify when a sibling tab's on-call state may have changed. `storage` fires
 * only in OTHER tabs, which is exactly the audience that needs to react.
 */
export function subscribeSiblingOnCall(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key.startsWith(PREFIX)) onChange()
  }
  window.addEventListener('storage', onStorage)
  // A removal by a dying tab raises no event anywhere, and an expiry raises none
  // by definition, so poll as a backstop to re-arm the ring after a sibling goes.
  const poll = setInterval(onChange, HEARTBEAT_MS)
  return () => {
    window.removeEventListener('storage', onStorage)
    clearInterval(poll)
  }
}

/** Drop this tab's flag on unload so a closed tab can't mute a real call. */
export function clearOwnOnCall(): void {
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null }
  if (typeof window !== 'undefined') safeRemove(key(tabId))
}
