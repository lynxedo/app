// Shared column-sort helpers for the Tracker boards (Lead Tracker, Recurring
// Services, Route Capacity). Click a header to cycle asc → desc → unsorted.
// Empty/blank values always sort to the bottom regardless of direction.

export type SortDir = 'asc' | 'desc'
export type SortState = { key: string; dir: SortDir } | null

export function compareValues(a: unknown, b: unknown, dir: SortDir): number {
  const aEmpty = a == null || a === ''
  const bEmpty = b == null || b === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1 // blanks last
  if (bEmpty) return -1
  let cmp: number
  if (typeof a === 'number' && typeof b === 'number') {
    cmp = a - b
  } else {
    cmp = String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
  }
  return dir === 'asc' ? cmp : -cmp
}

// 3-state cycle for a header click: unsorted → asc → desc → unsorted.
export function cycleSort(current: SortState, key: string): SortState {
  if (!current || current.key !== key) return { key, dir: 'asc' }
  if (current.dir === 'asc') return { key, dir: 'desc' }
  return null
}
