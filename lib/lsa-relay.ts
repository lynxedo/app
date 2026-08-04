// Google Local Services (LSA) message relay.
//
// When a customer messages the business through an LSA ad, Google does NOT hand
// over their phone number. Instead it texts the business from a proxy number
// that is unique per lead, with the real message wrapped in boilerplate:
//
//   You have received a new message from a customer via Google Local Services
//   Ads. Customer Name: , Location: Conroe, Service:
//   irrigation_system_repair_maintenance, Message: I would like a quote first.
//
// Replying to that proxy number reaches that customer, so these threads are real
// working conversations — but two things make them unusable as-is:
//   1. `Customer Name:` is ALWAYS empty (Google never populates it), so the
//      thread shows up as an anonymous "Unknown" contact on an out-of-state area
//      code — indistinguishable from spam.
//   2. The boilerplate repeats on every single message, burying the actual text.
//
// This module unwraps the message so the thread reads like a normal conversation
// and the Location/Service can label it. The original is kept in
// txt_messages.raw_body, so nothing Google sent is lost.

export type LsaRelayParse = {
  /** The customer's actual message, boilerplate stripped. */
  text: string
  /** City Google reports for the lead, e.g. "Conroe". */
  location: string | null
  /** Google's service slug, e.g. "irrigation_system_repair_maintenance". */
  service: string | null
  /** Google's Customer Name field — in practice always empty, kept for the day it isn't. */
  customerName: string | null
}

const RELAY_PREFIX = 'You have received a new message from a customer via Google Local Services Ads'

// Header fields are optional/loose on purpose: Google has shipped variants with
// blank values (Customer Name is always blank, Service sometimes is), so each
// field is matched independently rather than as one rigid line.
const CUSTOMER_NAME_RE = /Customer Name:\s*([^,]*)/i
const LOCATION_RE = /Location:\s*([^,]*)/i
const SERVICE_RE = /Service:\s*([^,]*)/i

/**
 * Detects a Google LSA relay text and pulls the customer's real message out of
 * it. Returns null for any normal text, so callers can treat null as "leave this
 * message exactly as received".
 */
export function parseLsaRelay(body: string | null | undefined): LsaRelayParse | null {
  const raw = (body ?? '').trim()
  if (!raw.toLowerCase().startsWith(RELAY_PREFIX.toLowerCase())) return null

  // Everything after the FIRST "Message:" is the customer's text — the header
  // fields come before it, and the message itself may contain commas, newlines,
  // or the word "Message".
  const msgAt = raw.search(/Message:\s*/i)
  if (msgAt === -1) return null
  const header = raw.slice(0, msgAt)
  const afterLabel = raw.slice(msgAt).replace(/^Message:\s*/i, '')

  const clean = (m: RegExpMatchArray | null): string | null => {
    const v = (m?.[1] ?? '').trim()
    return v || null
  }

  return {
    text: stripAppendedPeriod(afterLabel.trim()),
    location: clean(header.match(LOCATION_RE)),
    service: clean(header.match(SERVICE_RE)),
    customerName: clean(header.match(CUSTOMER_NAME_RE)),
  }
}

// Google appends its own "." after the customer's message, which reads wrong when
// they already ended with punctuation ("Done!." / "thank you! ."). Only strip a
// trailing period that clearly isn't theirs — one that follows other sentence
// punctuation or whitespace. A period straight after a word ("...go from there.")
// is left alone, since there's no way to tell it from the customer's own.
function stripAppendedPeriod(text: string): string {
  return text.replace(/(?<=[.!?]|\s)\s*\.$/, '')
}

/** "irrigation_system_repair_maintenance" → "Irrigation system repair maintenance" */
export function lsaServiceLabel(service: string | null | undefined): string | null {
  const s = (service ?? '').trim()
  if (!s) return null
  const words = s.replace(/_/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null
}

/**
 * Short label for a relay thread, used where a contact name would normally go.
 * Deliberately does NOT invent a person's name — the thread is with a customer we
 * genuinely can't identify yet, so it says what it is instead of guessing.
 */
export function lsaThreadLabel(location: string | null, service: string | null): string {
  const parts = [location?.trim() || null, lsaServiceLabel(service)].filter(Boolean)
  return parts.length ? `Google LSA lead — ${parts.join(' · ')}` : 'Google LSA lead'
}
