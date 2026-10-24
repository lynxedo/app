// ⚠ TEMPORARY — Oct 23 2026. Diagnoses "a new DM doesn't show in the open
// conversation until I back out and go back in" on the phone apps (Ben, Josh,
// Mike). Each event is POSTed to /api/hub/feed-debug, which writes one
// `[feed-debug]` line to the server log. Ids, counts and timings only — never
// message text. Remove this file, the route and the feedDebug() calls in
// MessageFeed once the cause is found.

const DEBUG_USERS = new Set([
  '6939b706-5135-448d-a28a-7674ba17974e', // Ben
  'a100da68-b466-4c64-928b-caade32ea8fb', // Josh
  '6399c12a-49e1-48ac-94b6-38f4f52f99ac', // Mike
])

export function feedDebugEnabled(userId: string | null | undefined): boolean {
  return !!userId && DEBUG_USERS.has(userId)
}

export function feedDebug(userId: string | null | undefined, event: string, data: Record<string, unknown> = {}) {
  if (!feedDebugEnabled(userId) || typeof window === 'undefined') return
  try {
    const body = JSON.stringify({
      event,
      data,
      at: new Date().toISOString(),
      vis: document.visibilityState,
      online: navigator.onLine,
      path: location.pathname + location.search,
    })
    void fetch('/api/hub/feed-debug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Diagnostics must never break the feed.
  }
}
