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
