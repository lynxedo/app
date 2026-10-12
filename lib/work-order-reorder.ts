// Work Orders Phase 5 — reorder stops at any time.
//
// Shared by the reorder route (writes `ord`) and the list (previews the numbers
// while the tech is still dragging), so both agree on where every stop lands.
//
// Rule (Ben, Oct 2 2026: "each keeps its route number"): a finished / skipped
// stop, or one Jobber has removed, is FIXED — it keeps the number it has. The
// stops being reordered take the remaining numbers, in the order given.

export type FixedStop = { id: string; ord: number }

/**
 * The full sequence of stop ids, position 1 first: fixed stops stay on their
 * own number, the draft order fills every number in between. A fixed stop whose
 * number is past the end (or shared with another) goes to the back, after any
 * draft stops left over — the caller then numbers the sequence 1..N.
 */
export function mergeOrder(fixed: FixedStop[], draftIds: string[]): string[] {
  const total = fixed.length + draftIds.length
  const byOrd = new Map<number, string>()
  const spare: string[] = []
  for (const f of [...fixed].sort((a, b) => a.ord - b.ord)) {
    if (f.ord >= 1 && f.ord <= total && !byOrd.has(f.ord)) byOrd.set(f.ord, f.id)
    else spare.push(f.id)
  }
  const out: string[] = []
  let next = 0
  for (let pos = 1; pos <= total; pos++) {
    const held = byOrd.get(pos)
    if (held) out.push(held)
    else if (next < draftIds.length) out.push(draftIds[next++])
    else break
  }
  while (next < draftIds.length) out.push(draftIds[next++])
  return [...out, ...spare]
}
