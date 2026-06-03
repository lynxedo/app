/**
 * Jobber → Supabase sync library (Session 67)
 *
 * Three public exports:
 *   runInitialJobberSync(companyId)  — full YTD pull, run once
 *   runDeltaJobberSync(companyId)    — delta since last sync, run nightly
 *   processJobberWebhookEvent(...)   — handle a single webhook event (Session 68)
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { jobberGraphQLAdmin } from '@/lib/jobber'

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

// Pace pagination using Jobber's returned query-cost throttle status so the
// leaky bucket (max 10,000, restores ~500/s) recovers before the next
// similarly-priced page. Jobber returns the cost block in `extensions.cost`.
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

/** Find the first admin user for the company who has a Jobber token */
async function getJobberUserId(companyId: string): Promise<string> {
  const admin = createAdminClient()
  // Find users with jobber_tokens for this company
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

interface RawCustomField {
  label: string
  valueText?: string | null
  valueNumeric?: number | null
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

function parseCustomFields(
  rawFields: RawCustomField[],
  jobTitle: string | null
): { raw: Record<string, unknown>; denormalized: DenormalizedFields } {
  const raw: Record<string, unknown> = {}
  const cf: Record<string, string> = {}

  for (const f of rawFields) {
    // Non-matching inline fragment types (CustomFieldDate, CustomFieldArea, etc.)
    // return {} with no fields — f.label will be undefined. Skip those.
    if (!f.label) continue
    const key = f.label.toLowerCase().replace(/:+$/, '').trim()
    const val = (f.valueText ?? (f.valueNumeric != null ? String(f.valueNumeric) : null)) ?? ''
    raw[f.label] = val
    cf[key] = val
  }

  const lawnSizeRaw = cf['lawn size'] ? Number(cf['lawn size']) : null
  // numeric(5,1) max is 9999.9 — cap to avoid overflow on atypically large values
  const lawn_size_k = isFinite(lawnSizeRaw ?? NaN) && Math.abs(lawnSizeRaw!) < 10000 ? lawnSizeRaw : null
  const lawn_size_sqft = lawn_size_k != null ? Math.round(lawn_size_k * 1000) : null

  const routeRaw = (cf['wf route'] ?? '').trim() || parseRouteCodeFromTitle(jobTitle)
  const route_code = routeRaw?.match(/^(RC|BP)\d+$/i) ? routeRaw.toUpperCase() : null
  const route_type = deriveRouteType(route_code)

  const custom_note = cf['note'] || cf['note:'] || cf['note::'] || null

  return {
    raw,
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

/** Deduplicate line_item rows by external_id within a batch page.
 *  Jobber can return the same line item ID on multiple visits in one page,
 *  causing "ON CONFLICT DO UPDATE command cannot affect row a second time". */
function dedupLineItems(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Map<string, Record<string, unknown>>()
  for (const r of rows) seen.set(r.external_id as string, r)
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
          ... on CustomFieldText    { label valueText }
          ... on CustomFieldNumeric { label valueNumeric }
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
      ? { updatedAt: { greaterThan: updatedSince.toISOString() } }
      : undefined

    const resp = await withRateLimit(() =>
      jobberGraphQLAdmin<{ data: { clients: { nodes: unknown[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } }>(
        userId, CLIENTS_QUERY, { cursor, filter }
      )
    )

    const { nodes, pageInfo } = resp.data.clients

    for (const raw of nodes as ClientNode[]) {
      const primaryEmail = raw.emails?.find(e => e.primary)?.address ?? raw.emails?.[0]?.address ?? null
      const primaryPhone = raw.phones?.find(p => p.primary)?.number ?? raw.phones?.[0]?.number ?? null

      // Upsert client
      await admin.from('clients').upsert({
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
        custom_fields: raw.customFields ?? null,
        last_synced_at: new Date().toISOString(),
        external_created_at: raw.createdAt ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'external_id,source' })

      // Upsert contacts
      const { data: clientRow } = await admin
        .from('clients')
        .select('id')
        .eq('external_id', raw.id)
        .eq('source', 'jobber')
        .single()

      if (clientRow) {
        // Primary contact from client fields
        const contacts: ContactUpsert[] = [{
          company_id: companyId,
          source: 'jobber',
          external_id: `${raw.id}_primary`,
          client_id: clientRow.id,
          is_primary: true,
          first_name: raw.firstName ?? null,
          last_name: raw.lastName ?? null,
          name: raw.name ?? null,
          email: primaryEmail,
          phone: primaryPhone,
          last_synced_at: new Date().toISOString(),
          external_created_at: raw.createdAt ?? null,
          updated_at: new Date().toISOString(),
        }]

        // Additional contacts
        for (const c of raw.contacts?.nodes ?? []) {
          contacts.push({
            company_id: companyId,
            source: 'jobber',
            external_id: c.id,
            client_id: clientRow.id,
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
            last_synced_at: new Date().toISOString(),
            external_created_at: c.createdAt ?? null,
            updated_at: new Date().toISOString(),
          })
        }

        if (contacts.length) {
          await admin.from('contacts').upsert(contacts, { onConflict: 'external_id,source' })
        }

        // Sync client notes
        for (const note of raw.notes?.nodes ?? []) {
          await admin.from('client_notes').upsert({
            company_id: companyId,
            source: 'jobber',
            external_id: note.id,
            client_id: clientRow.id,
            body: note.message ?? null,
            author_external_id: null,
            pinned: note.pinned ?? false,
            last_synced_at: new Date().toISOString(),
            external_created_at: note.createdAt ?? null,
          }, { onConflict: 'external_id,source' })
        }

        // Sync tags
        for (const tag of raw.tags?.nodes ?? []) {
          const { data: tagRow } = await admin
            .from('tags')
            .upsert({ company_id: companyId, source: 'jobber', name: tag.label }, {
              onConflict: 'company_id,name' as string,
              ignoreDuplicates: false,
            })
            .select('id')
            .single()

          if (tagRow) {
            await admin.from('client_tags')
              .upsert({ client_id: clientRow.id, tag_id: tagRow.id }, { ignoreDuplicates: true })
          }
        }
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

// Properties have no updatedAt field and the filter type name is
// PropertiesFilterAttributes (plural), not PropertyFilterAttributes. Since
// properties are a small flat table (~1K rows), both initial and delta syncs
// pull all properties and rely on upsert idempotency — no filter needed.
const PROPERTIES_QUERY = `
  query SyncProperties($cursor: String) {
    properties(first: 100, after: $cursor) {
      nodes {
        id
        address { street1 street2 city province postalCode }
        client { id }
        createdAt
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

async function syncProperties(
  userId: string,
  companyId: string,
  _updatedSince?: Date   // Property has no updatedAt — always pull all; upsert is idempotent
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

    const rows = await Promise.all(nodes.map(async (p) => {
      const { data: clientRow } = await admin
        .from('clients')
        .select('id')
        .eq('external_id', p.client?.id ?? '')
        .eq('source', 'jobber')
        .maybeSingle()

      return {
        company_id: companyId,
        source: 'jobber',
        external_id: p.id,
        client_id: clientRow?.id ?? null,
        client_external_id: p.client?.id ?? null,
        address_line1: p.address?.street1 ?? null,
        address_line2: p.address?.street2 ?? null,
        city: p.address?.city ?? null,
        state: p.address?.province ?? null,
        zip: p.address?.postalCode ?? null,
        last_synced_at: new Date().toISOString(),
        external_created_at: p.createdAt ?? null,
        updated_at: new Date().toISOString(),
      }
    }))

    if (rows.length) {
      await admin.from('properties').upsert(rows, { onConflict: 'external_id,source' })
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
          ... on CustomFieldText    { label valueText }
          ... on CustomFieldNumeric { label valueNumeric }
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
  updatedSince?: Date
): Promise<number> {
  const admin = createAdminClient()
  let cursor: string | null = null
  let total = 0

  while (true) {
    // Jobber's JobFilterAttributes has no updatedAt. Use visitsScheduledBetween
    // to capture jobs with activity in the YTD window (covers recurring jobs
    // created in prior years). Delta (Session 68) uses createdAt as a stopgap
    // until a proper change-cursor strategy is designed — TODO(Session 68).
    const filter: Record<string, unknown> = {}
    if (updatedSince) {
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

    for (const job of nodes) {
      const { raw, denormalized } = parseCustomFields(
        (job.customFields ?? []) as RawCustomField[],
        job.title ?? null
      )

      // Derive dept_prefix from line items
      const deptPrefix = (() => {
        for (const li of job.lineItems?.nodes ?? []) {
          const p = parseDeptPrefix(li.name)
          if (p) return p
        }
        return null
      })()

      const { data: clientRow } = await admin
        .from('clients')
        .select('id')
        .eq('external_id', job.client?.id ?? '')
        .eq('source', 'jobber')
        .maybeSingle()

      const { data: propRow } = await admin
        .from('properties')
        .select('id')
        .eq('external_id', job.property?.id ?? '')
        .eq('source', 'jobber')
        .maybeSingle()

      await admin.from('jobs').upsert({
        company_id: companyId,
        source: 'jobber',
        external_id: job.id,
        client_id: clientRow?.id ?? null,
        client_external_id: job.client?.id ?? null,
        property_id: propRow?.id ?? null,
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
        custom_fields: raw,
        jobber_web_uri: job.jobberWebUri ?? null,
        last_synced_at: new Date().toISOString(),
        external_created_at: job.createdAt ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'external_id,source' })

      // Sync job line items
      const { data: jobRow } = await admin
        .from('jobs')
        .select('id')
        .eq('external_id', job.id)
        .eq('source', 'jobber')
        .single()

      if (jobRow) {
        const lineItemRows = (job.lineItems?.nodes ?? []).map(li => ({
          company_id: companyId,
          source: 'jobber',
          external_id: li.id,
          parent_type: 'job',
          parent_id: jobRow.id,
          parent_external_id: job.id,
          name: li.name,
          description: li.description ?? null,
          dept_prefix: parseDeptPrefix(li.name),
          is_recurring_program: false,
          is_auxiliary: false,
          quantity: li.quantity ?? null,
          unit_price: li.unitPrice ?? null,
          total: li.totalPrice ?? null,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }))

        if (lineItemRows.length) {
          await admin.from('line_items').upsert(dedupLineItems(lineItemRows), { onConflict: 'external_id,source' })
        }

        // Job notes are a JobNoteUnionConnection in Jobber's schema (selections
        // can't be made directly on the union). Deferred — handle with inline
        // fragments in a later session. TODO(Session 68): job_notes.
      }
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
  updatedSince?: Date
): Promise<number> {
  const admin = createAdminClient()
  let cursor: string | null = null
  let total = 0

  while (true) {
    // Jobber's VisitFilterAttributes has no updatedAt; filter on the visit's
    // scheduled start (startAt range, proven shape from app/api/visits).
    // Delta (Session 68) re-pulls the recent window — TODO(Session 68).
    const filter: Record<string, unknown> = {}
    if (updatedSince) {
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

    for (const v of nodes) {
      const { data: jobRow } = await admin
        .from('jobs').select('id').eq('external_id', v.job?.id ?? '').eq('source', 'jobber').maybeSingle()
      const { data: clientRow } = await admin
        .from('clients').select('id').eq('external_id', v.client?.id ?? '').eq('source', 'jobber').maybeSingle()

      await admin.from('visits').upsert({
        company_id: companyId,
        source: 'jobber',
        external_id: v.id,
        job_id: jobRow?.id ?? null,
        job_external_id: v.job?.id ?? null,
        client_id: clientRow?.id ?? null,
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
        last_synced_at: new Date().toISOString(),
        external_created_at: v.createdAt ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'external_id,source' })

      // Sync visit line items
      const { data: visitRow } = await admin
        .from('visits').select('id').eq('external_id', v.id).eq('source', 'jobber').single()

      if (visitRow) {
        const lineItemRows = (v.lineItems?.nodes ?? []).map(li => ({
          company_id: companyId,
          source: 'jobber',
          external_id: li.id,
          parent_type: 'visit',
          parent_id: visitRow.id,
          parent_external_id: v.id,
          name: li.name,
          description: li.description ?? null,
          dept_prefix: parseDeptPrefix(li.name),
          is_recurring_program: false,
          is_auxiliary: false,
          quantity: li.quantity ?? null,
          unit_price: li.unitPrice ?? null,
          total: li.totalPrice ?? null,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }))

        if (lineItemRows.length) {
          await admin.from('line_items').upsert(dedupLineItems(lineItemRows), { onConflict: 'external_id,source' })
        }
      }
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
        amounts { subtotal total invoiceBalance }
        issuedDate
        dueDate
        receivedDate
        subject
        createdAt
        updatedAt
        client { id }
        jobs(first: 1) { nodes { id } }
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

    for (const inv of nodes) {
      const jobExternalId = inv.jobs?.nodes?.[0]?.id ?? null
      const { data: clientRow } = await admin
        .from('clients').select('id').eq('external_id', inv.client?.id ?? '').eq('source', 'jobber').maybeSingle()
      const { data: jobRow } = await admin
        .from('jobs').select('id').eq('external_id', jobExternalId ?? '').eq('source', 'jobber').maybeSingle()

      await admin.from('invoices').upsert({
        company_id: companyId,
        source: 'jobber',
        external_id: inv.id,
        client_id: clientRow?.id ?? null,
        client_external_id: inv.client?.id ?? null,
        job_id: jobRow?.id ?? null,
        job_external_id: jobExternalId,
        invoice_number: inv.invoiceNumber ?? null,
        subject: inv.subject ?? null,
        subtotal: inv.amounts?.subtotal ?? null,
        total: inv.amounts?.total ?? null,
        outstanding_balance: inv.amounts?.invoiceBalance ?? null,
        invoice_status: inv.invoiceStatus ?? null,
        issued_date: inv.issuedDate ?? null,
        due_date: inv.dueDate ?? null,
        paid_at: inv.receivedDate ?? null,
        last_synced_at: new Date().toISOString(),
        external_created_at: inv.createdAt ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'external_id,source' })

      // Sync invoice line items
      const { data: invRow } = await admin
        .from('invoices').select('id').eq('external_id', inv.id).eq('source', 'jobber').single()

      if (invRow) {
        const lineItemRows = (inv.lineItems?.nodes ?? []).map(li => ({
          company_id: companyId,
          source: 'jobber',
          external_id: li.id,
          parent_type: 'invoice',
          parent_id: invRow.id,
          parent_external_id: inv.id,
          name: li.name,
          description: li.description ?? null,
          dept_prefix: parseDeptPrefix(li.name),
          is_recurring_program: false,
          is_auxiliary: false,
          quantity: li.quantity ?? null,
          unit_price: li.unitPrice ?? null,
          total: li.totalPrice ?? null,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }))

        if (lineItemRows.length) {
          await admin.from('line_items').upsert(dedupLineItems(lineItemRows), { onConflict: 'external_id,source' })
        }
      }
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
  }

  return summary
}

export async function runDeltaJobberSync(companyId: string): Promise<SyncSummary> {
  const admin = createAdminClient()
  const logId = await startSyncLog(companyId, 'daily_delta', null)
  const summary: SyncSummary = { clients: 0, properties: 0, jobs: 0, visits: 0, invoices: 0, errors: [] }

  try {
    // Find the last successful sync
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
      : new Date(Date.now() - 25 * 60 * 60 * 1000) // 25h fallback

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
  }

  return summary
}

export async function processJobberWebhookEvent(
  event: { topic: string; itemId: string; companyId: string }
): Promise<void> {
  // Implemented in Session 68
  console.log('[jobber-sync] Webhook event received (Session 68 not yet built):', event.topic, event.itemId)
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
  id: string; client?: { id: string }
  address?: { street1?: string; street2?: string; city?: string; province?: string; postalCode?: string }
  createdAt?: string; updatedAt?: string
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
  amounts?: { subtotal?: number; total?: number; invoiceBalance?: number }
  issuedDate?: string; dueDate?: string; receivedDate?: string
  subject?: string; createdAt?: string; updatedAt?: string
  client?: { id: string }; jobs?: { nodes: { id: string }[] }
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
