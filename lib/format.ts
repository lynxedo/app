// Shared display formatters (audit MSC-format). `formatPhone` was re-typed in
// ~17 files (with small drift) and currency formatting in ~20. This is the one
// place for display formatting.
//
// Phone NORMALIZATION for storage/APIs (E.164) lives in lib/phone.ts (toE164) —
// keep using that for writes; use formatPhone here only for display.

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
 * "$1.2k" (abbreviate). Null-safe.
 */
export function formatCurrency(
  v: number | null | undefined,
  opts: CurrencyOpts = {},
): string {
  if (v == null) return opts.blankZero ? '—' : ''
  if (opts.blankZero && v === 0) return '—'
  if (opts.abbreviate && Math.abs(v) >= 1000) {
    return '$' + (v / 1000).toFixed(1) + 'k'
  }
  const decimals = opts.decimals ?? 0
  return (
    '$' +
    v.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  )
}
