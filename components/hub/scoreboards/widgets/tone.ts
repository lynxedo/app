import { formatPayloadValue } from '@/lib/scoreboards/widgets/payloads'
import type { Tone, ValueFormat } from '@/lib/scoreboards/widgets/payloads'

/* The one place a semantic tone becomes a colour.
 *
 * Metrics emit tone NAMES so this map is the only thing to change for a theme or
 * a colour-blind-safe palette — not every widget. Values match today's boards so
 * a migrated board looks identical to the one it replaces.
 */
export const TONE_COLOR: Record<Tone, string> = {
  good: '#22c55e',
  warn: '#f59e0b',
  bad: '#f87171',
  neutral: '#64748b',
  paid: '#f87171',
  free: '#22c55e',
  mixed: '#8b5cf6',
  unknown: '#94a3b8',
}

export function toneColor(tone: Tone | undefined): string {
  return TONE_COLOR[tone ?? 'neutral']
}

/** One implementation, shared with the narrator — see formatPayloadValue. */
export function formatValue(v: number | string | null, format: ValueFormat | undefined): string {
  return formatPayloadValue(v, format)
}
