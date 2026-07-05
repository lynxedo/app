// Build a safe ilike pattern for a user-supplied search term used inside a
// PostgREST .or() filter string.
//
// Unquoted .or() values can't escape the filter grammar's own syntax — a comma
// splits into a new condition and parentheses can close the or-group — so a
// raw term allows filter tampering (e.g. `x%,do_not_text.eq.false` injects an
// extra condition). Dots are safe: they only delimit field.operator, and the
// value is everything after the operator, so emails still search fine.
//
// Strategy: backslash-escape LIKE wildcards, then replace the grammar
// characters with `_` (the single-character LIKE wildcard) — the pattern still
// matches the original punctuated text (searching "Doe, John" finds
// "Doe, John") but the term can no longer break out of the filter string.
export function ilikeSearchPattern(raw: string): string {
  const cleaned = raw
    .replace(/\\/g, '\\\\') // escape backslashes first so they can't unescape the next step
    .replace(/[%_]/g, '\\$&') // literal LIKE wildcards
    .replace(/[,():]/g, '_') // PostgREST .or() grammar — unescapable unquoted, so wildcard them
    .trim()
  return `%${cleaned}%`
}
