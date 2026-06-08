// Faithful re-implementation of the Monday "Route Capacity" board formula
// columns (board 18408768408).
//
// Monday source formulas:
//   WF Route:  IF(OR(SEARCH("RC",T)>0, SEARCH("BP",T)>0), LEFT(T,3),
//                 IF(OR(SEARCH("IR G",T)>0, SEARCH("IR Gold",T)>0), "IR G",
//                    IF(SEARCH("PW",T)>0, T, "NULL")))
//   Program:   IF(SEARCH("IR",T)>0,"IR G",
//                 IF(SEARCH("MOS Stations",T)>0,"MOS Stations",
//                    IF(SEARCH("MOS",T)>0,"MOS",
//                       IF(SEARCH("PW",T)>0, T,
//                          IF(OR(SEARCH("RC",T)>0,SEARCH("BP",T)>0), MID(T,4,5), "NULL")))))
//   Size:            VALUE(SizeHelper)
//   Production Time: MAX(ROUND((Size + 10 + IF(PHC,10,0) + IF(BWP,5,0)) / 60, 2), 0.25)
//   Total Time:      DriveTime + ProductionTime
// SEARCH is case-insensitive (we mirror that). LEFT/MID preserve original case.

export type RouteCapacityRow = {
  id: string
  name: string | null
  sync_date: string | null
  job_title: string | null
  client_name: string | null
  service_street: string | null
  service_city: string | null
  service_province: string | null
  service_zip: string | null
  line_items: string | null
  total: number | null
  lawn_size: string | null
  size_helper: string | null
  drive_time: number | null
  monday_group: string | null
  created_at?: string
  updated_at?: string
}

export type RouteCapacityFormulas = {
  wfRoute: string
  program: string
  size: number | null
  productionTime: number | null
  totalTime: number | null
}

function contains(hay: string, needle: string): boolean {
  return hay.toLowerCase().includes(needle.toLowerCase())
}

export function computeRouteCapacity(row: RouteCapacityRow): RouteCapacityFormulas {
  const t = row.job_title ?? ''

  // WF Route
  let wfRoute: string
  if (contains(t, 'RC') || contains(t, 'BP')) wfRoute = t.slice(0, 3)
  else if (contains(t, 'IR G') || contains(t, 'IR Gold')) wfRoute = 'IR G'
  else if (contains(t, 'PW')) wfRoute = t
  else wfRoute = 'NULL'

  // Program
  let program: string
  if (contains(t, 'IR')) program = 'IR G'
  else if (contains(t, 'MOS Stations')) program = 'MOS Stations'
  else if (contains(t, 'MOS')) program = 'MOS'
  else if (contains(t, 'PW')) program = t
  else if (contains(t, 'RC') || contains(t, 'BP')) program = t.substring(3, 8) // MID(T,4,5): 1-based pos 4, len 5
  else program = 'NULL'

  // Size = VALUE(SizeHelper). In Monday, VALUE("") evaluates to 0 — the Size
  // column shows 0 for an empty/blank Size Helper — so empty must map to 0, not
  // null. (The prior null short-circuited Production Time to blank on the ~52% of
  // rows with no Size Helper, understating the board's total production time.)
  const sh = (row.size_helper ?? '').trim()
  let size: number
  if (sh === '') {
    size = 0
  } else {
    const v = parseFloat(sh.replace(/,/g, ''))
    size = Number.isNaN(v) ? 0 : v
  }

  // Production Time (hours) — always defined now that size is always numeric.
  // MAX(ROUND((Size + 10 + PHC?10 + BWP?5) / 60, 2), 0.25)
  const phc = contains(t, 'PHC') ? 10 : 0
  const bwp = contains(t, 'BWP') ? 5 : 0
  const productionTime = Math.max(Math.round(((size + 10 + phc + bwp) / 60) * 100) / 100, 0.25)

  // Total Time = DriveTime + ProductionTime (Monday treats a blank Drive Time as 0).
  const totalTime = (row.drive_time ?? 0) + productionTime

  return { wfRoute, program, size, productionTime, totalTime }
}

export type RouteCapacitySummary = {
  count: number
  total: number
  driveTime: number
  productionTime: number
  totalTime: number
}

export function summarizeRouteCapacity(rows: RouteCapacityRow[]): RouteCapacitySummary {
  let total = 0, driveTime = 0, productionTime = 0, totalTime = 0
  for (const r of rows) {
    const f = computeRouteCapacity(r)
    total += r.total ?? 0
    driveTime += r.drive_time ?? 0
    productionTime += f.productionTime ?? 0
    totalTime += f.totalTime ?? 0
  }
  return { count: rows.length, total, driveTime, productionTime, totalTime }
}
