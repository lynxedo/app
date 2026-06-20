/**
 * Jobber → Supabase sync library (Session 67, updated Session 71)
 *
 * Three public exports:
 *   runInitialJobberSync(companyId)  — full YTD pull, run once
 *   runDeltaJobberSync(companyId)    — delta since last sync, run nightly
 *   processJobberWebhookEvent(...)   — handle a single webhook event (Session 68)
 *
 * Session 71 fixes:
 *   Bug 1 — customFields now reads all 6 Jobber types (was only Text + Numeric)
 *   Bug 2 — line_items unique key is now composite (external_id, parent_type,
 *            parent_external_id, source) so recurring-job siblings don't collide
 *   Enrichment — properties/clients/invoices pull richer fields
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { jobberGraphQLAdmin } from '@/lib/jobber'
import { postGuardianToUserDm } from '@/lib/guardian-post'
import { createPesticideRecordFromJobberVisit } from '@/lib/pesticide'

const COMPANY_ID = '00000000-0000-0000-0000-000000000002' // Heroes Lawn Care

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isThrottledError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.toUpperCase().includes('THROTTLED') || msg.includes('429')
}

async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 7; attempt++) {
    try { return await fn() }
    catch (e) {
      lastErr = e
      if (!isThrottledError(e)) throw e
      const delay = Math.min(15000, 1500 * 2 ** attempt)
      console.warn(`[jobber-sync] throttled, retrying in ${delay}ms (attempt ${attempt + 1})`)
      await sleep(delay)
    }
  }
  throw lastErr
}

async function throttleSleep(resp: unknown): Promise<void> {
  const cost = (resp as {
    extensions?: { cost?: {
      requestedQueryCost?: number
      throttleStatus?: { currentlyAvailable?: number; restoreRate?: number }
    } }
  })?.extensions?.cost
  const ts = cost?.throttleStatus
  if (!ts || ts.currentlyAvailable == null) { await sleep(300); return }
  const nextCost = cost?.requestedQueryCost ?? 0
  const restoreRate = ts.restoreRate || 500
  const deficit = nextCost - ts.currentlyAvailable
  if (deficit > 0) {
    const waitMs = Math.min(30000, Math.ceil((deficit / restoreRate) * 1000) + 300)
    console.log(`[jobber-sync] pacing ${waitMs}ms (cost ${nextCost}, avail ${ts.currentlyAvailable})`)
    await sleep(waitMs)
  } else {
    await sleep(300)
  }
}

async function getJobberUserId(companyId: string): Promise<string> {
  const admin = createAdminClient()
  const { data: profiles } = await admin
    .from('user_profiles')
    .select('id')
    .eq('company_id', companyId)
    .eq('role', 'admin')

  if (!profiles?.length) throw new Error('No admin users found for company')

  const userIds = profiles.map(p => p.id)
  const { data: token } = await admin
    .from('jobber_tokens')
    .select('user_id')
    .in('user_id', userIds)
    .limit(1)
    .maybeSingle()

  if (!token) throw new Error('No Jobber token found — an admin must connect Jobber first')
  return token.user_id
}

// ── Custom field parser ───────────────────────────────────────────────────────

// Covers all 6 Jobber CustomFieldUnion concrete types.
// __typename is required to pick the right value field.
interface RawCustomField {
  __typename?: string
  label?: string
  valueText?: string | null
  valueNumeric?: number | null
  valueDropdown?: string | null
  valueTrueFalse?: boolean | null
  valueArea?: { length?: number | null; width?: number | null } | null
  unit?: string | null
}

interface DenormalizedFields {
  route_code: string | null
  route_type: 'RC' | 'BP' | null
  lawn_size_k: number | null
  lawn_size_sqft: number | null
  cancellation_reason: string | null
  neighborhood: string | null
  gate_code: string | null
  onsite_time: string | null
  po_number: string | null
  custom_note: string | null
}

// Shared GraphQL fragment for all 6 custom field types (interpolated into queries below)
const CUSTOM_FIELDS_FRAGMENT = `
  __typename
  ... on CustomFieldText      { label valueText }
  ... on CustomFieldNumeric   { label valueNumeric }
  ... on CustomFieldTrueFalse { label valueTrueFalse }
  ... on CustomFieldDropdown  { label valueDropdown }
  ... on CustomFieldArea      { label valueArea { length width } unit }
`

function extractCustomFieldValue(f: RawCustomField): string | null {
  switch (f.__typename ?? '') {
    case 'CustomFieldText':      return f.valueText ?? null
    case 'CustomFieldNumeric':   return f.valueNumeric != null ? String(f.valueNumeric) : null
    case 'CustomFieldDropdown':  return f.valueDropdown ?? null
    case 'CustomFieldTrueFalse': return f.valueTrueFalse != null ? String(f.valueTrueFalse) : null
    case 'CustomFieldArea': {
      const a = f.valueArea
      if (a?.length != null && a?.width != null)
        return `${a.length}x${a.width}${f.unit ? ' ' + f.unit : ''}`
      return null
    }
    default:
      // Fallback for missing __typename
      return f.valueText ?? (f.valueNumeric != null ? String(f.valueNumeric) : null)
  }
}

function parseRouteCodeFromTitle(title: string | null): string | null {
  if (!title) return null
  const m = title.match(/\b(RC|BP)\d+\b/i)
  return m ? m[0].toUpperCase() : null
}

function deriveRouteType(routeCode: string | null): 'RC' | 'BP' | null {
  if (!routeCode) return null
  if (routeCode.startsWith('RC')) return 'RC'
  if (routeCode.startsWith('BP')) return 'BP'
  return null
}

/**
 * Parse a Jobber customFields array into:
 *   raw  — structured { type, value } map keyed by label (stored in the custom_fields jsonb column)
 *   cf   — lowercase-label → string value map (used for denormalization lookups)
 *   denormalized — job-specific extracted columns
 */
function parseCustomFields(
  rawFields: RawCustomField[],
  jobTitle: string | null
): { raw: Record<string, { type: string; value: string | null }>; cf: Record<string, string>; denormalized: DenormalizedFields } {
  const raw: Record<string, { type: string; value: string | null }> = {}
  const cf: Record<string, string> = {}

  for (const f of rawFields) {
    // Missing label = an inline fragment type we didn't request, or truly empty — skip.
    if (!f.label) continue
    const value = extractCustomFieldValue(f)
    raw[f.label] = { type: f.__typename ?? 'unknown', value }
    const key = f.label.toLowerCase().replace(/:+$/, '').trim()
    cf[key] = value ?? ''
  }

  const lawnSizeRaw = cf['lawn size'] ? Number(cf['lawn size']) : null
  const lawn_size_k = isFinite(lawnSizeRaw ?? NaN) && Math.abs(lawnSizeRaw!) < 10000 ? lawnSizeRaw : null
  const lawn_size_sqft = lawn_size_k != null ? Math.round(lawn_size_k * 1000) : null

  const routeRaw = (cf['wf route'] ?? '').trim() || parseRouteCodeFromTitle(jobTitle)
  const route_code = routeRaw?.match(/^(RC|BP)\d+$/i) ? routeRaw.toUpperCase() : null
  const route_type = deriveRouteType(route_code)

  const custom_note = cf['note'] || cf['note:'] || cf['note::'] || null

  return {
    raw,
    cf,
    denormalized: {
      route_code,
      route_type,
      lawn_size_k,
      lawn_size_sqft,
      cancellation_reason: cf['cancellation reason'] || null,
      neighborhood: cf['neighborhood'] || null,
      gate_code: cf['gate code'] || null,
      onsite_time: cf['onsite time'] || cf['on site time'] || null,
      po_number: cf['po#'] || cf['po #'] || null,
      custom_note,
    },
  }
}

/**
 * Deduplicate line_item rows by composite key within a batch page.
 * Recurring-job visits share the same JobLineItem IDs — the composite key
 * (external_id + parent_type + parent_external_id) makes them distinct.
 */
// Resolve a batch of Jobber external_ids to their internal row ids in ONE query
// (replacing a per-row .select()). Returns a Map keyed by external_id. Chunks the
// IN list defensively so a very large page can't blow the URL length limit.
async function fetchIdMap(
  admin: SupabaseClient,
  table: 'clients' | 'jobs' | 'properties' | 'visits' | 'invoices',
  externalIds: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const ids = [...new Set(externalIds.filter((x): x is string => !!x))]
  const map = new Map<string, string>()
  if (!ids.length) return map
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200)
    const { data, error } = await admin
      .from(table)
      .select('id, external_id')
      .eq('source', 'jobber')
      .in('external_id', slice)
    if (error) throw new Error(`${table} id-map: ${error.message}`)
    for (const r of (data ?? []) as Array<{ id: string; external_id: string }>) {
      map.set(r.external_id, r.id)
    }
  }
  return map
}

function dedupLineItems(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Map<string, Record<string, unknown>>()
  for (const r of rows) {
    const key = `${r.external_id}|${r.parent_type}|${r.parent_external_id}`
    seen.set(key, r)
  }
  return Array.from(seen.values())
}

function parseDeptPrefix(lineItemName: string | null | undefined): string | null {
  if (!lineItemName) return null
  const prefixes = ['WF', 'IR', 'PW', 'MO', 'LD']
  const upper = lineItemName.toUpperCase()
  for (const p of prefixes) {
    if (upper.startsWith(p + ' ') || upper.startsWith(p + '-') || upper === p) return p
  }
  return null
}

// ── Sync log helpers ──────────────────────────────────────────────────────────

async function startSyncLog(companyId: string, syncType: string, entity: string | null) {
  const admin = createAdminClient()
  const { data } = await admin.from('sync_log').insert({
    company_id: companyId,
    sync_type: syncType,
    entity,
    status: 'running',
  }).select('id').single()
  return data?.id as string
}

async function completeSyncLog(
  id: string,
  upserted: number,
  skipped: number = 0,
  error?: string
) {
  const admin = createAdminClient()
  await admin.from('sync_log').update({
    status: error ? 'failed' : 'completed',
    completed_at: new Date().toISOString(),
    records_upserted: upserted,
    records_skipped: skipped,
    error_message: error ?? null,
  }).eq('id', id)
}

// ── Entity sync functions ─────────────────────────────────────────────────────

// ── Clients ──────────────────────────────────────────────────────────────────

const CLIENTS_QUERY = `
  query SyncClients($cursor: String, $filter: ClientFilterAttributes) {
    clients(first: 40, after: $cursor, filter: $filter) {
      nodes {
        id
        name
        firstName
        lastName
        companyName
        isCompany
        isLead
        emails { address primary }
        phones { number primary }
        balance
        isArchived
        leadSource
        jobberWebUri
        customFields {
          ${CUSTOM_FIELDS_FRAGMENT}
        }
        createdAt
        updatedAt
        contacts(first: 5) {
          nodes {
            id
            firstName
            lastName
            name
            title
            role
            emails(first: 3) { nodes { address } }
            phones(first: 3) { nodes { number } }
            isBillingContact
            receivesFollowUps
            receivesReminders
            createdAt
          }
        }
        notes(first: 10) {
          nodes {
            id
            message
            pinned
            createdAt
          }
        }
        tags(first: 10) { nodes { label } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

async function syncClients(
  userId: string,
  companyId: string,
  updatedSince?: Date
): Promise<number> {
  const admin = createAdminClient()
  let cursor: string | null = null
  let total = 0

  while (true) {
    const filter = updatedSince
      ? { updatedAt: { after: updatedSince.toISOString() } }
      : undefined

    const resp = await withRateLimit(() =>
      jobberGraphQLAdmin<{ data: { clients: { nodes: unknown[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } }>(
        userId, CLIENTS_QUERY, { cursor, filter }
      )
    )

    const { nodes, pageInfo } = resp.data.clients
    const clientNodes = nodes as ClientNode[]
    const nowIso = new Date().toISOString()

    // 1) Build every client row for the page, then upsert them in ONE call and
    //    read the resulting ids back in the same round-trip (no per-row reselect).
    const prepared = clientNodes.map(raw => {
      const primaryEmail = raw.emails?.find(e => e.primary)?.address ?? raw.emails?.[0]?.address ?? null
      const primaryPhone = raw.phones?.find(p => p.primary)?.number ?? raw.phones?.[0]?.number ?? null
      // Parse custom fields — all 6 types now captured
      const { raw: cfRaw, cf } = parseCustomFields((raw.customFields ?? []) as RawCustomField[], null)
      const customer_since = cf['customer since date'] || cf['customer since'] || null
      const sales_person   = cf['sales person'] || cf['salesperson'] || null
      const cancellation_reason = cf['cancellation reason'] || null
      return {
        raw, primaryEmail, primaryPhone,
        row: {
          company_id: companyId,
          source: 'jobber',
          external_id: raw.id,
          name: raw.name ?? null,
          first_name: raw.firstName ?? null,
          last_name: raw.lastName ?? null,
          company_name: raw.companyName ?? null,
          is_company: raw.isCompany ?? false,
          is_lead: raw.isLead ?? false,
          email: primaryEmail,
          phone: primaryPhone,
          balance: raw.balance ?? null,
          is_archived: raw.isArchived ?? false,
          lead_source: raw.leadSource ?? null,
          jobber_web_uri: raw.jobberWebUri ?? null,
          custom_fields: Object.keys(cfRaw).length > 0 ? cfRaw : null,
          customer_since: customer_since ?? null,
          sales_person: sales_person ?? null,
          cancellation_reason: cancellation_reason ?? null,
          last_synced_at: nowIso,
          external_created_at: raw.createdAt ?? null,
          updated_at: nowIso,
          deleted_at: null,
        },
      }
    })

    const clientIdByExternal = new Map<string, string>()
    if (prepared.length) {
      const { data: upserted, error } = await admin
        .from('clients')
        .upsert(prepared.map(p => p.row), { onConflict: 'external_id,source' })
        .select('id, external_id')
      if (error) throw new Error(`clients upsert: ${error.message}`)
      for (const r of upserted ?? []) clientIdByExternal.set(r.external_id, r.id)
    }

    // 2) Collect contacts, notes, and tag links across the whole page, then write
    //    each table in a single batched upsert instead of one row at a time.
    const allContacts: ContactUpsert[] = []
    const allNotes: Record<string, unknown>[] = []
    const tagLabels = new Set<string>()
    const tagPairs: Array<{ clientExternalId: string; label: string }> = []

    for (const { raw, primaryEmail, primaryPhone } of prepared) {
      const clientId = clientIdByExternal.get(raw.id)
      if (!clientId) continue

      allContacts.push({
        company_id: companyId,
        source: 'jobber',
        external_id: `${raw.id}_primary`,
        client_id: clientId,
        is_primary: true,
        // NOT-NULL column with a DB default, but in a batched upsert PostgREST
        // sends explicit NULL for rows that omit the key (the per-contact rows
        // below set it), so the default never applies — set it here too.
        is_billing_contact: false,
        first_name: raw.firstName ?? null,
        last_name: raw.lastName ?? null,
        name: raw.name ?? null,
        email: primaryEmail,
        phone: primaryPhone,
        last_synced_at: nowIso,
        external_created_at: raw.createdAt ?? null,
        updated_at: nowIso,
      })

      for (const c of raw.contacts?.nodes ?? []) {
        allContacts.push({
          company_id: companyId,
          source: 'jobber',
          external_id: c.id,
          client_id: clientId,
          is_primary: false,
          first_name: c.firstName ?? null,
          last_name: c.lastName ?? null,
          name: c.name ?? null,
          title: c.title ?? null,
          role: c.role ?? null,
          email: c.emails?.nodes?.[0]?.address ?? null,
          phone: c.phones?.nodes?.[0]?.number ?? null,
          is_billing_contact: c.isBillingContact ?? false,
          receives_followups: c.receivesFollowUps ?? null,
          receives_reminders: c.receivesReminders ?? null,
          last_synced_at: nowIso,
          external_created_at: c.createdAt ?? null,
          updated_at: nowIso,
        })
      }

      for (const note of raw.notes?.nodes ?? []) {
        allNotes.push({
          company_id: companyId,
          source: 'jobber',
          external_id: note.id,
          client_id: clientId,
          body: note.message ?? null,
          author_external_id: null,
          pinned: note.pinned ?? false,
          last_synced_at: nowIso,
          external_created_at: note.createdAt ?? null,
        })
      }

      for (const tag of raw.tags?.nodes ?? []) {
        tagLabels.add(tag.label)
        tagPairs.push({ clientExternalId: raw.id, label: tag.label })
      }
    }

    if (allContacts.length) {
      const { error } = await admin.from('contacts').upsert(allContacts, { onConflict: 'external_id,source' })
      if (error) throw new Error(`contacts upsert: ${error.message}`)
    }
    if (allNotes.length) {
      const { error } = await admin.from('client_notes').upsert(allNotes, { onConflict: 'external_id,source' })
      if (error) throw new Error(`client_notes upsert: ${error.message}`)
    }

    // 3) Tags: upsert the unique labels for the page once, map name->id, then
    //    upsert all client<->tag links in one call (deduped to avoid same-batch
    //    conflicts on the (client_id, tag_id) unique index).
    if (tagLabels.size) {
      const { data: tagRows, error: tagErr } = await admin
        .from('tags')
        .upsert(
          [...tagLabels].map(name => ({ company_id: companyId, source: 'jobber', name })),
          { onConflict: 'company_id,name' as string, ignoreDuplicates: false }
        )
        .select('id, name')
      if (tagErr) throw new Error(`tags upsert: ${tagErr.message}`)
      const tagIdByName = new Map((tagRows ?? []).map(t => [t.name, t.id]))

      const seenPair = new Set<string>()
      const clientTagRows: Array<{ client_id: string; tag_id: string }> = []
      for (const p of tagPairs) {
        const cid = clientIdByExternal.get(p.clientExternalId)
        const tid = tagIdByName.get(p.label)
        if (!cid || !tid) continue
        const key = `${cid}|${tid}`
        if (seenPair.has(key)) continue
        seenPair.add(key)
        clientTagRows.push({ client_id: cid, tag_id: tid })
      }
      if (clientTagRows.length) {
        const { error } = await admin.from('client_tags').upsert(clientTagRows, { ignoreDuplicates: true })
        if (error) throw new Error(`client_tags upsert: ${error.message}`)
      }
    }

    total += nodes.length
    console.log(`[jobber-sync] clients: synced ${total} so far`)

    if (!pageInfo.hasNextPage) break
    cursor = pageInfo.endCursor
    await throttleSleep(resp)
  }

  return total
}

// ── Properties ────────────────────────────────────────────────────────────────

const PROPERTIES_QUERY = `
  query SyncProperties($cursor: String) {
    properties(first: 100, after: $cursor) {
      nodes {
        id
        name
        isBillingAddress
        jobberWebUri
        address { street1 street2 city province postalCode }
        client { id }
        customFields {
          ${CUSTOM_FIELDS_FRAGMENT}
        }
        createdAt
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

async function syncProperties(
  userId: string,
  companyId: string,
  _updatedSince?: Date
): Promise<number> {
  const admin = createAdminClient()
  let cursor: string | null = null
  let total = 0

  while (true) {
    const resp = await withRateLimit(() =>
      jobberGraphQLAdmin<{ data: { properties: { nodes: PropertyNode[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } }>(
        userId, PROPERTIES_QUERY, { cursor }
      )
    )

    const { nodes, pageInfo } = resp.data.properties

    // Resolve every referenced client_id in ONE query instead of one per property.
    const clientIdByExternal = await fetchIdMap(admin, 'clients',
      nodes.map(p => p.client?.id).filter((x): x is string => !!x))

    const rows = nodes.map((p) => {
      const clientRow = clientIdByExternal.get(p.client?.id ?? '')

      // Parse property-level custom fields
      const { raw: cfRaw, cf } = parseCustomFields(p.customFields ?? [], null)

      // Denormalize physical attributes
      const lawnSizeRaw = cf['lawn size'] ? Number(cf['lawn size']) : null
      const propLawnSizeK = isFinite(lawnSizeRaw ?? NaN) && Math.abs(lawnSizeRaw!) < 10000 ? lawnSizeRaw : null
      const propLawnSizeSqft = propLawnSizeK != null ? Math.round(propLawnSizeK * 1000) : null
      const irrigZonesRaw = cf['irrigation zones'] ?? cf['irrigation zone'] ?? null
      const irrigation_zones = irrigZonesRaw ? (parseInt(irrigZonesRaw) || null) : null
      const sprinklerRaw = cf['sprinkler system'] ?? cf['sprinklers'] ?? null
      const sprinkler_system = sprinklerRaw != null && sprinklerRaw !== ''
        ? (sprinklerRaw.toLowerCase() === 'true' || sprinklerRaw.toLowerCase() === 'yes')
        : null

      return {
        company_id: companyId,
        source: 'jobber',
        external_id: p.id,
        client_id: clientRow ?? null,
        client_external_id: p.client?.id ?? null,
        name: p.name ?? null,
        is_billing_address: p.isBillingAddress ?? null,
        jobber_web_uri: p.jobberWebUri ?? null,
        latitude: null,
        longitude: null,
        address_line1: p.address?.street1 ?? null,
        address_line2: p.address?.street2 ?? null,
        city: p.address?.city ?? null,
        state: p.address?.province ?? null,
        zip: p.address?.postalCode ?? null,
        custom_fields: Object.keys(cfRaw).length > 0 ? cfRaw : null,
        lawn_size_k: propLawnSizeK,
        lawn_size_sqft: propLawnSizeSqft,
        irrigation_zones,
        sprinkler_system,
        gate_code: cf['gate code'] || null,
        neighborhood: cf['neighborhood'] || null,
        last_synced_at: new Date().toISOString(),
        external_created_at: p.createdAt ?? null,
        updated_at: new Date().toISOString(),
        deleted_at: null,
      }
    })

    if (rows.length) {
      const { error } = await admin.from('properties').upsert(rows, { onConflict: 'external_id,source' })
      if (error) throw new Error(`properties upsert: ${error.message}`)
    }

    total += nodes.length
    console.log(`[jobber-sync] properties: synced ${total} so far`)

    if (!pageInfo.hasNextPage) break
    cursor = pageInfo.endCursor
    await throttleSleep(resp)
  }

  return total
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

const JOBS_QUERY = `
  query SyncJobs($cursor: String, $filter: JobFilterAttributes) {
    jobs(first: 40, after: $cursor, filter: $filter) {
      nodes {
        id
        title
        jobNumber
        jobStatus
        jobType
        billingType
        total
        invoicedTotal
        uninvoicedTotal
        startAt
        endAt
        completedAt
        jobberWebUri
        createdAt
        updatedAt
        client { id }
        property { id }
        salesperson { id }
        customFields {
          ${CUSTOM_FIELDS_FRAGMENT}
        }
        lineItems(first: 25) {
          nodes {
            id
            name
            description
            quantity
            unitPrice
            totalPrice
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

async function syncJobs(
  userId: string,
  companyId: string,
  updatedSince?: Date,
  ids?: string[]
): Promise<number> {
  const admin = createAdminClient()
  let cursor: string | null = null
  let total = 0

  while (true) {
    const filter: Record<string, unknown> = {}
    if (ids?.length) {
      filter.ids = ids
    } else if (updatedSince) {
      // Jobber's JobFilterAttributes has NO `updatedAt` field (confirmed via
      // introspection), so #6's switch to updatedAt broke the nightly delta with
      // a GraphQL error. Reverted to createdAt (the pre-#6, valid filter) — the
      // delta catches newly-created jobs; EDITS to existing jobs are caught in
      // real time by the Jobber webhook (`/api/jobber/webhooks`), so nothing is missed.
      filter.createdAt = { after: updatedSince.toISOString() }
    } else {
      filter.visitsScheduledBetween = {
        after: '2026-01-01T00:00:00Z',
        before: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      }
    }

    const resp = await withRateLimit(() =>
      jobberGraphQLAdmin<{ data: { jobs: { nodes: JobNode[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } }>(
        userId, JOBS_QUERY, { cursor, filter }
      )
    )

    const { nodes, pageInfo } = resp.data.jobs
    const nowIso = new Date().toISOString()

    // Resolve all referenced client + property ids for the page in 2 queries.
    const [jobClientIds, jobPropIds] = await Promise.all([
      fetchIdMap(admin, 'clients', nodes.map(j => j.client?.id)),
      fetchIdMap(admin, 'properties', nodes.map(j => j.property?.id)),
    ])

    const jobRows = nodes.map(job => {
      const { raw, denormalized } = parseCustomFields(
        (job.customFields ?? []) as RawCustomField[],
        job.title ?? null
      )
      const deptPrefix = (() => {
        for (const li of job.lineItems?.nodes ?? []) {
          const p = parseDeptPrefix(li.name)
          if (p) return p
        }
        return null
      })()
      return {
        company_id: companyId,
        source: 'jobber',
        external_id: job.id,
        client_id: jobClientIds.get(job.client?.id ?? '') ?? null,
        client_external_id: job.client?.id ?? null,
        property_id: jobPropIds.get(job.property?.id ?? '') ?? null,
        property_external_id: job.property?.id ?? null,
        title: job.title ?? null,
        job_number: job.jobNumber ?? null,
        is_recurring: (job.jobType ?? '').toUpperCase().includes('RECURRING'),
        job_status: job.jobStatus ?? null,
        job_type: job.jobType ?? null,
        billing_type: job.billingType ?? null,
        total: job.total ?? null,
        invoiced_total: job.invoicedTotal ?? null,
        uninvoiced_total: job.uninvoicedTotal ?? null,
        start_at: job.startAt ?? null,
        end_at: job.endAt ?? null,
        completed_at: job.completedAt ?? null,
        salesperson_external_id: job.salesperson?.id ?? null,
        dept_prefix: deptPrefix,
        ...denormalized,
        custom_fields: Object.keys(raw).length > 0 ? raw : null,
        jobber_web_uri: job.jobberWebUri ?? null,
        last_synced_at: nowIso,
        external_created_at: job.createdAt ?? null,
        updated_at: nowIso,
        deleted_at: null,
      }
    })

    // Upsert all jobs and read their ids back in the same round-trip.
    const jobIdByExternal = new Map<string, string>()
    if (jobRows.length) {
      const { data, error } = await admin.from('jobs')
        .upsert(jobRows, { onConflict: 'external_id,source' })
        .select('id, external_id')
      if (error) throw new Error(`jobs upsert: ${error.message}`)
      for (const r of data ?? []) jobIdByExternal.set(r.external_id, r.id)
    }

    // Upsert every line item for the page in one call.
    const lineItemRows = nodes.flatMap(job => {
      const jobId = jobIdByExternal.get(job.id)
      if (!jobId) return []
      return (job.lineItems?.nodes ?? []).map(li => ({
        company_id: companyId,
        source: 'jobber',
        external_id: li.id,
        parent_type: 'job',
        parent_id: jobId,
        parent_external_id: job.id,
        name: li.name,
        description: li.description ?? null,
        dept_prefix: parseDeptPrefix(li.name),
        is_recurring_program: false,
        is_auxiliary: false,
        quantity: li.quantity ?? null,
        unit_price: li.unitPrice ?? null,
        total: li.totalPrice ?? null,
        last_synced_at: nowIso,
        updated_at: nowIso,
      }))
    })
    if (lineItemRows.length) {
      const { error } = await admin.from('line_items').upsert(
        dedupLineItems(lineItemRows),
        { onConflict: 'external_id,parent_type,parent_external_id,source' }
      )
      if (error) throw new Error(`job line_items upsert: ${error.message}`)
    }

    total += nodes.length
    console.log(`[jobber-sync] jobs: synced ${total} so far`)

    if (!pageInfo.hasNextPage) break
    cursor = pageInfo.endCursor
    await throttleSleep(resp)
  }

  return total
}

// ── Visits ────────────────────────────────────────────────────────────────────

const VISITS_SYNC_QUERY = `
  query SyncVisits($cursor: String, $filter: VisitFilterAttributes) {
    visits(first: 40, after: $cursor, filter: $filter) {
      nodes {
        id
        title
        startAt
        endAt
        completedAt
        visitStatus
        createdAt
        job { id }
        client { id }
        assignedUsers(first: 10) { nodes { id } }
        lineItems(first: 25) {
          nodes {
            id
            name
            description
            quantity
            unitPrice
            totalPrice
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

async function syncVisits(
  userId: string,
  companyId: string,
  updatedSince?: Date,
  ids?: string[]
): Promise<number> {
  const admin = createAdminClient()
  let cursor: string | null = null
  let total = 0

  while (true) {
    const filter: Record<string, unknown> = {}
    if (ids?.length) {
      filter.ids = ids
    } else if (updatedSince) {
      // Jobber's VisitFilterAttributes has NO `updatedAt` field (confirmed via
      // introspection), so #6's switch to updatedAt broke the nightly delta with
      // a GraphQL error. Reverted to startAt (the pre-#6, valid filter) — the
      // delta catches visits scheduled since the cutoff (incl. today's, which is
      // where completions happen); EDITS/reschedules of existing visits are caught
      // in real time by the Jobber webhook (`/api/jobber/webhooks`).
      filter.startAt = { after: updatedSince.toISOString() }
    } else {
      filter.startAt = {
        after: '2026-01-01T00:00:00Z',
        before: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      }
    }

    const resp = await withRateLimit(() =>
      jobberGraphQLAdmin<{ data: { visits: { nodes: VisitNode[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } }>(
        userId, VISITS_SYNC_QUERY, { cursor, filter }
      )
    )

    const { nodes, pageInfo } = resp.data.visits
    const nowIso = new Date().toISOString()

    // Resolve referenced job + client ids for the page in 2 queries.
    const [visitJobIds, visitClientIds] = await Promise.all([
      fetchIdMap(admin, 'jobs', nodes.map(v => v.job?.id)),
      fetchIdMap(admin, 'clients', nodes.map(v => v.client?.id)),
    ])

    const visitRows = nodes.map(v => ({
      company_id: companyId,
      source: 'jobber',
      external_id: v.id,
      job_id: visitJobIds.get(v.job?.id ?? '') ?? null,
      job_external_id: v.job?.id ?? null,
      client_id: visitClientIds.get(v.client?.id ?? '') ?? null,
      client_external_id: v.client?.id ?? null,
      title: v.title ?? null,
      scheduled_date: v.startAt ? v.startAt.split('T')[0] : null,
      start_at: v.startAt ?? null,
      end_at: v.endAt ?? null,
      completed_at: v.completedAt ?? null,
      visit_status: v.visitStatus ?? null,
      tech_external_user_ids: v.assignedUsers?.nodes?.map((u: { id: string }) => u.id) ?? [],
      subtotal: null,
      total: null,
      override_reason: null,
      last_synced_at: nowIso,
      external_created_at: v.createdAt ?? null,
      updated_at: nowIso,
      deleted_at: null,
    }))

    // Upsert all visits and read their ids back in the same round-trip.
    const visitIdByExternal = new Map<string, string>()
    if (visitRows.length) {
      const { data, error } = await admin.from('visits')
        .upsert(visitRows, { onConflict: 'external_id,source' })
        .select('id, external_id')
      if (error) throw new Error(`visits upsert: ${error.message}`)
      for (const r of data ?? []) visitIdByExternal.set(r.external_id, r.id)
    }

    const lineItemRows = nodes.flatMap(v => {
      const visitId = visitIdByExternal.get(v.id)
      if (!visitId) return []
      return (v.lineItems?.nodes ?? []).map(li => ({
        company_id: companyId,
        source: 'jobber',
        external_id: li.id,
        parent_type: 'visit',
        parent_id: visitId,
        parent_external_id: v.id,
        name: li.name,
        description: li.description ?? null,
        dept_prefix: parseDeptPrefix(li.name),
        is_recurring_program: false,
        is_auxiliary: false,
        quantity: li.quantity ?? null,
        unit_price: li.unitPrice ?? null,
        total: li.totalPrice ?? null,
        last_synced_at: nowIso,
        updated_at: nowIso,
      }))
    })
    if (lineItemRows.length) {
      const { error } = await admin.from('line_items').upsert(
        dedupLineItems(lineItemRows),
        { onConflict: 'external_id,parent_type,parent_external_id,source' }
      )
      if (error) throw new Error(`visit line_items upsert: ${error.message}`)
    }

    total += nodes.length
    console.log(`[jobber-sync] visits: synced ${total} so far`)

    if (!pageInfo.hasNextPage) break
    cursor = pageInfo.endCursor
    await throttleSleep(resp)
  }

  return total
}

// ── Invoices ──────────────────────────────────────────────────────────────────

const INVOICES_QUERY = `
  query SyncInvoices($cursor: String, $filter: InvoiceFilterAttributes) {
    invoices(first: 40, after: $cursor, filter: $filter) {
      nodes {
        id
        invoiceNumber
        invoiceStatus
        invoiceNet
        subject
        jobberWebUri
        amounts {
          subtotal
          total
          invoiceBalance
          taxAmount
          discountAmount
          paymentsTotal
          depositAmount
          tipsTotal
        }
        issuedDate
        dueDate
        receivedDate
        createdAt
        updatedAt
        client { id }
        salesperson { id }
        jobs(first: 1) { nodes { id } }
        customFields {
          ${CUSTOM_FIELDS_FRAGMENT}
        }
        lineItems(first: 25) {
          nodes {
            id
            name
            description
            quantity
            unitPrice
            totalPrice
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

async function syncInvoices(
  userId: string,
  companyId: string,
  updatedSince?: Date
): Promise<number> {
  const admin = createAdminClient()
  let cursor: string | null = null
  let total = 0

  while (true) {
    const filter: Record<string, unknown> = {}
    if (updatedSince) {
      filter.updatedAt = { after: updatedSince.toISOString() }
    } else {
      filter.issuedDate = { after: '2026-01-01T00:00:00Z' }
    }

    const resp = await withRateLimit(() =>
      jobberGraphQLAdmin<{ data: { invoices: { nodes: InvoiceNode[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } }>(
        userId, INVOICES_QUERY, { cursor, filter }
      )
    )

    const { nodes, pageInfo } = resp.data.invoices
    const nowIso = new Date().toISOString()

    // Resolve referenced client + job ids for the page in 2 queries.
    const [invClientIds, invJobIds] = await Promise.all([
      fetchIdMap(admin, 'clients', nodes.map(inv => inv.client?.id)),
      fetchIdMap(admin, 'jobs', nodes.map(inv => inv.jobs?.nodes?.[0]?.id)),
    ])

    const invoiceRows = nodes.map(inv => {
      const jobExternalId = inv.jobs?.nodes?.[0]?.id ?? null
      const { raw: cfRaw } = parseCustomFields((inv.customFields ?? []) as RawCustomField[], null)
      return {
        company_id: companyId,
        source: 'jobber',
        external_id: inv.id,
        client_id: invClientIds.get(inv.client?.id ?? '') ?? null,
        client_external_id: inv.client?.id ?? null,
        job_id: invJobIds.get(jobExternalId ?? '') ?? null,
        job_external_id: jobExternalId,
        invoice_number: inv.invoiceNumber ?? null,
        subject: inv.subject ?? null,
        jobber_web_uri: inv.jobberWebUri ?? null,
        subtotal: inv.amounts?.subtotal ?? null,
        total: inv.amounts?.total ?? null,
        outstanding_balance: inv.amounts?.invoiceBalance ?? null,
        tax_amount: inv.amounts?.taxAmount ?? null,
        discount_amount: inv.amounts?.discountAmount ?? null,
        payments_total: inv.amounts?.paymentsTotal ?? null,
        deposit_amount: inv.amounts?.depositAmount ?? null,
        tips_total: inv.amounts?.tipsTotal ?? null,
        invoice_net_days: inv.invoiceNet ?? null,
        salesperson_external_id: inv.salesperson?.id ?? null,
        invoice_status: inv.invoiceStatus ?? null,
        issued_date: inv.issuedDate ?? null,
        due_date: inv.dueDate ?? null,
        paid_at: inv.receivedDate ?? null,
        custom_fields: Object.keys(cfRaw).length > 0 ? cfRaw : null,
        last_synced_at: nowIso,
        external_created_at: inv.createdAt ?? null,
        updated_at: nowIso,
        deleted_at: null,
      }
    })

    // Upsert all invoices and read their ids back in the same round-trip.
    const invoiceIdByExternal = new Map<string, string>()
    if (invoiceRows.length) {
      const { data, error } = await admin.from('invoices')
        .upsert(invoiceRows, { onConflict: 'external_id,source' })
        .select('id, external_id')
      if (error) throw new Error(`invoices upsert: ${error.message}`)
      for (const r of data ?? []) invoiceIdByExternal.set(r.external_id, r.id)
    }

    const lineItemRows = nodes.flatMap(inv => {
      const invId = invoiceIdByExternal.get(inv.id)
      if (!invId) return []
      return (inv.lineItems?.nodes ?? []).map(li => ({
        company_id: companyId,
        source: 'jobber',
        external_id: li.id,
        parent_type: 'invoice',
        parent_id: invId,
        parent_external_id: inv.id,
        name: li.name,
        description: li.description ?? null,
        dept_prefix: parseDeptPrefix(li.name),
        is_recurring_program: false,
        is_auxiliary: false,
        quantity: li.quantity ?? null,
        unit_price: li.unitPrice ?? null,
        total: li.totalPrice ?? null,
        last_synced_at: nowIso,
        updated_at: nowIso,
      }))
    })
    if (lineItemRows.length) {
      const { error } = await admin.from('line_items').upsert(
        dedupLineItems(lineItemRows),
        { onConflict: 'external_id,parent_type,parent_external_id,source' }
      )
      if (error) throw new Error(`invoice line_items upsert: ${error.message}`)
    }

    total += nodes.length
    console.log(`[jobber-sync] invoices: synced ${total} so far`)

    if (!pageInfo.hasNextPage) break
    cursor = pageInfo.endCursor
    await throttleSleep(resp)
  }

  return total
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface SyncSummary {
  clients: number
  properties: number
  jobs: number
  visits: number
  invoices: number
  errors: string[]
}

export async function runInitialJobberSync(companyId: string): Promise<SyncSummary> {
  const logId = await startSyncLog(companyId, 'initial_pull', null)
  const summary: SyncSummary = { clients: 0, properties: 0, jobs: 0, visits: 0, invoices: 0, errors: [] }

  try {
    const userId = await getJobberUserId(companyId)
    console.log('[jobber-sync] Starting initial YTD pull...')

    summary.clients    = await syncClients(userId, companyId)
    summary.properties = await syncProperties(userId, companyId)
    summary.jobs       = await syncJobs(userId, companyId)
    summary.visits     = await syncVisits(userId, companyId)
    summary.invoices   = await syncInvoices(userId, companyId)

    console.log('[jobber-sync] Initial pull complete:', summary)
    await completeSyncLog(logId, Object.values(summary).filter(v => typeof v === 'number').reduce((a, b) => a + (b as number), 0))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    summary.errors.push(msg)
    console.error('[jobber-sync] Initial pull failed:', msg)
    await completeSyncLog(logId, 0, 0, msg)
    await notifyJobberSyncFailure(companyId, `Initial pull: ${msg}`)
  }

  return summary
}

export async function runDeltaJobberSync(companyId: string): Promise<SyncSummary> {
  const admin = createAdminClient()
  const logId = await startSyncLog(companyId, 'daily_delta', null)
  const summary: SyncSummary = { clients: 0, properties: 0, jobs: 0, visits: 0, invoices: 0, errors: [] }

  try {
    const { data: lastSync } = await admin
      .from('sync_log')
      .select('completed_at')
      .eq('company_id', companyId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const updatedSince = lastSync?.completed_at
      ? new Date(lastSync.completed_at)
      : new Date(Date.now() - 25 * 60 * 60 * 1000)

    console.log('[jobber-sync] Delta pull since:', updatedSince.toISOString())

    const userId = await getJobberUserId(companyId)
    summary.clients    = await syncClients(userId, companyId, updatedSince)
    summary.properties = await syncProperties(userId, companyId, updatedSince)
    summary.jobs       = await syncJobs(userId, companyId, updatedSince)
    summary.visits     = await syncVisits(userId, companyId, updatedSince)
    summary.invoices   = await syncInvoices(userId, companyId, updatedSince)

    console.log('[jobber-sync] Delta pull complete:', summary)
    await completeSyncLog(logId, Object.values(summary).filter(v => typeof v === 'number').reduce((a, b) => a + (b as number), 0))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    summary.errors.push(msg)
    console.error('[jobber-sync] Delta pull failed:', msg)
    await completeSyncLog(logId, 0, 0, msg)
    await notifyJobberSyncFailure(companyId, `Delta pull: ${msg}`)
  }

  return summary
}

/**
 * Handle a single Jobber webhook event (Session 68).
 *
 * DESTROY events soft-delete the mirror row by external_id (no fetch needed).
 * For CREATE / UPDATE / COMPLETE the fetch strategy is per-entity, because
 * Jobber's filter inputs are asymmetric:
 *   - Clients & Invoices have `updatedAt` but no `ids` filter → narrow
 *     updated-since window anchored to the event's occurredAt.
 *   - Jobs & Visits have `ids` but no `updatedAt` → exact fetch by id, so an
 *     edit or completion on an older record is never missed by a time window.
 */
export async function processJobberWebhookEvent(
  event: { topic: string; itemId: string; companyId: string; occurredAt?: string | null }
): Promise<void> {
  const { topic, itemId, companyId, occurredAt } = event
  const admin = createAdminClient()

  const destroyTable: Record<string, string> = {
    CLIENT_DESTROY: 'clients',
    JOB_DESTROY: 'jobs',
    VISIT_DESTROY: 'visits',
    INVOICE_DESTROY: 'invoices',
  }
  if (topic in destroyTable) {
    const table = destroyTable[topic]
    const { error } = await admin
      .from(table)
      .update({ deleted_at: new Date().toISOString() })
      .eq('external_id', itemId)
      .eq('source', 'jobber')
      .is('deleted_at', null)
    if (error) console.error(`[jobber-webhook] soft-delete ${table} ${itemId} failed:`, error.message)
    else console.log(`[jobber-webhook] soft-deleted ${table} ${itemId}`)
    return
  }

  const anchor = occurredAt ? Date.parse(occurredAt) : NaN
  const since = !Number.isNaN(anchor)
    ? new Date(anchor - 10 * 60 * 1000)
    : new Date(Date.now() - 30 * 60 * 1000)

  let userId: string
  try {
    userId = await getJobberUserId(companyId)
  } catch (e) {
    console.error('[jobber-webhook] no Jobber token, cannot process', topic, e)
    return
  }

  try {
    switch (topic) {
      case 'CLIENT_CREATE':
      case 'CLIENT_UPDATE':
        await syncClients(userId, companyId, since); break
      case 'INVOICE_CREATE':
      case 'INVOICE_UPDATE':
        await syncInvoices(userId, companyId, since); break
      case 'JOB_CREATE':
      case 'JOB_UPDATE':
        await syncJobs(userId, companyId, undefined, [itemId]); break
      case 'VISIT_CREATE':
      case 'VISIT_UPDATE':
        await syncVisits(userId, companyId, undefined, [itemId]); break
      case 'VISIT_COMPLETE': {
        await syncVisits(userId, companyId, undefined, [itemId])
        // Session 9 — auto pesticide record on completion. Best-effort, deduped
        // on (company_id, jobber_visit_id); never clobbers a Daily Log V2 record.
        try {
          const outcome = await createPesticideRecordFromJobberVisit({
            admin, companyId, jobberVisitId: itemId, occurredAt,
          })
          console.log(`[jobber-webhook] pesticide ${itemId}: ${outcome}`)
        } catch (e) {
          console.error('[jobber-webhook] pesticide record failed for', itemId, e)
        }
        break
      }
      default:
        console.log(`[jobber-webhook] ignoring topic ${topic}`)
        return
    }
    console.log(`[jobber-webhook] processed ${topic} ${itemId}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[jobber-webhook] ${topic} ${itemId} failed:`, msg)
  }
}

export async function notifyJobberSyncFailure(companyId: string, errorMessage: string): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data: admins } = await admin
      .from('user_profiles')
      .select('id')
      .eq('company_id', companyId)
      .eq('role', 'admin')
    if (!admins?.length) return
    const body =
      `⚠️ Jobber sync failed.\n\n${errorMessage}\n\n` +
      `Check /api/jobber/sync/status or pm2 logs for details. The nightly cron will retry at 2 AM.`
    for (const a of admins) {
      await postGuardianToUserDm(companyId, a.id, body).catch(err =>
        console.error('[jobber-sync] failure DM error for', a.id, err))
    }
  } catch (e) {
    console.error('[jobber-sync] notifyJobberSyncFailure error:', e)
  }
}

// ── Type stubs ────────────────────────────────────────────────────────────────

interface ClientNode {
  id: string; name?: string; firstName?: string; lastName?: string
  companyName?: string; isCompany?: boolean; isLead?: boolean
  emails?: { address: string; primary?: boolean }[]
  phones?: { number: string; primary?: boolean }[]
  balance?: number; isArchived?: boolean; leadSource?: string; jobberWebUri?: string
  customFields?: RawCustomField[]; createdAt?: string; updatedAt?: string
  contacts?: { nodes: ContactNode[] }
  notes?: { nodes: NoteNode[] }
  tags?: { nodes: { label: string }[] }
}

interface ContactNode {
  id: string; firstName?: string; lastName?: string; name?: string
  title?: string; role?: string
  emails?: { nodes: { address: string }[] }; phones?: { nodes: { number: string }[] }
  isBillingContact?: boolean; receivesFollowUps?: boolean
  receivesReminders?: boolean; createdAt?: string
}

interface NoteNode {
  id: string; message?: string; pinned?: boolean; createdAt?: string
}

interface PropertyNode {
  id: string
  name?: string
  isBillingAddress?: boolean
  jobberWebUri?: string
  client?: { id: string }
  address?: { street1?: string; street2?: string; city?: string; province?: string; postalCode?: string }
  customFields?: RawCustomField[]
  createdAt?: string
}

interface JobNode {
  id: string; title?: string; jobNumber?: number; jobStatus?: string; jobType?: string
  billingType?: string; total?: number; invoicedTotal?: number; uninvoicedTotal?: number
  startAt?: string; endAt?: string; completedAt?: string; jobberWebUri?: string
  createdAt?: string; updatedAt?: string
  client?: { id: string }; property?: { id: string }; salesperson?: { id: string }
  customFields?: RawCustomField[]
  lineItems?: { nodes: LineItemNode[] }
}

interface VisitNode {
  id: string; title?: string; startAt?: string; endAt?: string; completedAt?: string
  visitStatus?: string
  createdAt?: string
  job?: { id: string }; client?: { id: string }
  assignedUsers?: { nodes: { id: string }[] }
  lineItems?: { nodes: LineItemNode[] }
}

interface InvoiceNode {
  id: string; invoiceStatus?: string; invoiceNumber?: string
  invoiceNet?: number
  jobberWebUri?: string
  amounts?: {
    subtotal?: number; total?: number; invoiceBalance?: number
    taxAmount?: number; discountAmount?: number; paymentsTotal?: number
    depositAmount?: number; tipsTotal?: number
  }
  issuedDate?: string; dueDate?: string; receivedDate?: string
  subject?: string; createdAt?: string; updatedAt?: string
  client?: { id: string }
  salesperson?: { id: string }
  jobs?: { nodes: { id: string }[] }
  customFields?: RawCustomField[]
  lineItems?: { nodes: LineItemNode[] }
}

interface LineItemNode {
  id: string; name: string; description?: string
  quantity?: number; unitPrice?: number; totalPrice?: number
}

interface ContactUpsert {
  company_id: string; source: string; external_id: string; client_id: string
  is_primary: boolean; first_name?: string | null; last_name?: string | null
  name?: string | null; title?: string | null; role?: string | null
  email?: string | null; phone?: string | null
  is_billing_contact?: boolean; receives_followups?: boolean | null
  receives_reminders?: boolean | null; last_synced_at: string
  external_created_at?: string | null; updated_at: string
}
