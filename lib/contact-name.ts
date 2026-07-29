// lib/contact-name.ts
// The ONE place that decides a contact's display name. Client- and server-safe
// (no imports). Unknown / inbound-only contacts are stored with name = '' going
// forward (the column is NOT NULL), and legacy rows may carry the phone number AS
// the name — both are treated as "no real name" so the UI shows "Unknown", never
// a bare number.
//
// name_source marks how a real name was obtained:
//   null        — no real name yet (show "Unknown")
//   'manual'    — a human entered/confirmed it (trusted)
//   'jobber'    — from the Jobber mirror (trusted)
//   'caller_id' — Twilio carrier caller-ID (a guess)
//   'ai'        — extracted from the conversation by Claude (show the purple dot)

export const UNKNOWN_CONTACT_LABEL = 'Unknown'

export type NameSource = 'manual' | 'jobber' | 'caller_id' | 'ai' | null

/** True when `name` is empty or is just the phone number in some formatting. */
export function isPlaceholderName(
  name: string | null | undefined,
  phone: string | null | undefined,
): boolean {
  const t = (name || '').trim()
  if (!t) return true
  if (/[a-zA-Z]/.test(t)) return false // any letter → a real name
  const nameDigits = t.replace(/\D/g, '')
  if (!nameDigits) return true
  const phoneDigits = (phone || '').replace(/\D/g, '')
  if (!phoneDigits) return false // no phone to compare; a numeric label stands
  return nameDigits === phoneDigits || nameDigits === phoneDigits.slice(-10)
}

/** The label to show for a contact: their real name, else "Unknown". */
export function contactDisplayName(
  name: string | null | undefined,
  phone: string | null | undefined,
): string {
  return isPlaceholderName(name, phone) ? UNKNOWN_CONTACT_LABEL : (name as string).trim()
}

/** Show the AI-guessed indicator (the purple dot) for this contact? */
export function nameIsAiGuessed(nameSource: string | null | undefined): boolean {
  return nameSource === 'ai'
}
