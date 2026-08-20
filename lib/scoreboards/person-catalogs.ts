/* The pure half of the person map: which catalogs name people, how each one is
 * bridged to the roster, and what to call them in a sentence.
 *
 * ⚠ Split from ./person-map.ts on purpose. That file reaches for the service-role
 * Supabase client, so importing it from a client component would pull the admin
 * client into the browser bundle. Everything here is constants and string work, so
 * the duplicate dialog and the server can share one set of names for things.
 */

import type { CatalogName } from './widgets/types'

export const PERSON_CATALOGS = [
  'goal_people',
  'staff_people',
  'commission_plan_people',
  'jobber_people',
  'lead_salespeople',
] as const

export type PersonCatalog = (typeof PERSON_CATALOGS)[number]

const PERSON_CATALOG_SET = new Set<string>(PERSON_CATALOGS)

export function isPersonCatalog(name: CatalogName | string): name is PersonCatalog {
  return PERSON_CATALOG_SET.has(name)
}

/**
 * How this catalog's value for a person is arrived at.
 *
 * `roster_id`  the source rows carry `employee_id`, so the name is looked UP
 * `recorded`   no link exists; a human answered once and the answer was stored
 */
export type Bridge = 'roster_id' | 'recorded'

export const CATALOG_BRIDGE: Record<PersonCatalog, Bridge> = {
  goal_people: 'roster_id',
  staff_people: 'roster_id',
  commission_plan_people: 'roster_id',
  jobber_people: 'recorded',
  lead_salespeople: 'recorded',
}

/** What each catalog is called when talking to whoever builds boards. */
export const CATALOG_LABEL: Record<PersonCatalog, string> = {
  goal_people: 'Goals cards',
  staff_people: 'Crew & labour cards',
  commission_plan_people: 'Commission and sales cards',
  jobber_people: 'Jobber technician cards',
  lead_salespeople: 'Lead Tracker cards',
}

/** The two that have to be answered, phrased as the question the dialog asks. */
export const RECORDED_PROMPT: Record<'jobber_people' | 'lead_salespeople', string> = {
  jobber_people: 'Which Jobber user is this?',
  lead_salespeople: 'Which Lead Tracker salesperson is this?',
}

/** Where the dialog fetches the names to choose from, for a catalog it must record. */
export const RECORDED_SOURCE: Record<'jobber_people' | 'lead_salespeople', string> = {
  jobber_people: 'Jobber',
  lead_salespeople: 'the Lead Tracker',
}
