import type { DrillColumn, DrillRow } from './drilldowns'

/* CSV that Excel opens correctly.
 *
 * Chosen over a real .xlsx deliberately: xlsx would mean a new dependency for a
 * file Excel, Numbers and Sheets all open natively anyway. Two details make the
 * difference between "opens" and "opens correctly":
 *
 *  - A UTF-8 BOM, without which Excel on Windows mangles any non-ASCII name.
 *  - CRLF line endings, which older Excel builds need to split rows at all.
 */

/** RFC 4180 quoting. */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  // ⚠ Formula injection: a cell starting with = + - or @ is EXECUTED by Excel on
  // open, and these rows contain customer-supplied text (job titles, names). The
  // leading apostrophe makes Excel treat it as literal text.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Values are written RAW (unformatted) so Excel sees numbers as numbers. */
export function toCsv(columns: DrillColumn[], rows: DrillRow[]): string {
  const head = columns.map(c => cell(c.label)).join(',')
  const body = rows.map(r => columns.map(c => cell(r[c.key])).join(',')).join('\r\n')
  return `﻿${head}\r\n${body}\r\n`
}

/** `revenue-open-invoices-2026-08-12.csv` — sorts sensibly in a downloads folder. */
export function csvFilename(reportSlug: string, drillKey: string): string {
  const today = new Date().toISOString().slice(0, 10)
  return `${reportSlug}-${drillKey}-${today}.csv`
}
