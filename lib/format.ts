// Shared display formatters (audit MSC-format). `formatPhone` was re-typed in
// ~17 files (with small drift), currency formatting in ~20, and `formatDuration`
// in 13 (with THREE different input units under the same name — ms vs seconds vs
// a timestamp — a unit-confusion bug waiting to happen). This is the one place
// for display formatting.
//
// Phone NORMALIZATION for storage/APIs (E.164) lives in lib/phone.ts (toE164) —
// keep using that for writes; use formatPhone here only for display.
// Date/time DISPLAY lives in lib/dates.ts (America/Chicago-aware).

/**
 * Formats a US phone number for display: "(281) 555-1234".
 * Accepts 10-digit or 1+10-digit input in any punctuation; returns the input
 * unchanged if it isn't a recognizable US number. Null-safe (returns '').
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return raw
}

type CurrencyOpts = {
  /** Decimal places (default 0). */
  decimals?: number
  /** Abbreviate ≥ 1000 as e.g. "$1.2k". */
  abbreviate?: boolean
  /** Render 0 / null as an em-dash instead of "$0". */
  blankZero?: boolean
}

/**
 * Formats a number as USD: "$1,234" (default), "$1,234.56" (decimals: 2),
 * "$1.2k" (abbreviate). Negatives render as "-$1,234" (sign outside the $, the
 * standard accounting/Intl form — matters for the Books P&L). Null-safe.
 */
export function formatCurrency(
  v: number | null | undefined,
  opts: CurrencyOpts = {},
): string {
  if (v == null) return opts.blankZero ? '—' : ''
  if (opts.blankZero && v === 0) return '—'
  const neg = v < 0
  const abs = Math.abs(v)
  const sign = neg ? '-$' : '$'
  if (opts.abbreviate && abs >= 1000) {
    return sign + (abs / 1000).toFixed(1) + 'k'
  }
  const decimals = opts.decimals ?? 0
  return (
    sign +
    abs.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  )
}

type DurationStyle = 'clock' | 'verbose'
type DurationOpts = {
  /**
   * 'clock'   → "1:23" / "1:02:03" (colon, non-padded lead unit) — call/recording
   *             lengths and live call timers.
   * 'verbose' → "1h 23m" / "23m" / "45s" — elapsed times, timesheet, dwell time.
   */
  style?: DurationStyle
  /** Verbose only: show seconds when under an hour ("23m 45s" / "45s"). */
  seconds?: boolean
}

/**
 * Formats a duration given in SECONDS. Clamps negatives/NaN to 0.
 *   formatDurationSec(83)                         → "1:23"
 *   formatDurationSec(3723)                       → "1:02:03"
 *   formatDurationSec(5025, { style: 'verbose' }) → "1h 23m"
 *   formatDurationSec(1425, { style: 'verbose', seconds: true }) → "23m 45s"
 */
export function formatDurationSec(
  totalSec: number | null | undefined,
  opts: DurationOpts = {},
): string {
  const s = Math.max(0, Math.floor(totalSec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if ((opts.style ?? 'clock') === 'verbose') {
    if (h > 0) return `${h}h ${m}m`
    if (opts.seconds) return m > 0 ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`
    return `${m}m`
  }
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Same as formatDurationSec but the input is in MILLISECONDS (e.g. Date.now() - startMs). */
export function formatDurationMs(
  ms: number | null | undefined,
  opts: DurationOpts = {},
): string {
  return formatDurationSec(Math.floor((ms || 0) / 1000), opts)
}
