// Shared timezone helper.
//
// Jobber (and OneStepGPS) read a bare datetime like "2026-06-23T00:00:00" as
// UTC, so a day window built that way is shifted 5-6 hours and an all-day item
// from the adjacent day overlaps it — which once leaked a Monday assessment
// into a Tuesday pull (test-findings #8). Stamp the day's real offset instead.
//
// Only the offset itself is shared: callers build their own day bounds on top,
// and they deliberately differ — /api/visits keeps the local offset because
// Jobber's filters want it, while /api/fleet/history converts to UTC.

/** Heroes' operating timezone. */
export const COMPANY_TZ = 'America/Chicago'

/**
 * The real UTC offset for a calendar date in a timezone, DST included,
 * as "+HH:MM" / "-HH:MM".
 */
export function tzOffset(date: string, timeZone: string = COMPANY_TZ): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, timeZoneName: 'longOffset',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(`${date}T12:00:00Z`))
  const name = parts.find(p => p.type === 'timeZoneName')?.value ?? ''
  const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/)
  if (!m) return '-06:00' // CST fallback
  return `${m[1]}${m[2]}:${m[3] ?? '00'}`
}
