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
