// E.164 phone normalizer for US numbers, no dependencies. Standalone so it
// can be used from branches/code paths that don't have lib/twilio.ts.
// Accepts (281) 555-1234, 281-555-1234, 12815551234, +12815551234, etc.
export function toE164(raw: string): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '')
    return digits.length >= 10 ? '+' + digits : null
  }
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
  return null
}

// US/Canada SMS short codes are 5–6 digit numeric strings (e.g. 65208, the
// code you text "JOIN" to). They are valid SMS destinations but are NOT E.164
// numbers — Twilio expects them in the `To` field as bare digits, never with a
// +1 prefix. A leading "+" means the user intends a real number, so it's never
// treated as a short code.
export function isShortCode(raw: string | null | undefined): boolean {
  if (!raw) return false
  const trimmed = raw.trim()
  if (trimmed.startsWith('+')) return false
  const digits = trimmed.replace(/\D/g, '')
  return digits.length === 5 || digits.length === 6
}

// Normalize any SMS destination: short codes pass through as bare digits,
// everything else goes through E.164 normalization. Returns null if neither.
export function normalizeSmsDestination(raw: string): string | null {
  if (!raw) return null
  if (isShortCode(raw)) return raw.trim().replace(/\D/g, '')
  return toE164(raw)
}
