// lib/service-mapping.ts
// Types for Service Mapping (Master PRD Session 6): the line-item → product(s)
// map (service_products) and the current-round selection per program
// (product_rounds). Both tables were created in Session 2; this session adds the
// admin UI + API. Shared by client + server.

export type MatchType = 'contains' | 'exact'
export const MATCH_TYPES: MatchType[] = ['contains', 'exact']

// One mapping row: a Jobber line item resolves to a product (many rows per line
// item is normal — a service can apply several products). Drives Route Capacity
// quantities and the Pesticide record.
export type ServiceProduct = {
  id: string
  company_id: string
  jobber_line_item_name: string
  match_type: MatchType
  product_id: string | null
  application_rate: number | null // overrides the product's default rate for this line item
  rate_unit: string | null
  program: string | null
  tank_default: number | null // 1–4
  notes: string | null
  is_active: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
}

// One round of a program, with the products applied that round. is_current marks
// the active round (at most one per program — enforced by a partial unique index).
export type ProductRound = {
  id: string
  company_id: string
  program: string
  round_label: string | null
  product_ids: string[]
  is_current: boolean
  effective_from: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

// Distinct Jobber line-item name + usage count, for the mapping autocomplete.
export type LineItemName = { name: string; uses: number }

export const TANK_OPTIONS = [1, 2, 3, 4] as const
