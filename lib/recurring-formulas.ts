// Faithful re-implementation of the Monday "Recurring Services" board formula
// columns so the Lynxedo board computes identical values per row.
//
// Monday source formulas (board 18188676554), for reference:
//   Aging:            IF({SoldDate}="", ROUND(DAYS(TODAY(),{LeadCreate}),0), ROUND(DAYS({SoldDate},{LeadCreate}),0))
//   Days to Close:    DAYS({SoldDate}, {LeadCreate})
//   Active Jobs:      IF(OR(Cancelled?="Downgraded", Cancelled?="Active"), 1, IF(Cancelled?="Cancelled",0,0))
//   Total Jobs:       IF(OR(Cancelled? in Downgraded/Active/Cancelled), 1, 0)
//   Cancelled Jobs:   IF(OR(EXACT Downgraded, EXACT Active), 0, IF(EXACT Cancelled, 1, ""))
//   Retention Rate:   (ActiveJobs / TotalJobs) * 100
//   Total Annual Val: {AnnualValue} * ActiveJobs
//   Av Job Value:     TotalAnnualValue / ActiveJobs
//   WF Jobs:          IF(AND(SEARCH("WF",{BaseProgram})>0, OR(Active,Downgraded)), 1, "")
//   MO Jobs:          IF(AND(SEARCH("MO",{BaseProgram})>0, OR(Active,Downgraded)), 1, "")
//   WF Value:         TotalAnnualValue * WF Jobs
//   MO Value:         TotalAnnualValue * MO Jobs
//   WF Av Value:      WF Value / WF Jobs
//   IR Gold:          IF(SEARCH("Irrigation Service Plan Gold",{BaseProgram})>0, 1, 0)
//   IR Value:         IF(TotalAnnualValue*IRGold=0, "", TotalAnnualValue*IRGold)
//   PW Cust:          IF(SEARCH("PW",{BaseProgram})>0, 1, 0)
//   PW Value:         IF(TotalAnnualValue*PWCust=0, "", TotalAnnualValue*PWCust)
//   PHC:              IF(SEARCH("Plant Health Care",{Aux})>0, 1, 0)
//   BWP:              IF(SEARCH("Bed Weed",{Aux})>0, 1, 0)
//   Aux Services:     IF(LEN({Aux})>0, 1, 0)
//   PHC %:            (PHC / WF Jobs) * 100
//   BWP %:            (BWP / WF Jobs) * 100
//   Aux Service %:    (Aux Services / WF Jobs) * 100

export type RecurringRow = {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  lead_comments: string | null
  service: string[] | null
  lead_source: string | null
  status: string | null
  lead_creation_date: string | null
  annual_value: number | null
  sold_date: string | null
  salesperson: string | null
  base_program_sold: string | null
  auxiliary_services: string[] | null
  cancelled_status: string | null
  cancellation_reason: string | null
  cancel_date: string | null
  temp_updated: boolean | null
  temp_prepaid: boolean | null
  monday_group: string | null
  created_at?: string
  updated_at?: string
}

export type RecurringFormulas = {
  aging: number | null
  daysToClose: number | null
  activeJobs: number
  totalJobs: number
  cancelledJobs: number | null
  retentionRate: number | null
  totalAnnualValue: number
  avJobValue: number | null
  wfJobs: number | null
  moJobs: number | null
  wfValue: number | null
  moValue: number | null
  wfAvValue: number | null
  irGold: number
  irValue: number | null
  pwCust: number
  pwValue: number | null
  phc: number
  bwp: number
  auxServices: number
  phcPct: number | null
  bwpPct: number | null
  auxPct: number | null
}

// SEARCH(): case-insensitive "contains" (Monday SEARCH returns a 1-based
// position; we only need the truthiness of `> 0`).
function contains(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack) return false
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

// DAYS(end, start) = whole days between two ISO dates (end - start).
function daysBetween(end: string | null, start: string | null): number | null {
  if (!end || !start) return null
  const e = Date.parse(end + 'T00:00:00Z')
  const s = Date.parse(start + 'T00:00:00Z')
  if (Number.isNaN(e) || Number.isNaN(s)) return null
  return Math.round((e - s) / 86_400_000)
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function computeFormulas(row: RecurringRow): RecurringFormulas {
  const cancelled = (row.cancelled_status ?? '').trim()
  const isActive = cancelled === 'Active'
  const isDowngraded = cancelled === 'Downgraded'
  const isCancelled = cancelled === 'Cancelled'
  const annual = typeof row.annual_value === 'number' ? row.annual_value : 0

  const base = row.base_program_sold ?? ''
  // Monday treats the multi-select dropdown as its comma-joined label text.
  const aux = (row.auxiliary_services ?? []).join(', ')

  const aging = row.sold_date
    ? daysBetween(row.sold_date, row.lead_creation_date)
    : daysBetween(todayISO(), row.lead_creation_date)

  const daysToClose = daysBetween(row.sold_date, row.lead_creation_date)

  const activeJobs = isActive || isDowngraded ? 1 : 0
  const totalJobs = isActive || isDowngraded || isCancelled ? 1 : 0
  const cancelledJobs = isActive || isDowngraded ? 0 : isCancelled ? 1 : null

  const retentionRate = totalJobs > 0 ? (activeJobs / totalJobs) * 100 : null
  const totalAnnualValue = annual * activeJobs
  const avJobValue = activeJobs > 0 ? totalAnnualValue / activeJobs : null

  const wfJobs = contains(base, 'WF') && (isActive || isDowngraded) ? 1 : null
  const moJobs = contains(base, 'MO') && (isActive || isDowngraded) ? 1 : null
  const wfValue = wfJobs !== null ? totalAnnualValue * wfJobs : null
  const moValue = moJobs !== null ? totalAnnualValue * moJobs : null
  const wfAvValue = wfJobs !== null ? (wfValue as number) / wfJobs : null

  const irGold = contains(base, 'Irrigation Service Plan Gold') ? 1 : 0
  const irValRaw = totalAnnualValue * irGold
  const irValue = irValRaw === 0 ? null : irValRaw

  const pwCust = contains(base, 'PW') ? 1 : 0
  const pwValRaw = totalAnnualValue * pwCust
  const pwValue = pwValRaw === 0 ? null : pwValRaw

  const phc = contains(aux, 'Plant Health Care') ? 1 : 0
  const bwp = contains(aux, 'Bed Weed') ? 1 : 0
  const auxServices = aux.length > 0 ? 1 : 0

  const phcPct = wfJobs !== null ? (phc / wfJobs) * 100 : null
  const bwpPct = wfJobs !== null ? (bwp / wfJobs) * 100 : null
  const auxPct = wfJobs !== null ? (auxServices / wfJobs) * 100 : null

  return {
    aging, daysToClose, activeJobs, totalJobs, cancelledJobs, retentionRate,
    totalAnnualValue, avJobValue, wfJobs, moJobs, wfValue, moValue, wfAvValue,
    irGold, irValue, pwCust, pwValue, phc, bwp, auxServices, phcPct, bwpPct, auxPct,
  }
}

export type RecurringSummary = {
  count: number
  activeJobs: number
  totalJobs: number
  cancelledJobs: number
  totalAnnualValue: number
  retentionRate: number | null
  wfJobs: number
  moJobs: number
  irGold: number
  pwCust: number
  phc: number
  bwp: number
  auxServices: number
  wfValue: number
  moValue: number
  irValue: number
  pwValue: number
  phcPct: number | null
  bwpPct: number | null
  auxPct: number | null
}

// Group / board footer aggregates — sums for counts & values, ratio-based
// percentages for the rate columns (the meaningful aggregate, matching how the
// Monday dashboard rolls these up).
export function summarize(rows: RecurringRow[]): RecurringSummary {
  const f = rows.map(computeFormulas)
  const sum = (pick: (x: RecurringFormulas) => number | null) =>
    f.reduce((acc, x) => acc + (pick(x) ?? 0), 0)

  const activeJobs = sum(x => x.activeJobs)
  const totalJobs = sum(x => x.totalJobs)
  const wfJobs = sum(x => x.wfJobs)
  const phc = sum(x => x.phc)
  const bwp = sum(x => x.bwp)
  const auxServices = sum(x => x.auxServices)

  return {
    count: rows.length,
    activeJobs,
    totalJobs,
    cancelledJobs: sum(x => x.cancelledJobs),
    totalAnnualValue: sum(x => x.totalAnnualValue),
    retentionRate: totalJobs > 0 ? (activeJobs / totalJobs) * 100 : null,
    wfJobs,
    moJobs: sum(x => x.moJobs),
    irGold: sum(x => x.irGold),
    pwCust: sum(x => x.pwCust),
    phc,
    bwp,
    auxServices,
    wfValue: sum(x => x.wfValue),
    moValue: sum(x => x.moValue),
    irValue: sum(x => x.irValue),
    pwValue: sum(x => x.pwValue),
    phcPct: wfJobs > 0 ? (phc / wfJobs) * 100 : null,
    bwpPct: wfJobs > 0 ? (bwp / wfJobs) * 100 : null,
    auxPct: wfJobs > 0 ? (auxServices / wfJobs) * 100 : null,
  }
}
