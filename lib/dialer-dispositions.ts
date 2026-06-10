// Desktop Dialer Control — Session 6. After-call disposition options.
//
// Pure constants + sanitizer (no server imports) so this is safe to import from
// both the admin API route (server) and the in-call UI (client). The company can
// customize the list in Admin → Dialer; when unset we fall back to DEFAULT_DISPOSITIONS.

export const DEFAULT_DISPOSITIONS = [
  'Scheduled',
  'Voicemail',
  'Callback',
  'Wrong number',
  'Other',
] as const

const MAX_OPTIONS = 20
const MAX_LEN = 40

// Normalize an admin-supplied option list: trim, drop blanks, cap length + count,
// de-dupe (case-insensitive). Returns null when the input isn't a usable array so
// callers can fall back to DEFAULT_DISPOSITIONS.
export function sanitizeDispositions(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const t = v.trim().slice(0, MAX_LEN)
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
    if (out.length >= MAX_OPTIONS) break
  }
  return out
}

// Resolve the effective option list for display: a sanitized stored list if it
// has entries, otherwise the built-in default.
export function resolveDispositions(stored: unknown): string[] {
  const cleaned = sanitizeDispositions(stored)
  return cleaned && cleaned.length > 0 ? cleaned : [...DEFAULT_DISPOSITIONS]
}
