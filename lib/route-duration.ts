// Shared on-site duration estimate — moved verbatim out of app/api/optimize/route.ts
// so the Route Optimizer and Dispatch estimate a stop the same way. No server
// imports: safe in Client Components.

import type { DurationRulesConfig } from '@/app/api/settings/types'

// ── Duration calculation ─────────────────────────────────────────────────────

export function parseLawnSizeK(jobTitle: string): number | null {
  const m = jobTitle.match(/(\d+(?:\.\d+)?)\s*[Kk](?:\s|$)/)
  return m ? parseFloat(m[1]) : null
}

/**
 * Compute on-site duration for a single stop.
 * Returns { minutes, usedFallback, reason }
 */
export function computeDuration(
  lineItemNames: string[],
  jobTitle: string,
  stopType: string,
  method: string,
  rules: DurationRulesConfig,
  fallbackMin: number,
): { minutes: number; usedFallback: boolean } {

  // Assessments always use fixed duration regardless of method
  if (stopType === 'assessment') {
    return { minutes: Math.max(rules.minMinutes, rules.assessmentMinutes), usedFallback: false }
  }

  // Tasks likewise — they carry no line items, so there is nothing for the
  // formula to match on and every task would otherwise fall back silently.
  if (stopType === 'task') {
    return { minutes: Math.max(rules.minMinutes, rules.taskMinutes), usedFallback: false }
  }

  if (method === 'default') {
    return { minutes: Math.max(rules.minMinutes, fallbackMin), usedFallback: false }
  }

  if (method === 'formula') {
    // Sum minutes for all matching line items (case-insensitive exact match)
    let total = 0
    let anyMatched = false
    for (const code of rules.codes) {
      if (!code.lineItemName) continue
      const matched = lineItemNames.some(
        li => li.trim().toLowerCase() === code.lineItemName.trim().toLowerCase()
      )
      if (matched) { total += code.minutes; anyMatched = true }
    }

    // Add lawn size if enabled
    if (rules.useLawnSize) {
      const lawnK = parseLawnSizeK(jobTitle)
      if (lawnK !== null) total += lawnK
    }

    // Add padding
    total += rules.padMinutes

    // If nothing matched at all, fall back to default
    if (!anyMatched && lineItemNames.length > 0) {
      return { minutes: Math.max(rules.minMinutes, fallbackMin), usedFallback: true }
    }

    return { minutes: Math.max(rules.minMinutes, total), usedFallback: false }
  }

  // Fallthrough — unknown method
  return { minutes: Math.max(rules.minMinutes, fallbackMin), usedFallback: true }
}
