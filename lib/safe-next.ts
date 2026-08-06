// One same-site validator for every `?next=` redirect target.
//
// Four places consume a caller-supplied `next` (both /login handlers, the client
// /auth/callback page, and the /api/auth/callback route). Three of them used to
// carry their own copy of `next.startsWith('/') && !next.startsWith('//')`, and
// the API route had no check at all — an open redirect.
//
// That startsWith pair is not a same-site check. The URL parser treats a backslash
// like a slash, so `/\evil.com` and `/\/evil.com` both pass it and then resolve to
// https://evil.com/. It also strips tabs and newlines before parsing, so a
// backslash followed by a tab lands on the same host. Resolving the value and
// comparing the ORIGIN is what actually holds, because it asks the question the
// browser will: which host does this land on?
//
// Returns a path (always leading-slash, query + hash preserved) or the fallback.

const PLACEHOLDER_ORIGIN = 'https://placeholder.invalid'

// Tabs, newlines and other control characters are stripped by the URL parser, so a
// value containing one can parse as a different target than it looks like. Reject
// them outright rather than redirecting to a normalized string that differs from
// what was submitted — a legitimate `next` is a URL-encoded internal path and never
// contains one. (Written as a codepoint scan, not a regex, so the intent is legible
// and there are no escaped control characters in the source.)
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return true
  }
  return false
}

export function safeNextPath(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback
  if (hasControlChar(raw)) return fallback
  try {
    const u = new URL(raw, PLACEHOLDER_ORIGIN)
    // Anything that resolved off our placeholder origin was NOT a same-site path:
    // absolute URLs, //host, /\host. Reject them all.
    if (u.origin !== PLACEHOLDER_ORIGIN) return fallback
    return u.pathname + u.search + u.hash
  } catch {
    return fallback
  }
}
