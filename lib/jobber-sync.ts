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
import { writeCustomerLinkForClient } from '@/lib/jobber-customer-link'
import { writeReportLinksForJob } from '@/lib/jobber-report-links'
import { jobberGraphQLAdmin, resolveJobberUserId } from '@/lib/jobber'
import { postGuardianToUserDm } from '@/lib/guardian-post'
import { createPesticideRecordFromJobberVisit } from '@/lib/pesticide'
import { syncClientsToDirectory, type DirectoryClientInput } from '@/lib/contacts-directory'

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Multi-tenant Track 3 — resolve a Lynxedo company from a Jobber accountId.
 *
 * Maps the `accountId` Jobber puts on each webhook (and the id captured at OAuth)
 * to a company via jobber_tokens.account_id → company_id. Returns null if the
 * account isn't mapped yet (unknown/unmapped tenant, or Heroes before backfill),
 * so callers can decide the fallback. Uses the admin (service-role) client
 * because webhooks have no authenticated user session.
 *
 * ⚠ The webhook's accountId may be base64-encoded; this compares whatever is
 * stored in account_id verbatim. The orchestrator must confirm the stored
 * format (from the OAuth `{ account { id } }` query) matches the webhook's
 * `evt.accountId` before this lookup can succeed — see the migration
 * supabase/2026-07-19_jobber_account_mapping.sql.
 */
export async function resolveCompanyByJobberAccountId(
  accountId: string
): Promise<string | null> {
  if (!accountId) return null
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('jobber_tokens')
    .select('company_id')
    .eq('account_id', accountId)
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return (data.company_id as string) ?? null
}

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

/**
 * Delegates to the shared resolver in lib/jobber.ts. This used to be its own
 * careful implementation while `companyJobberUserId` was a careless one — the
 * divergence is what let a dead token reach seven other code paths, so there is
 * now exactly one implementation and both callers share it.
 *
 * Two behavior notes vs the previous version here:
 *  - Non-admins are now eligible, but only AFTER every admin token has been
 *    tried and failed. In the normal case the admin's token is still chosen, so
 *    nothing changes; when it dies, a manager who connected Jobber keeps sync
 *    alive instead of being skipped for their role.
 *  - Sync still throws rather than returning null, because every caller here
 *    treats a missing token as fatal for the run.
 */
async function getJobberUserId(companyId: string): Promise<string> {
  const userId = await resolveJobberUserId(companyId)
  if (!userId) throw new Error('No usable Jobber token — an admin must reconnect Jobber')
  return userId
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

// Each entity query fetches lineItems(first: 25) per parent. A parent that
// returns exactly this many might have more we never saw, so the reconcile
// below skips it rather than risk tombstoning a line we simply didn't fetch.
const LINE_ITEM_PAGE_CAP = 25

/**
 * Soft-delete the line items Jobber no longer returns for a set of just-synced
 * parents ("orphans"). The line-item upserts above only INSERT/UPDATE whatever
 * Jobber currently returns and never remove anything — so a line item deleted in
 * Jobber (or replaced when a tech edits it, since Jobber assigns the edited line
 * a brand-new id) otherwise lingers forever and is still counted by the revenue
 * scoreboards, which SUM line_items.total WHERE deleted_at IS NULL.
 *
 * Mechanism: every line Jobber just returned got last_synced_at = nowIso from the
 * upsert. Any live row for these SAME parents still carrying an OLDER
 * last_synced_at wasn't in Jobber's response this run, so tombstone it. This is
 * why a stale timestamp alone can never delete a legit line: the row's parent
 * must have been re-fetched THIS run (present in parentExternalIds) and Jobber
 * must have omitted it. Scoped to source='jobber' + this parent_type + the exact
 * parents we fetched, so it can never touch another parent's or another tool's
 * rows. (Today the Jobber sync is the only writer of line_items, all source
 * 'jobber' — if that ever changes, revisit this scope.)
 */
async function reconcileDeletedLineItems(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  parentType: 'job' | 'visit' | 'invoice',
  parentExternalIds: string[],
  nowIso: string
): Promise<void> {
  if (!parentExternalIds.length) return
  const { data, error } = await admin
    .from('line_items')
    .update({ deleted_at: nowIso })
    .eq('company_id', companyId)
    .eq('source', 'jobber')
    .eq('parent_type', parentType)
    .in('parent_external_id', parentExternalIds)
    .is('deleted_at', null)
    .lt('last_synced_at', nowIso)
    .select('id')
  if (error) {
    // Non-fatal: the upsert already succeeded; a reconcile failure must not abort
    // the sync. Orphans simply self-heal on the next run of this parent.
    console.error(`[jobber-sync] ${parentType} line-item reconcile failed:`, error.message)
    return
  }
  if (data?.length) {
    console.log(`[jobber-sync] reconcile: soft-deleted ${data.length} orphaned ${parentType} line item(s)`)
  }
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

/**
 * Options shared by the five entity pulls, so a full backfill can be sized,
 * paused and resumed instead of having to complete inside one request.
 *
 * `startDate` replaces what used to be a hardcoded 'after: 2026-01-01' literal in
 * three of these functions — a per-company history floor, so a new subscriber can
 * bring in as much or as little history as they actually have.
 */
/**
 * The history floor for a full pull. Defaults to 2026-01-01 — the value that used
 * to be hardcoded in three places — so Heroes' behavior is byte-identical until a
 * company sets its own `sync_start_date`.
 */
function fullPullFloor(opts?: PullOpts): string {
  const d = opts?.startDate
  if (!d) return '2026-01-01T00:00:00Z'
  // Accept a bare date ('2019-04-01') or a full timestamp.
  return d.includes('T') ? d : `${d}T00:00:00Z`
}

export type PullOpts = {
  /** History floor for a FULL pull. Ignored when `updatedSince` is set (a delta). */
  startDate?: string
  /** Resume from this cursor rather than the first page. */
  startCursor?: string | null
  /**
   * Called after each page is written. Return false to stop early — the caller has
   * run out of time budget and will resume from the cursor it was just handed.
   * The cursor is persisted BEFORE we decide to continue, so a crash costs one
   * page rather than the whole run.
   */
  onPage?: (cursor: string | null, added: number, hasMore: boolean) => Promise<boolean>
}

async function syncClients(
  userId: string,
  companyId: string,
  updatedSince?: Date,
  opts?: PullOpts
): Promise<number> {
  const admin = createAdminClient()
  let cursor: string | null = opts?.startCursor ?? null
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

    // 4) Feed the unified Contacts directory (txt_contacts) from this page of
    //    clients + their tags. Best-effort: a directory hiccup must never fail
    //    the core Jobber sync. (See lib/contacts-directory.ts for the consent
    //    guard + tag mirroring.)
    try {
      const labelsByExternal = new Map<string, string[]>()
      for (const p of tagPairs) {
        const arr = labelsByExternal.get(p.clientExternalId) ?? []
        arr.push(p.label)
        labelsByExternal.set(p.clientExternalId, arr)
      }
      const dirItems: DirectoryClientInput[] = prepared.map(p => ({
        external_id: p.raw.id,
        name: p.row.name,
        first_name: p.row.first_name,
        last_name: p.row.last_name,
        company_name: p.row.company_name,
        is_company: p.row.is_company,
        email: p.primaryEmail,
        phone: p.primaryPhone,
        tagLabels: labelsByExternal.get(p.raw.id) ?? [],
      }))
      const res = await syncClientsToDirectory(admin, companyId, dirItems)
      console.log(`[jobber-sync] directory: +${res.inserted} new, ${res.enriched} enriched`)
    } catch (e) {
      console.error('[jobber-sync] directory feed failed (non-fatal)', e)
    }

    total += nodes.length
    console.log(`[jobber-sync] clients: synced ${total} so far`)

    // Report progress and let a resumable backfill stop here. The cursor is
    // handed over BEFORE we decide whether to continue, so an interrupted run
    // resumes from this page rather than from the beginning.
    if (opts?.onPage) {
      const keepGoing = await opts.onPage(
        pageInfo.hasNextPage ? pageInfo.endCursor : null,
        nodes.length,
        pageInfo.hasNextPage,
      )
      if (!keepGoing) break
    }

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
  _updatedSince?: Date,
  opts?: PullOpts
): Promise<number> {
  const admin = createAdminClient()
  let cursor: string | null = opts?.startCursor ?? null
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

    // Report progress and let a resumable backfill stop here. The cursor is
    // handed over BEFORE we decide whether to continue, so an interrupted run
    // resumes from this page rather than from the beginning.
    if (opts?.onPage) {
      const keepGoing = await opts.onPage(
        pageInfo.hasNextPage ? pageInfo.endCursor : null,
        nodes.length,
        pageInfo.hasNextPage,
      )
      if (!keepGoing) break
    }

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
  ids?: string[],
  opts?: PullOpts
): Promise<number> {
  const admin = createAdminClient()
  let cursor: string | null = opts?.startCursor ?? null
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
        after: fullPullFloor(opts),
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

    // Reconcile deletions: tombstone any job line items Jobber no longer returns.
    await reconcileDeletedLineItems(
      admin, companyId, 'job',
      nodes.filter(job => jobIdByExternal.has(job.id) &&
        (job.lineItems?.nodes?.length ?? 0) < LINE_ITEM_PAGE_CAP).map(job => job.id),
      nowIso
    )

    total += nodes.length
    console.log(`[jobber-sync] jobs: synced ${total} so far`)

    // Report progress and let a resumable backfill stop here. The cursor is
    // handed over BEFORE we decide whether to continue, so an interrupted run
    // resumes from this page rather than from the beginning.
    if (opts?.onPage) {
      const keepGoing = await opts.onPage(
        pageInfo.hasNextPage ? pageInfo.endCursor : null,
        nodes.length,
        pageInfo.hasNextPage,
      )
      if (!keepGoing) break
    }

    if (!pageInfo.hasNextPage) break
    cursor = pageInfo.endCursor
    await throttleSleep(resp)
  }

  return total
}

// ── Visits ────────────────────────────────────────────────────────────────────

// How far back the nightly delta re-pulls visits by startAt. Jobber's visit
// filter has no `updatedAt`, so a visit completed (or whose line items were
// edited) days after it started won't be caught by a "since last sync" window —
// and a completion done via the job (archive/edit) fires JOB_UPDATE, not a visit
// event. Re-pulling a trailing window every night self-heals both within a day.
// 45 days comfortably covers multi-day installs and post-visit invoice edits.
const VISIT_BACKFILL_DAYS = 45

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
  ids?: string[],
  opts?: PullOpts
): Promise<number> {
  const admin = createAdminClient()
  let cursor: string | null = opts?.startCursor ?? null
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
        after: fullPullFloor(opts),
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

    // Reconcile deletions: tombstone any visit line items Jobber no longer
    // returns. This is what corrects the revenue scoreboards — they SUM visit
    // line items, so a stale line inflated (or a negative one deflated) a visit.
    await reconcileDeletedLineItems(
      admin, companyId, 'visit',
      nodes.filter(v => visitIdByExternal.has(v.id) &&
        (v.lineItems?.nodes?.length ?? 0) < LINE_ITEM_PAGE_CAP).map(v => v.id),
      nowIso
    )

    total += nodes.length
    console.log(`[jobber-sync] visits: synced ${total} so far`)

    // Report progress and let a resumable backfill stop here. The cursor is
    // handed over BEFORE we decide whether to continue, so an interrupted run
    // resumes from this page rather than from the beginning.
    if (opts?.onPage) {
      const keepGoing = await opts.onPage(
        pageInfo.hasNextPage ? pageInfo.endCursor : null,
        nodes.length,
        pageInfo.hasNextPage,
      )
      if (!keepGoing) break
    }

    if (!pageInfo.hasNextPage) break
    cursor = pageInfo.endCursor
    await throttleSleep(resp)
  }

  return total
}

// ── Invoices ──────────────────────────────────────────────────────────────────

/* Team members. Unlike every other entity here there is no date filter and no
 * meaningful pagination pressure — an account has tens of users, not thousands —
 * so this pulls the whole list on every run. That is deliberate: the table it
 * feeds had NO sync at all before (see syncUsers), and "refresh everything" is
 * both cheap and impossible to leave stale. */
const USERS_QUERY = `
  query SyncUsers($cursor: String) {
    users(first: 50, after: $cursor) {
      nodes {
        id
        name { first last }
        email { raw }
        status
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

type UserNode = {
  id: string
  name?: { first?: string | null; last?: string | null } | null
  email?: { raw?: string | null } | null
  status?: string | null
}

/**
 * Whether a Jobber user status counts as active.
 *
 * ⚠ Written to FAIL ACTIVE. `UserStatusEnum`'s values aren't exposed by
 * introspection, so rather than guess a single winning value ('ACTIVE' vs
 * 'ACTIVATED') and silently deactivate the whole team on a mismatch, this only
 * treats explicitly deactivation-shaped statuses as inactive. Worst case a
 * departed user lingers as active — cosmetic, and visible — instead of every
 * technician vanishing from the boards at once.
 */
function jobberUserIsActive(status: string | null | undefined): boolean {
  if (!status) return true
  return !/DEACTIV|DISABL|ARCHIV|SUSPEND|INACTIVE|REMOVED/i.test(status)
}

/**
 * Mirror the account's team members into `jobber_users`.
 *
 * ⚠⚠ This table previously had NO sync whatsoever. It was written once (Heroes:
 * 2026-06-04) and never again — a full-repo grep found it referenced only in
 * schema and RLS files. Because `scoreboard_board_technicians` name-matches
 * `employees` against it, EVERY Jobber user created after that date was invisible
 * to every technician board and to the Crew & Labor report. It surfaced when a
 * technician hired in July showed 183.7 clocked hours with no attributable work;
 * he was in Jobber all along, just not in the mirror.
 *
 * Runs on both the initial pull and the nightly delta, ignoring `updatedSince`:
 * the list is tiny, and a stale roster is exactly the failure being fixed.
 */
async function syncUsers(userId: string, companyId: string): Promise<number> {
  const admin = createAdminClient()
  let cursor: string | null = null
  let total = 0
  const seen = new Set<string>()

  while (true) {
    const resp = await withRateLimit(() =>
      jobberGraphQLAdmin<{ data: { users: { nodes: UserNode[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } }>(
        userId, USERS_QUERY, { cursor }
      )
    )

    const { nodes, pageInfo } = resp.data.users
    const nowIso = new Date().toISOString()

    const rows = nodes.map(u => {
      const full = `${u.name?.first ?? ''} ${u.name?.last ?? ''}`.trim()
      seen.add(u.id)
      return {
        company_id: companyId,
        source: 'jobber',
        external_id: u.id,
        // `name` is NOT NULL, and the name match downstream keys off it, so a
        // nameless user gets a visible placeholder rather than breaking the insert.
        name: full || '(unnamed user)',
        email: u.email?.raw ?? null,
        is_active: jobberUserIsActive(u.status),
        last_synced_at: nowIso,
        updated_at: nowIso,
      }
    })

    if (rows.length) {
      const { error } = await admin
        .from('jobber_users')
        .upsert(rows, { onConflict: 'external_id,company_id' })
      if (error) throw new Error(`syncUsers upsert: ${error.message}`)
      total += rows.length
    }

    if (!pageInfo.hasNextPage) break
    cursor = pageInfo.endCursor
    await throttleSleep(resp)
  }

  /* Deactivate anyone Jobber no longer returns — but ONLY after every page came
   * back, so a mid-run failure can't wipe the roster. Deactivation rather than
   * deletion: visits still reference these ids, and the name match uses is_active
   * only as an ordering tiebreak, so a stale row demotes rather than disappears. */
  if (seen.size > 0) {
    const { error } = await admin
      .from('jobber_users')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('company_id', companyId)
      .eq('is_active', true)
      .not('external_id', 'in', `(${[...seen].map(id => `"${id}"`).join(',')})`)
    if (error) console.error('[jobber-sync] user deactivate sweep failed:', error.message)
  }

  return total
}

/**
 * syncUsers, but unable to take the pipeline down with it.
 *
 * ⚠ The roster runs FIRST in both pulls, so an unguarded throw here would abort
 * clients, jobs, visits and invoices — trading a stale team list for a total sync
 * outage. It is by far the least critical entity: a missing user costs attribution
 * on a report, a missing invoice costs money. So a failure is recorded and the run
 * continues.
 */
async function syncUsersSafe(userId: string, companyId: string, summary: SyncSummary): Promise<void> {
  try {
    summary.users = await syncUsers(userId, companyId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[jobber-sync] user sync failed (continuing):', msg)
    summary.errors.push(`users: ${msg}`)
  }
}

/**
 * The invoice shape, in one place. Both the paged pull and reconcileOpenInvoices()
 * select through this — if they diverged, the same invoice would mean different
 * things depending on which path last touched it.
 */
const INVOICE_FIELDS_FRAGMENT = `
  fragment InvoiceFields on Invoice {
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
`

const INVOICES_QUERY = `
  query SyncInvoices($cursor: String, $filter: InvoiceFilterAttributes) {
    invoices(first: 40, after: $cursor, filter: $filter) {
      nodes { ...InvoiceFields }
      pageInfo { hasNextPage endCursor }
    }
  }
  ${INVOICE_FIELDS_FRAGMENT}
`

/**
 * One invoice node -> one mirror row. Shared by the paged pull and the open-balance
 * reconcile below so a dollar written by either path means exactly the same thing.
 */
function mapInvoiceRow(
  inv: InvoiceNode,
  companyId: string,
  invClientIds: Map<string, string>,
  invJobIds: Map<string, string>,
  nowIso: string,
) {
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
}

/** How many invoices we re-read per GraphQL round trip in the reconcile below. */
const OPEN_INVOICE_BATCH = 20
/** Refuse to run if the believed-open set is implausibly large (see below). */
const OPEN_INVOICE_CEILING = 500

/**
 * Re-read every invoice we still believe is UNPAID, ignoring `updatedAt`.
 *
 * ⚠⚠ THIS EXISTS BECAUSE A JOBBER PAYMENT DOES NOT BUMP `invoice.updatedAt`.
 * The delta pull filters on `updatedAt: { after: … }`, so the moment an invoice is
 * paid it stops matching that filter and the mirror keeps its last-known balance
 * FOREVER. Measured on the live book 2026-08-11: 23 of the 36 invoices showing any
 * balance had not been re-read in 14+ days, carrying $13,146.49 of receivable that
 * was already collected — reported AR read $11,441.56 past due where Jobber's own
 * books said $2,399.80, a ~4x overstatement. One $3,600 row had been paid since June.
 *
 * Keyed off `invoice(id:)` rather than inferring: an invoice that drops out of
 * Jobber's unpaid list could equally have been paid, voided or written off as bad
 * debt, and guessing "paid" would write a collection that never happened. We ask
 * for the row and take what Jobber says.
 *
 * Self-limiting by construction: the query only asks about invoices we think are
 * open, and every settled one it finds leaves the set on the next run.
 */
async function reconcileOpenInvoices(userId: string, companyId: string): Promise<number> {
  const admin = createAdminClient()

  // Believed-open = anything carrying a balance, or parked in a pre-payment status.
  // Both halves matter: the stale rows split between "awaiting_payment with a live
  // balance" and "status says paid but the amounts never zeroed".
  const { data: openRows, error: readErr } = await admin
    .from('invoices')
    .select('external_id')
    .eq('company_id', companyId)
    .eq('source', 'jobber')
    .is('deleted_at', null)
    .or('outstanding_balance.gt.0,invoice_status.in.(draft,awaiting_payment,past_due)')
    .limit(OPEN_INVOICE_CEILING + 1)
  if (readErr) throw new Error(`open invoice read: ${readErr.message}`)

  const ids = (openRows ?? []).map(r => r.external_id).filter(Boolean) as string[]
  if (!ids.length) return 0

  // A set this large means something upstream is wrong (a failed backfill, a fresh
  // tenant mid-import). Re-reading thousands of invoices every delta run would spend
  // the Jobber budget the rest of the sync needs, so bail loudly instead.
  if (ids.length > OPEN_INVOICE_CEILING) {
    console.warn(
      `[jobber-sync] invoice reconcile skipped: ${ids.length} open invoices exceeds ceiling ${OPEN_INVOICE_CEILING}`
    )
    return 0
  }

  let refreshed = 0
  let tombstoned = 0

  for (let i = 0; i < ids.length; i += OPEN_INVOICE_BATCH) {
    const batch = ids.slice(i, i + OPEN_INVOICE_BATCH)

    // Aliased single-invoice lookups. Ids travel as GraphQL VARIABLES, never
    // interpolated into the document.
    const varDecls = batch.map((_, n) => `$id${n}: EncodedId!`).join(', ')
    const selections = batch
      .map((_, n) => `i${n}: invoice(id: $id${n}) { ...InvoiceFields }`)
      .join('\n      ')
    const query = `
      query ReconcileOpenInvoices(${varDecls}) {
        ${selections}
      }
      ${INVOICE_FIELDS_FRAGMENT}
    `
    const vars: Record<string, string> = {}
    batch.forEach((id, n) => { vars[`id${n}`] = id })

    const resp = await withRateLimit(() =>
      jobberGraphQLAdmin<{ data: Record<string, InvoiceNode | null> }>(userId, query, vars)
    )

    // ⚠ jobberGraphQLAdmin returns the FULL body — the payload is under .data.
    const nodes = Object.values(resp.data ?? {}).filter((n): n is InvoiceNode => !!n?.id)

    // A batch where NOTHING came back is treated as suspicious, not as twenty
    // deletions: that is what a bad token or a changed query shape looks like, and
    // it is the one case where tombstoning would destroy real receivables.
    if (!nodes.length) {
      console.warn(`[jobber-sync] invoice reconcile: whole batch of ${batch.length} returned nothing — skipped, not tombstoned`)
      continue
    }

    const nowIso = new Date().toISOString()
    const [invClientIds, invJobIds] = await Promise.all([
      fetchIdMap(admin, 'clients', nodes.map(inv => inv.client?.id)),
      fetchIdMap(admin, 'jobs', nodes.map(inv => inv.jobs?.nodes?.[0]?.id)),
    ])

    const rows = nodes.map(inv => mapInvoiceRow(inv, companyId, invClientIds, invJobIds, nowIso))
    const { error } = await admin
      .from('invoices')
      .upsert(rows, { onConflict: 'external_id,source' })
    if (error) throw new Error(`invoice reconcile upsert: ${error.message}`)

    refreshed += rows.length

    // An id Jobber will not return, in a batch that otherwise answered, no longer
    // exists there — it was deleted. Left in place it is pure phantom receivable:
    // 7 such rows carried $9,154.59, including all three "drafts" against Jobber's
    // zero. Tombstoned rather than deleted, so `deleted_at = null` restores it.
    const returned = new Set(nodes.map(n => n.id))
    const gone = batch.filter(id => !returned.has(id))
    if (gone.length) {
      const { error: delErr } = await admin
        .from('invoices')
        .update({ deleted_at: new Date().toISOString(), updated_at: nowIso })
        .eq('company_id', companyId)
        .eq('source', 'jobber')
        .in('external_id', gone)
      if (delErr) throw new Error(`invoice tombstone: ${delErr.message}`)
      tombstoned += gone.length
      console.warn(`[jobber-sync] invoice reconcile: tombstoned ${gone.length} invoice(s) Jobber no longer has`)
    }
  }

  console.log(`[jobber-sync] invoice reconcile: re-read ${refreshed} open invoice(s), tombstoned ${tombstoned}`)
  return refreshed
}

/** How many job ids we hand Jobber's `filter.ids` per round trip. */
const OPEN_JOB_BATCH = 40
/** Refuse to run if the live book is implausibly large (see reconcileOpenInvoices). */
const OPEN_JOB_CEILING = 5000

/**
 * Re-read every job that is not archived, ignoring `createdAt`.
 *
 * ⚠⚠ THE DELTA PULL CANNOT SEE A JOB STATUS CHANGE AT ALL. JobFilterAttributes has
 * no `updatedAt` field, so syncJobs' delta filters on `createdAt` — it only ever
 * picks up NEWLY CREATED jobs. The standing comment there says edits are "caught in
 * real time by the Jobber webhook, so nothing is missed"; that assumption is what
 * failed. Invoicing a job flips its status as a SIDE EFFECT of the invoice, and
 * Jobber fires INVOICE_CREATE for that, not JOB_UPDATE — and the invoice branch of
 * the webhook dispatch never touched the job. So an invoiced job kept
 * `requires_invoicing` forever.
 *
 * Measured on the live book 2026-08-11: the mirror held 100 jobs in
 * requires_invoicing worth $24,562.45; Jobber's own Jobs screen showed exactly ONE,
 * for $459.90. Ben caught it by opening Jobber and counting.
 *
 * Re-reading by id rather than by status is the point: a status we no longer believe
 * is precisely the thing we cannot filter on. Non-archived is the live book (~600
 * rows, ~16 requests), and a job archived in Jobber flips on its next read, so the
 * set drains itself.
 */
async function reconcileOpenJobs(userId: string, companyId: string): Promise<number> {
  const admin = createAdminClient()

  const { data: openRows, error: readErr } = await admin
    .from('jobs')
    .select('external_id')
    .eq('company_id', companyId)
    .eq('source', 'jobber')
    .is('deleted_at', null)
    .not('job_status', 'eq', 'archived')
    .limit(OPEN_JOB_CEILING + 1)
  if (readErr) throw new Error(`open job read: ${readErr.message}`)

  const ids = (openRows ?? []).map(r => r.external_id).filter(Boolean) as string[]
  if (!ids.length) return 0

  if (ids.length > OPEN_JOB_CEILING) {
    console.warn(
      `[jobber-sync] job reconcile skipped: ${ids.length} live jobs exceeds ceiling ${OPEN_JOB_CEILING}`
    )
    return 0
  }

  let refreshed = 0
  for (let i = 0; i < ids.length; i += OPEN_JOB_BATCH) {
    // syncJobs already supports `filter.ids` and owns the row mapping, line items
    // and pacing — this only decides WHICH jobs get re-read.
    refreshed += await syncJobs(userId, companyId, undefined, ids.slice(i, i + OPEN_JOB_BATCH))
  }

  console.log(`[jobber-sync] job reconcile: re-read ${refreshed} live job(s)`)
  return refreshed
}

/**
 * Repair pass: re-read what we believe is still open, for a company.
 *
 * ⚠ DELIBERATELY NOT WIRED INTO THE NIGHTLY DELTA. Webhooks are the mechanism —
 * measured 2026-08-11, every one of the 63 invoices that received a webhook since
 * the durable queue went live was refreshed correctly, and 34 of the 36 phantom
 * balances predate that queue. This is a repair tool for backlog and for whatever
 * a dropped event leaves behind, not a scheduled crutch. Run it after an initial
 * backfill, or when a figure is doubted.
 */
export async function reconcileJobberOpenRecords(
  companyId: string,
): Promise<{ invoices: number; jobs: number; errors: string[] }> {
  const userId = await resolveJobberUserId(companyId)
  if (!userId) return { invoices: 0, jobs: 0, errors: ['no Jobber connection for this company'] }

  const errors: string[] = []
  let invoices = 0
  let jobs = 0

  // Independent halves — one failing should not cost the other's repair.
  try {
    invoices = await reconcileOpenInvoices(userId, companyId)
  } catch (e) {
    errors.push(`invoices: ${e instanceof Error ? e.message : String(e)}`)
  }
  try {
    jobs = await reconcileOpenJobs(userId, companyId)
  } catch (e) {
    errors.push(`jobs: ${e instanceof Error ? e.message : String(e)}`)
  }

  return { invoices, jobs, errors }
}

async function syncInvoices(
  userId: string,
  companyId: string,
  updatedSince?: Date,
  opts?: PullOpts
): Promise<number> {
  const admin = createAdminClient()
  let cursor: string | null = opts?.startCursor ?? null
  let total = 0

  while (true) {
    const filter: Record<string, unknown> = {}
    if (updatedSince) {
      filter.updatedAt = { after: updatedSince.toISOString() }
    } else {
      filter.issuedDate = { after: fullPullFloor(opts) }
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

    const invoiceRows = nodes.map(inv =>
      mapInvoiceRow(inv, companyId, invClientIds, invJobIds, nowIso)
    )

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

    // Reconcile deletions: tombstone any invoice line items Jobber no longer returns.
    await reconcileDeletedLineItems(
      admin, companyId, 'invoice',
      nodes.filter(inv => invoiceIdByExternal.has(inv.id) &&
        (inv.lineItems?.nodes?.length ?? 0) < LINE_ITEM_PAGE_CAP).map(inv => inv.id),
      nowIso
    )

    total += nodes.length
    console.log(`[jobber-sync] invoices: synced ${total} so far`)

    // Report progress and let a resumable backfill stop here. The cursor is
    // handed over BEFORE we decide whether to continue, so an interrupted run
    // resumes from this page rather than from the beginning.
    if (opts?.onPage) {
      const keepGoing = await opts.onPage(
        pageInfo.hasNextPage ? pageInfo.endCursor : null,
        nodes.length,
        pageInfo.hasNextPage,
      )
      if (!keepGoing) break
    }

    if (!pageInfo.hasNextPage) break
    cursor = pageInfo.endCursor
    await throttleSleep(resp)
  }

  return total
}

// ── Public API ────────────────────────────────────────────────────────────────

/** The entity pulls a full backfill walks through, in dependency order.
 *  Users come first: nothing depends on them, they're a single cheap page, and a
 *  new tenant wants its roster present before visits start referencing tech ids. */
export const PULL_ENTITIES = ['users', 'clients', 'properties', 'jobs', 'visits', 'invoices'] as const
export type PullEntity = (typeof PULL_ENTITIES)[number]

/**
 * How far back a company's full pull should reach.
 *
 * Was a hardcoded 'after: 2026-01-01' in three separate filters, which meant a new
 * subscriber could never bring in history older than 2026 and the window silently
 * widened every January. Now per-company, stored where every other integration
 * setting lives (`company_integrations.config`, provider 'jobber').
 *
 * Defaults to 2026-01-01 so Heroes and any company that hasn't set one behave
 * exactly as before.
 */
export async function getJobberSyncStartDate(companyId: string): Promise<string> {
  try {
    const { data } = await createAdminClient()
      .from('company_integrations')
      .select('config')
      .eq('company_id', companyId)
      .eq('provider', 'jobber')
      .maybeSingle()
    const cfg = (data?.config ?? null) as { sync_start_date?: string } | null
    const d = cfg?.sync_start_date
    // Accept YYYY-MM-DD or a full timestamp; ignore anything unparseable rather
    // than pulling from the epoch by accident.
    if (d && /^\d{4}-\d{2}-\d{2}/.test(d) && !Number.isNaN(Date.parse(d))) return d
  } catch {
    // fall through to the default
  }
  return '2026-01-01'
}

/**
 * Run one entity pull. A thin dispatcher so the backfill orchestrator can drive
 * the entities generically without each of them being exported separately.
 * Returns how many records this run wrote.
 */
export async function pullJobberEntity(
  entity: PullEntity,
  userId: string,
  companyId: string,
  opts: PullOpts,
): Promise<number> {
  switch (entity) {
    // Users ignore `opts`: there is no date floor to honour and one page covers
    // any real account, so there is nothing to resume from. Swallowed on failure
    // for the same reason as syncUsersSafe — and here it also stops a backfill
    // stalling forever on its first, least important entity.
    case 'users':
      return syncUsers(userId, companyId).catch(e => {
        console.error('[jobber-sync] user pull failed (continuing):', e instanceof Error ? e.message : String(e))
        return 0
      })
    case 'clients':    return syncClients(userId, companyId, undefined, opts)
    case 'properties': return syncProperties(userId, companyId, undefined, opts)
    case 'jobs':       return syncJobs(userId, companyId, undefined, undefined, opts)
    case 'visits':     return syncVisits(userId, companyId, undefined, undefined, opts)
    case 'invoices':   return syncInvoices(userId, companyId, undefined, opts)
  }
}


export interface SyncSummary {
  users: number
  clients: number
  properties: number
  jobs: number
  visits: number
  invoices: number
  errors: string[]
}

export async function runInitialJobberSync(companyId: string): Promise<SyncSummary> {
  const logId = await startSyncLog(companyId, 'initial_pull', null)
  const summary: SyncSummary = { users: 0, clients: 0, properties: 0, jobs: 0, visits: 0, invoices: 0, errors: [] }

  try {
    const userId = await getJobberUserId(companyId)
    console.log('[jobber-sync] Starting initial YTD pull...')

    await syncUsersSafe(userId, companyId, summary)
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
  const summary: SyncSummary = { users: 0, clients: 0, properties: 0, jobs: 0, visits: 0, invoices: 0, errors: [] }

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
    // ⚠ Deliberately NOT filtered by `updatedSince`. The roster is a few dozen
    // rows and this table is the one that went two months stale; refreshing it
    // whole every night is cheaper than reasoning about when a user changed.
    await syncUsersSafe(userId, companyId, summary)
    summary.clients    = await syncClients(userId, companyId, updatedSince)
    summary.properties = await syncProperties(userId, companyId, updatedSince)
    summary.jobs       = await syncJobs(userId, companyId, updatedSince)
    // Visits use a fixed trailing window (not "since last sync"): the visit
    // filter is startAt-based, so a late completion of an older-start visit
    // would otherwise be missed every night. See VISIT_BACKFILL_DAYS.
    const visitsSince = new Date(Date.now() - VISIT_BACKFILL_DAYS * 24 * 60 * 60 * 1000)
    summary.visits     = await syncVisits(userId, companyId, visitsSince)
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
 * Re-sync the visits belonging to a single job — used by the JOB_UPDATE webhook
 * so a job completed/archived/edited at the job level also refreshes its visits
 * (status + line items). Scoped to ONE-OFF jobs: recurring jobs have many visits
 * that each fire their own visit events on the route, so fanning out there would
 * re-pull dozens of visits per job edit for no benefit. New one-off visits not yet
 * mirrored are covered by VISIT_CREATE + the nightly trailing-window re-pull.
 */
async function syncVisitsForJob(userId: string, companyId: string, jobExternalId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: job } = await admin
    .from('jobs')
    .select('is_recurring')
    .eq('external_id', jobExternalId)
    .eq('source', 'jobber')
    .maybeSingle()
  if (job?.is_recurring) return

  const { data: visits } = await admin
    .from('visits')
    .select('external_id')
    .eq('job_external_id', jobExternalId)
    .eq('source', 'jobber')
    .is('deleted_at', null)
  const ids = (visits ?? []).map(v => v.external_id as string).filter(Boolean)
  if (ids.length) await syncVisits(userId, companyId, undefined, ids)
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
    // Read the parent link BEFORE tombstoning — a deleted visit still changes the
    // status and totals of the job it belonged to.
    let jobBehind: string | null = null
    if (topic === 'VISIT_DESTROY' || topic === 'INVOICE_DESTROY') {
      const { data: row } = await admin
        .from(table)
        .select('job_external_id')
        .eq('company_id', companyId)
        .eq('external_id', itemId)
        .maybeSingle()
      jobBehind = (row as { job_external_id?: string } | null)?.job_external_id ?? null
    }

    const { error } = await admin
      .from(table)
      .update({ deleted_at: new Date().toISOString() })
      .eq('external_id', itemId)
      .eq('source', 'jobber')
      .is('deleted_at', null)
    if (error) console.error(`[jobber-webhook] soft-delete ${table} ${itemId} failed:`, error.message)
    else console.log(`[jobber-webhook] soft-deleted ${table} ${itemId}`)

    // ⚠ Deleting a JOB must take its visits with it. They are not addressed by any
    // event of their own, so left behind they stay "scheduled" forever and keep
    // counting toward booked work for a job that no longer exists.
    if (topic === 'JOB_DESTROY') {
      const { data: jobRow } = await admin
        .from('jobs').select('id')
        .eq('company_id', companyId).eq('external_id', itemId).maybeSingle()
      if (jobRow?.id) {
        const { error: vErr } = await admin
          .from('visits')
          .update({ deleted_at: new Date().toISOString() })
          .eq('company_id', companyId).eq('job_id', jobRow.id).is('deleted_at', null)
        if (vErr) console.error(`[jobber-webhook] cascade visit delete for job ${itemId} failed:`, vErr.message)
      }
    }

    // The job's own status is derived from its visits and its invoice, so removing
    // either moves it without any JOB_* event ever firing.
    if (jobBehind) {
      const userIdForJob = await resolveJobberUserId(companyId)
      if (userIdForJob) {
        try {
          await syncJobs(userIdForJob, companyId, undefined, [jobBehind])
        } catch (e) {
          console.error(`[jobber-webhook] job refresh after ${topic} failed:`, e)
        }
      }
    }
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
      case 'CLIENT_UPDATE': {
        await syncClients(userId, companyId, since)
        // Put the "Lynxedo Customer File" link on the client as soon as Jobber
        // tells us it exists, so a tech opening a job today has it — the daily
        // sweep would leave a new customer without one until tomorrow. No-ops
        // when the link is already set, so CLIENT_UPDATE costs nothing and
        // doubles as self-healing for anything the sweep missed.
        try {
          const outcome = await writeCustomerLinkForClient(companyId, itemId)
          if (outcome !== 'already_set') console.log(`[jobber-webhook] customer link ${itemId}: ${outcome}`)
        } catch (e) {
          // Cosmetic next to the sync itself — never let it fail the event.
          console.error('[jobber-webhook] customer link failed for', itemId, e)
        }
        break
      }
      case 'INVOICE_CREATE':
      case 'INVOICE_UPDATE': {
        await syncInvoices(userId, companyId, since)
        // Invoicing a job moves it OUT of requires_invoicing.
        await refreshJobBehind(userId, companyId, 'invoices', itemId)
        break
      }
      case 'JOB_CREATE':
      case 'JOB_UPDATE':
        await syncJobs(userId, companyId, undefined, [itemId])
        // A job completed/archived/edited via the JOB (not the visit) only fires
        // JOB_UPDATE, which refreshes the job but NOT its visits — so a completed
        // install's visit stays ACTIVE and its line-item edits stay stale, dropping
        // its revenue from completed-visit scoreboards. Re-sync the job's visits too.
        await syncVisitsForJob(userId, companyId, itemId)
        // Put any configured report links (irrigation, and later WF) on the job.
        // Runs after the line-item sync above, because that's what it matches on.
        try {
          const r = await writeReportLinksForJob(companyId, itemId)
          if (r.written.length) console.log(`[jobber-webhook] report links ${itemId}: ${r.written.join(', ')}`)
        } catch (e) {
          console.error('[jobber-webhook] report links failed for', itemId, e)
        }
        break
      case 'VISIT_CREATE':
      case 'VISIT_UPDATE':
        await syncVisits(userId, companyId, undefined, [itemId])
        // Adding or rescheduling a visit moves the job between unscheduled /
        // upcoming / today / late and changes its totals — all derived, none of
        // which emits a JOB_* event.
        await refreshJobBehind(userId, companyId, 'visits', itemId)
        break
      case 'VISIT_COMPLETE': {
        await syncVisits(userId, companyId, undefined, [itemId])
        // Completing the last visit moves the job INTO requires_invoicing — the
        // mirror image of the invoice case, and the reason the mirror drifted in
        // both directions at once (it read 60 jobs action-required where Jobber
        // had 69, while reading 100 requires-invoicing where Jobber had 1).
        await refreshJobBehind(userId, companyId, 'visits', itemId)
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

/**
 * Re-read the job that an invoice or visit belongs to.
 *
 * ⚠⚠ THE RULE THIS ENCODES: Jobber fires a webhook for the record you TOUCHED, not
 * for records whose state changed as a consequence. A job's status is derived from
 * its visits and its invoice, so it moves without ever emitting JOB_UPDATE —
 * invoicing pushes it out of `requires_invoicing`, completing the last visit pushes
 * it in. Neither was handled, and the mirror drifted both ways at once.
 *
 * Any future "webhooks keep X current" claim has to answer the same question: is X
 * derived from something else? If so, the event names that other thing.
 *
 * Best-effort by design — the record the webhook was actually about is already
 * saved, and a stale job status is the lesser harm. POST /api/jobber/reconcile
 * clears whatever this misses.
 */
async function refreshJobBehind(
  userId: string,
  companyId: string,
  table: 'invoices' | 'visits',
  externalId: string,
): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data: row } = await admin
      .from(table)
      .select('job_external_id')
      .eq('company_id', companyId)
      .eq('external_id', externalId)
      .maybeSingle()
    if (row?.job_external_id) {
      await syncJobs(userId, companyId, undefined, [row.job_external_id])
    }
  } catch (e) {
    console.error(`[jobber-webhook] job refresh behind ${table} ${externalId} failed:`, e)
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
