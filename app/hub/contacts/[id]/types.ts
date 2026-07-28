// Shared types for the customer detail screen (server page → client view).

export type CustomerDetailAccount = {
  status: string
  balance: number | null
  leadSource: string
  marketingSource: string
  salesPerson: string
  customerSince: string
  customerType: string
  callAhead: string
  irGold: string
  cancellationReason: string
  importedNote: string
  saPrepay: number | null
  saRemit: number | null
  saBalance: number | null
  jobberWebUri: string
}

export type CustomerDetailProperty = {
  id: string
  address: string
  city: string
  state: string
  zip: string
  lawnSqft: number | null
  lawnK: number | null
  irrigationZones: number | string
  sprinkler: string
  gateCode: string
  neighborhood: string
  directions: string
  jobberWebUri: string
}

// ---- Program & services (read-only, from the Jobber mirror) ----

export type AccountLineItem = {
  name: string
  quantity: number | null
  unitPrice: number | null
  total: number | null
  isAux: boolean
}

export type AccountVisit = {
  id: string
  year: number | null
  round: number        // sequence within its calendar year (1-based)
  date: string | null  // scheduled_date, YYYY-MM-DD
  status: string       // raw visit_status (UPCOMING/COMPLETED/…)
  completed: boolean
  total: number | null
}

// One Jobber job rendered as a Program (recurring) or a one-off Service.
export type AccountProgram = {
  id: string           // job id
  isRecurring: boolean
  category: string     // 2-letter prefix, e.g. WF (may be '')
  categoryName: string // e.g. Weed & Fertilization
  categoryColor: string | null
  name: string         // program display name / base line item / job title
  jobStatus: string    // raw job_status
  live: boolean        // job_status != 'archived'
  visitsPerYear: number | null // from the program definition (programs only)
  jobTotal: number | null      // job.total (per-cycle/per-visit for recurring; the price for one-offs)
  lineItems: AccountLineItem[]
  visits: AccountVisit[]       // all years; view picks a year
  jobberWebUri: string
  latestDate: string | null    // for sorting + one-off display
}
