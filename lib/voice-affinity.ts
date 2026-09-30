// AI Voice Receptionist — which open day is the best FIT for a caller, not merely
// the first one with room.
//
// Ben's steer (Sep 30 2026): "if somebody in Magnolia calls and we already have
// appointments in Magnolia on Tuesday, she should favor that day over Monday."
// So an open day is scored by how many stops the service's tech already has near
// the caller that day. Nearness is the company's own neighborhood vocabulary
// first (the job's Neighborhood field, else the job title, matched against the
// list in Admin → AI → Receptionist), and the zip code as the fallback for jobs
// whose neighborhood is missing ("ADD ME" is a quarter of Heroes' book).
//
// This is a PREFERENCE, never an identity: a zip is fine for deciding which day to
// offer first, and is never written into a job title (see lib/voice-jobs.ts for the
// rule against inferring a neighborhood from a zip).
//
// Reads the local Jobber mirror only — visits carry their tech, jobs their
// neighborhood and title, properties their zip — so it costs no Jobber round-trip
// on a live call. The mirror is refreshed by the sync + webhooks; a stop that
// landed minutes ago may be missing, which only makes a day look slightly less
// attractive, never unbookable (capacity is still counted live from Jobber).

import type { SupabaseClient } from '@supabase/supabase-js'
import { neighborhoodFromClientHistory, neighborhoodFromMap } from '@/lib/voice-jobs'

/** Case- and punctuation-insensitive key: "Bender's Landing" → "benderslanding". */
export const neighborhoodKey = (s: string | null | undefined): string =>
  (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Match a free-form neighborhood value against the company's list.
 *
 * Handles the three ways the office actually writes them: the exact name, an
 * abbreviation in the Neighborhood field ("WoodlandsW" for "Woodlands West"),
 * and the name buried in a job title ("IR SVC $125 Woodforest"). Longest names
 * are tried first so "Woodlands West" is never shadowed by "Woodlands".
 * Returns the list's own spelling, or null (including for Jobber's "ADD ME").
 */
export function matchNeighborhood(value: string | null | undefined, list: string[]): string | null {
  const key = neighborhoodKey(value)
  if (!key || key === 'addme') return null
  const ranked = [...list].sort((a, b) => b.length - a.length)
  for (const n of ranked) if (neighborhoodKey(n) === key) return n
  for (const n of ranked) {
    const nk = neighborhoodKey(n)
    if (nk.length >= 4 && key.includes(nk)) return n
  }
  if (key.length >= 5) {
    const prefixed = list.filter((n) => neighborhoodKey(n).startsWith(key))
    if (prefixed.length === 1) return prefixed[0] ?? null
  }
  return null
}

export type DayStops = {
  /** Stops for the relevant tech(s) that day, any location. */
  total: number
  /** Of those, in the caller's neighborhood. */
  sameNeighborhood: number
  /** Of those, in the caller's zip (counted only when the neighborhood didn't match). */
  sameZip: number
}

/**
 * Existing stops per day, near the caller, for the tech(s) who would do this job.
 *
 * `techIds` empty = every tech (a service with no assigned crew). Days with no
 * stops are simply absent from the result.
 */
export async function nearbyStopsByDay(
  admin: SupabaseClient,
  companyId: string,
  opts: {
    fromYmd: string
    toYmd: string
    techIds: string[]
    neighborhood: string | null
    zip: string | null
    neighborhoods: string[]
  },
): Promise<Record<string, DayStops>> {
  const out: Record<string, DayStops> = {}
  if (!opts.neighborhood && !opts.zip) return out

  let q = admin
    .from('visits')
    .select('scheduled_date, job_external_id')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .is('completed_at', null)
    .gte('scheduled_date', opts.fromYmd)
    .lte('scheduled_date', opts.toYmd)
    .limit(1000)
  if (opts.techIds.length) q = q.overlaps('tech_external_user_ids', opts.techIds)
  const { data: visits } = await q
  type V = { scheduled_date: string | null; job_external_id: string | null }
  const vs = ((visits as V[] | null) ?? []).filter((v) => v.scheduled_date && v.job_external_id)
  if (!vs.length) return out

  // Jobs (title + neighborhood + property) and properties (zip), fetched in
  // chunks — an .in() with hundreds of ids is a URL, and URLs have limits.
  const jobIds = [...new Set(vs.map((v) => v.job_external_id as string))]
  type J = { external_id: string; title: string | null; neighborhood: string | null; property_external_id: string | null }
  const jobs = new Map<string, J>()
  for (let i = 0; i < jobIds.length; i += 150) {
    const { data } = await admin
      .from('jobs')
      .select('external_id, title, neighborhood, property_external_id')
      .eq('company_id', companyId)
      .in('external_id', jobIds.slice(i, i + 150))
    for (const j of (data as J[] | null) ?? []) jobs.set(j.external_id, j)
  }
  const propIds = [...new Set([...jobs.values()].map((j) => j.property_external_id).filter((x): x is string => Boolean(x)))]
  const zipByProp = new Map<string, string>()
  for (let i = 0; i < propIds.length; i += 150) {
    const { data } = await admin
      .from('properties')
      .select('external_id, zip')
      .eq('company_id', companyId)
      .in('external_id', propIds.slice(i, i + 150))
    for (const p of (data as { external_id: string; zip: string | null }[] | null) ?? []) {
      if (p.zip) zipByProp.set(p.external_id, p.zip.trim().slice(0, 5))
    }
  }

  const wantN = opts.neighborhood ? neighborhoodKey(opts.neighborhood) : ''
  const wantZip = (opts.zip || '').trim().slice(0, 5)
  for (const v of vs) {
    const day = v.scheduled_date as string
    const j = jobs.get(v.job_external_id as string)
    const slot = (out[day] ??= { total: 0, sameNeighborhood: 0, sameZip: 0 })
    slot.total += 1
    if (!j) continue
    const n = matchNeighborhood(j.neighborhood, opts.neighborhoods) ?? matchNeighborhood(j.title, opts.neighborhoods)
    if (wantN && n && neighborhoodKey(n) === wantN) {
      slot.sameNeighborhood += 1
    } else if (wantZip && j.property_external_id && zipByProp.get(j.property_external_id) === wantZip) {
      slot.sameZip += 1
    }
  }
  return out
}

export type CallerLocale = {
  neighborhood: string | null
  zip: string | null
  /** Where the neighborhood came from — evidence about this customer, or the caller's own words. */
  source: 'history' | 'map' | 'spoken' | null
}

/**
 * Where the caller is, for the purpose of picking a day.
 *
 * An existing customer's own record wins (their earlier job titles, then the
 * neighborhood map, and their property's zip); what a caller SAID fills in only
 * what the record doesn't. A new caller has only their words.
 */
export async function resolveCallerLocale(
  admin: SupabaseClient,
  companyId: string,
  opts: {
    jobberClientId: string | null
    spokenNeighborhood?: string | null
    spokenZip?: string | null
    neighborhoods: string[]
  },
): Promise<CallerLocale> {
  let neighborhood: string | null = null
  let zip: string | null = null
  let source: CallerLocale['source'] = null

  if (opts.jobberClientId) {
    neighborhood = await neighborhoodFromClientHistory(admin, companyId, opts.jobberClientId, opts.neighborhoods).catch(() => null)
    if (neighborhood) source = 'history'

    const { data } = await admin
      .from('properties')
      .select('external_id, zip, is_billing_address')
      .eq('company_id', companyId)
      .eq('client_external_id', opts.jobberClientId)
      .is('deleted_at', null)
      .order('is_billing_address', { ascending: false, nullsFirst: false })
      .limit(1)
    const prop = (data as { external_id: string; zip: string | null }[] | null)?.[0]
    if (prop?.zip) zip = prop.zip.trim().slice(0, 5)
    if (!neighborhood && prop?.external_id) {
      const fromMap = await neighborhoodFromMap(admin, companyId, prop.external_id).catch(() => null)
      if (fromMap) {
        neighborhood = fromMap.name
        source = 'map'
      }
    }
  }

  if (!neighborhood && opts.spokenNeighborhood) {
    neighborhood = matchNeighborhood(opts.spokenNeighborhood, opts.neighborhoods)
    if (neighborhood) source = 'spoken'
  }
  if (!zip && opts.spokenZip) {
    const z = opts.spokenZip.replace(/\D/g, '').slice(0, 5)
    if (z.length === 5) zip = z
  }
  return { neighborhood, zip, source }
}
