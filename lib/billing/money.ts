// Money formatting shared by the billing UIs (Track 5).
//
// Flat monthly prices are whole cents (integer), but per-UNIT usage rates can be
// sub-cent (e.g. $0.003/min = 0.3 cents) and are stored in a numeric column — which
// Postgres/PostgREST serializes to JS as a STRING. These helpers accept number|string,
// preserve fractional cents, and trim trailing zeros for display.

// A (possibly fractional) cents value → a dollar string, trailing zeros trimmed.
// e.g. 0.3 → "0.003", 5 → "0.05", 25 → "0.25", 500 → "5". Blank/invalid → "".
export function centsToDollarsPrecise(v: number | string | null | undefined): string {
  if (v == null || v === '') return ''
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  return (n / 100).toFixed(6).replace(/\.?0+$/, '')
}

// A dollar string → a (possibly fractional) cents number, rounded to 6 decimal places to
// match the numeric(12,6) column. Blank/invalid → null. e.g. "0.003" → 0.3, "0.05" → 5.
export function dollarsToCentsPrecise(str: string): number | null {
  const t = str.trim()
  if (!t) return null
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100 * 1e6) / 1e6
}

// Format a per-unit rate for read-only display, e.g. "$0.003". Always $-prefixed.
export function fmtUnitRate(v: number | string | null | undefined): string {
  const s = centsToDollarsPrecise(v)
  return `$${s === '' ? '0' : s}`
}
