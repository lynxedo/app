// Usage meters that have a server-side COUNTER wired (Track 5).
//
// A metered catalog item bills real usage ONLY if something reports numbers to its Stripe
// Billing Meter. The counting queries live in lib/billing/usage-report.ts (the USAGE_RPC
// map). This list mirrors the meter_event_names that map has an RPC for, so the platform
// console can (a) offer them as a safe dropdown and (b) warn when a metered item uses some
// OTHER meter_event_name — that item provisions in Stripe but bills $0 until a counter is
// added here + in usage-report.ts.
//
// ⚠ Keep in sync with USAGE_RPC in lib/billing/usage-report.ts. This file is client-safe
// (no server-only imports) so the console UI can import it.
export type WiredMeter = { event_name: string; label: string; unit: string }

export const WIRED_METER_EVENTS: WiredMeter[] = [
  { event_name: 'call_minutes', label: 'Call minutes (Dialer)', unit: 'minute' },
  { event_name: 'ai_minutes', label: 'AI Receptionist minutes', unit: 'minute' },
  { event_name: 'text_messages', label: 'Text messages sent', unit: 'message' },
  { event_name: 'recording_minutes', label: 'Call recording minutes', unit: 'minute' },
  { event_name: 'transcript_minutes', label: 'Transcribed minutes', unit: 'minute' },
  { event_name: 'ai_summaries', label: 'AI call summaries', unit: 'call' },
  { event_name: 'caller_id_lookups', label: 'Caller ID lookups', unit: 'lookup' },
]

export const WIRED_METER_EVENT_NAMES: string[] = WIRED_METER_EVENTS.map((m) => m.event_name)

// True when `eventName` has a usage counter wired (so it will actually bill usage).
export function isWiredMeter(eventName: string | null | undefined): boolean {
  return eventName != null && WIRED_METER_EVENT_NAMES.includes(eventName)
}
