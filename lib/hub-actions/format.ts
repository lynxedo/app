// Formatting helpers shared by the action implementations.
//
// Action results are read by a model, not rendered in a UI, so they are compact
// labelled plain text rather than JSON — cheaper in tokens and less likely to be
// echoed verbatim at a customer. Dates are always rendered in the company's
// operating timezone so "tomorrow" means the same thing to the model as it does
// to the office.

import { formatPhone } from '@/lib/format'

/** Heroes/US-Central operating timezone, matching lib/voice-scheduling. */
export const OPS_TZ = 'America/Chicago'

/** YYYY-MM-DD in the operating timezone (not UTC). */
export function opsYmd(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: OPS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

/** "Tuesday, July 14" for a YYYY-MM-DD. */
export function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

/** "Jul 14, 3:42 PM" for a timestamp, in the operating timezone. */
export function stampLabel(iso: string | null | undefined): string {
  if (!iso) return 'unknown time'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'unknown time'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: OPS_TZ,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(t))
}

/**
 * Resolve a natural date word the model may pass ("today", "tomorrow",
 * "2026-08-07") into a YYYY-MM-DD, or null when it isn't understood. Deliberately
 * narrow: anything vaguer is bounced back so the model asks instead of guessing.
 */
export function resolveDateArg(raw: string): string | null {
  const v = raw.trim().toLowerCase()
  if (!v) return null
  const today = opsYmd()
  if (v === 'today') return today
  if (v === 'tomorrow') return addDays(today, 1)
  if (v === 'yesterday') return addDays(today, -1)
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  return null
}

/** A contact's best display name, honoring the "Unknown" convention. */
export function contactLabel(c: {
  name?: string | null
  first_name?: string | null
  last_name?: string | null
  phone?: string | null
}): string {
  const name = (c.name || '').trim()
  if (name) return name
  const composed = [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
  if (composed) return composed
  // Empty name is the deliberate marker for an unidentified texter/caller
  // (project_contact_quality) — say so rather than showing a bare number as a name.
  return c.phone ? `Unknown (${formatPhone(c.phone)})` : 'Unknown'
}

export function phone(p: string | null | undefined): string {
  return p ? formatPhone(p) : 'no number on file'
}

/** Join non-empty lines. */
export function lines(...parts: Array<string | null | undefined | false>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join('\n')
}

/** Cap a body of text the model will read, with an honest marker when trimmed. */
export function clip(text: string, max: number): string {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max)}… (truncated)`
}
