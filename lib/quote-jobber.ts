import { createAdminClient } from '@/lib/supabase/admin'
import { companyJobberUserId, jobberGraphQLPatient } from '@/lib/jobber'
import { loadQuoteCustomer } from '@/lib/quote-server'

// Quotes ↔ Jobber (Work Orders & Quotes PRD — Phase 4, session 5).
//
// Every quote Hub sends gets a matching Jobber quote, so Jobber's quote list and
// our Reports (which read jobber_quotes) stay honest — PRD §4.3 step 7.
//   * At send: quoteCreate with the same lines (add-ons optional:true and NOT
//     recommended — in Jobber "recommended" means chosen by default, and Ben's
//     rule is add-ons start unticked), intro → message, terms →
//     contractDisclaimer, deposit → CostModifier, internal notes → a quote note
//     (internal in Jobber too). Re-sending after a Revise rewrites the same
//     Jobber quote's lines instead of making a second one.
//   * At approval: Jobber's API has NO approve mutation (verified Oct 5 2026),
//     so Hub turns the add-ons the customer picked into regular lines
//     (quoteEditLineItems optional:false), pins a note saying who approved,
//     when and for how much, and the office clicks Approve in Jobber from the
//     link — the same click they make today when a customer says yes by phone.
// Failures never undo the send / approval: they're saved on the quote
// (jobber_sync_error) and shown in the builder with a Retry button.

type Admin = ReturnType<typeof createAdminClient>

/**
 * Whether the Jobber quote is created as "awaiting response" (Jobber: "sent to
 * client") or left as a draft. ⚠ Not yet verified whether Jobber EMAILS the
 * client on this transition — check on a test client before turning on in prod.
 */
export const JOBBER_MARK_AWAITING_RESPONSE = true

type ItemRow = {
  id: string
  sort_order: number
  optional: boolean
  name: string
  description: string
  quantity: number
  unit_price: number | null
  taxable: boolean | null
  jobber_product_id: string | null
  jobber_line_item_id: string | null
  selected_by_customer: boolean
}

type GqlErrors = { message: string }[] | undefined
const errText = (userErrors: GqlErrors, gqlErrors?: GqlErrors) =>
  [...(userErrors ?? []), ...(gqlErrors ?? [])].map(e => e.message).filter(Boolean).join('; ')

function lineInput(i: ItemRow) {
  return {
    name: i.name,
    description: i.description || undefined,
    quantity: Number(i.quantity) || 1,
    unitPrice: Number(i.unit_price ?? 0),
    optional: !!i.optional,
    recommended: false,
    saveToProductsAndServices: false,
    ...(i.taxable != null ? { taxable: i.taxable } : {}),
    ...(i.jobber_product_id ? { productOrServiceId: i.jobber_product_id } : {}),
  }
}

function depositInput(type: string | null, value: number | null) {
  if (!type || value == null || Number(value) <= 0) return null
  return { rate: Number(value), type: type === 'percent' ? 'Percent' : 'Unit' }
}

async function record(admin: Admin, quoteId: string, companyId: string, patch: Record<string, unknown>, event: { kind: string; meta: Record<string, unknown> }) {
  await admin.from('quotes').update(patch).eq('id', quoteId).eq('company_id', companyId)
  await admin.from('quote_events').insert({ quote_id: quoteId, company_id: companyId, kind: event.kind, meta: event.meta })
}

const QUOTE_FIELDS = 'id quoteNumber jobberWebUri clientHubUri lineItems(first: 100) { nodes { id name optional } }'

/**
 * Create (or, after a Revise, rewrite) the Jobber quote for a Hub quote.
 * Returns an error string, or null when Jobber now matches.
 */
export async function pushQuoteToJobber(admin: Admin, companyId: string, quoteId: string, actorUserId: string | null): Promise<string | null> {
  const { data: q } = await admin.from('quotes')
    .select('id, contact_id, jobber_client_id, jobber_property_id, title, intro, terms, internal_notes, deposit_type, deposit_value, salesperson_user_id, jobber_quote_id')
    .eq('id', quoteId).eq('company_id', companyId).maybeSingle()
  if (!q) return 'Quote not found'
  const fail = async (msg: string) => {
    await record(admin, quoteId, companyId, { jobber_sync_error: msg }, { kind: 'jobber_error', meta: { error: msg } })
    return msg
  }

  // The Jobber client + property. A customer who isn't in Jobber yet can't have
  // a Jobber quote — the office adds them in Jobber, then Retry.
  let clientId = q.jobber_client_id as string | null
  let propertyId = q.jobber_property_id as string | null
  if (!clientId || !propertyId) {
    const cust = await loadQuoteCustomer(admin, companyId, q.contact_id as string)
    clientId = clientId ?? cust?.contact.jobberClientId ?? null
    propertyId = propertyId ?? cust?.properties.find(p => p.jobberId)?.jobberId ?? null
    if (clientId || propertyId) await admin.from('quotes').update({ jobber_client_id: clientId, jobber_property_id: propertyId }).eq('id', quoteId)
  }
  if (!clientId) return fail('This customer isn’t in Jobber yet. Add them in Jobber, then press Retry.')
  if (!propertyId) return fail('This customer has no property in Jobber. Add one in Jobber, then press Retry.')

  const jobberUser = await companyJobberUserId(companyId, (q.salesperson_user_id as string | null) ?? actorUserId ?? '')
  if (!jobberUser) return fail('Jobber isn’t connected for the company.')

  const { data: rows } = await admin.from('quote_line_items')
    .select('id, sort_order, optional, name, description, quantity, unit_price, taxable, jobber_product_id, jobber_line_item_id, selected_by_customer')
    .eq('quote_id', quoteId).eq('company_id', companyId).order('sort_order')
  const items = (rows ?? []) as ItemRow[]
  if (!items.length) return fail('The quote has no lines.')

  // The sender's Jobber user, when their Hub account is linked (Admin → People).
  let salespersonId: string | null = null
  if (q.salesperson_user_id) {
    const { data: hu } = await admin.from('hub_users').select('jobber_user_id').eq('id', q.salesperson_user_id).maybeSingle()
    salespersonId = (hu?.jobber_user_id as string | null) || null
  }
  const deposit = depositInput(q.deposit_type as string | null, q.deposit_value as number | null)

  type QuoteNode = { id: string; quoteNumber: number | string; jobberWebUri: string; clientHubUri: string | null; lineItems: { nodes: { id: string; name: string; optional: boolean }[] } }
  let node: QuoteNode | null = null

  if (!q.jobber_quote_id) {
    const attributes: Record<string, unknown> = {
      clientId,
      propertyId,
      title: q.title,
      message: q.intro || undefined,
      contractDisclaimer: q.terms || undefined,
      lineItems: items.map(lineInput),
      ...(deposit ? { deposit } : {}),
      ...(salespersonId ? { salespersonId } : {}),
      ...(String(q.internal_notes ?? '').trim() ? { notes: [{ message: `Internal notes (from Lynxedo Hub):\n${String(q.internal_notes).trim()}`, pinned: false }] } : {}),
      ...(JOBBER_MARK_AWAITING_RESPONSE ? { transitionQuoteTo: 'AWAITING_RESPONSE' } : {}),
    }
    const res = await jobberGraphQLPatient<{ data?: { quoteCreate?: { quote: QuoteNode | null; userErrors: GqlErrors } }; errors?: GqlErrors }>(
      jobberUser,
      `mutation HubQuoteCreate($attributes: QuoteCreateAttributes!) { quoteCreate(attributes: $attributes) { quote { ${QUOTE_FIELDS} } userErrors { message } } }`,
      { attributes },
    ).catch(e => ({ errors: [{ message: e instanceof Error ? e.message : 'Jobber request failed' }] }) as { data?: undefined; errors: GqlErrors })
    const e = errText(res.data?.quoteCreate?.userErrors, res.errors)
    node = res.data?.quoteCreate?.quote ?? null
    if (!node) return fail(`Jobber refused the quote: ${e || 'no quote returned'}`)
  } else {
    // Re-sent after a Revise: rewrite the same Jobber quote.
    const jq = q.jobber_quote_id as string
    const oldIds = items.map(i => i.jobber_line_item_id).filter((x): x is string => !!x)
    const read = await jobberGraphQLPatient<{ data?: { quote: { lineItems: { nodes: { id: string }[] } } | null }; errors?: GqlErrors }>(
      jobberUser, `query HubQuoteLines($id: EncodedId!) { quote(id: $id) { lineItems(first: 100) { nodes { id } } } }`, { id: jq },
    ).catch(() => ({ data: undefined }))
    const existing = read.data?.quote?.lineItems.nodes.map(n => n.id) ?? oldIds
    const edit = await jobberGraphQLPatient<{ data?: { quoteEdit?: { userErrors: GqlErrors } }; errors?: GqlErrors }>(
      jobberUser,
      `mutation HubQuoteEdit($quoteId: EncodedId!, $attributes: QuoteEditAttributes!) { quoteEdit(quoteId: $quoteId, attributes: $attributes) { userErrors { message } } }`,
      { quoteId: jq, attributes: { title: q.title, message: q.intro ?? '', contractDisclaimer: q.terms ?? '', deposit: deposit ?? { rate: 0, type: 'Percent' }, sentAt: new Date().toISOString(), ...(salespersonId ? { salespersonId } : {}) } },
    ).catch(e => ({ errors: [{ message: e instanceof Error ? e.message : 'Jobber request failed' }] }) as { data?: undefined; errors: GqlErrors })
    const editErr = errText(edit.data?.quoteEdit?.userErrors, edit.errors)
    if (editErr) return fail(`Jobber didn’t take the changes: ${editErr}`)
    const add = await jobberGraphQLPatient<{ data?: { quoteCreateLineItems?: { userErrors: GqlErrors } }; errors?: GqlErrors }>(
      jobberUser,
      `mutation HubQuoteAddLines($quoteId: EncodedId!, $lineItems: [QuoteCreateLineItemAttributes!]!) { quoteCreateLineItems(quoteId: $quoteId, lineItems: $lineItems) { userErrors { message } } }`,
      { quoteId: jq, lineItems: items.map(lineInput) },
    ).catch(e => ({ errors: [{ message: e instanceof Error ? e.message : 'Jobber request failed' }] }) as { data?: undefined; errors: GqlErrors })
    const addErr = errText(add.data?.quoteCreateLineItems?.userErrors, add.errors)
    if (addErr) return fail(`Jobber didn’t take the new lines: ${addErr}`)
    // Only now remove the old lines — a failure above leaves the old quote whole.
    if (existing.length) {
      const del = await jobberGraphQLPatient<{ data?: { quoteDeleteLineItems?: { userErrors: GqlErrors } }; errors?: GqlErrors }>(
        jobberUser,
        `mutation HubQuoteDelLines($quoteId: EncodedId!, $lineItemIds: [EncodedId!]!) { quoteDeleteLineItems(quoteId: $quoteId, lineItemIds: $lineItemIds) { userErrors { message } } }`,
        { quoteId: jq, lineItemIds: existing },
      ).catch(e => ({ errors: [{ message: e instanceof Error ? e.message : 'Jobber request failed' }] }) as { data?: undefined; errors: GqlErrors })
      const delErr = errText(del.data?.quoteDeleteLineItems?.userErrors, del.errors)
      if (delErr) return fail(`The new lines are in Jobber, but the old ones couldn’t be removed — remove them in Jobber: ${delErr}`)
    }
    const after = await jobberGraphQLPatient<{ data?: { quote: QuoteNode | null } }>(
      jobberUser, `query HubQuoteRead($id: EncodedId!) { quote(id: $id) { ${QUOTE_FIELDS} } }`, { id: jq },
    ).catch(() => ({ data: undefined }))
    node = after.data?.quote ?? null
    if (!node) return fail('Updated in Jobber, but the quote couldn’t be read back — check it in Jobber.')
  }

  // Remember each line's Jobber id (same order as sent), for the approval step.
  const jobberLines = node.lineItems.nodes
  for (let n = 0; n < items.length && n < jobberLines.length; n++) {
    if (jobberLines[n].name === items[n].name) {
      await admin.from('quote_line_items').update({ jobber_line_item_id: jobberLines[n].id }).eq('id', items[n].id)
    }
  }
  await record(admin, quoteId, companyId, {
    jobber_quote_id: node.id,
    jobber_quote_number: String(node.quoteNumber ?? ''),
    jobber_web_uri: node.jobberWebUri ?? null,
    jobber_client_hub_uri: node.clientHubUri ?? null,
    jobber_synced_at: new Date().toISOString(),
    jobber_sync_error: null,
  }, { kind: 'jobber_synced', meta: { jobber_quote_id: node.id, quote_number: node.quoteNumber, rewrite: !!q.jobber_quote_id } })
  return null
}

/**
 * The customer approved on our page: make the add-ons they picked regular lines
 * on the Jobber quote and pin a note — the office then approves it in Jobber.
 */
export async function syncApprovalToJobber(admin: Admin, companyId: string, quoteId: string): Promise<string | null> {
  const { data: q } = await admin.from('quotes')
    .select('id, jobber_quote_id, salesperson_user_id, created_by, approved_name, approved_at, total_selected')
    .eq('id', quoteId).eq('company_id', companyId).maybeSingle()
  if (!q) return 'Quote not found'
  const fail = async (msg: string) => {
    await record(admin, quoteId, companyId, { jobber_sync_error: msg }, { kind: 'jobber_error', meta: { error: msg, step: 'approval' } })
    return msg
  }
  if (!q.jobber_quote_id) return fail('No Jobber quote to update — press Retry to create it, then approve it in Jobber.')
  const jobberUser = await companyJobberUserId(companyId, (q.salesperson_user_id as string | null) ?? (q.created_by as string | null) ?? '')
  if (!jobberUser) return fail('Jobber isn’t connected for the company.')

  const { data: rows } = await admin.from('quote_line_items').select('name, optional, selected_by_customer, jobber_line_item_id').eq('quote_id', quoteId)
  const picked = (rows ?? []).filter(r => r.optional && r.selected_by_customer)
  const missing = picked.filter(r => !r.jobber_line_item_id)
  const toEdit = picked.filter(r => r.jobber_line_item_id).map(r => ({ lineItemId: r.jobber_line_item_id as string, optional: false }))
  if (toEdit.length) {
    const res = await jobberGraphQLPatient<{ data?: { quoteEditLineItems?: { userErrors: GqlErrors } }; errors?: GqlErrors }>(
      jobberUser,
      `mutation HubQuoteApproveLines($quoteId: EncodedId!, $lineItems: [QuoteEditLineItemAttributes!]!) { quoteEditLineItems(quoteId: $quoteId, lineItems: $lineItems) { userErrors { message } } }`,
      { quoteId: q.jobber_quote_id, lineItems: toEdit },
    ).catch(e => ({ errors: [{ message: e instanceof Error ? e.message : 'Jobber request failed' }] }) as { data?: undefined; errors: GqlErrors })
    const err = errText(res.data?.quoteEditLineItems?.userErrors, res.errors)
    if (err) return fail(`Couldn’t mark the chosen add-ons in Jobber: ${err}`)
  }
  const when = q.approved_at ? new Date(q.approved_at as string).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
  const total = Number(q.total_selected ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  const message = [
    `✅ Approved online by ${q.approved_name ?? 'the customer'} on ${when} (Lynxedo Hub) — ${total}.`,
    picked.length ? `Add-ons chosen: ${picked.map(p => p.name).join(', ')}.` : 'No add-ons chosen.',
    missing.length ? `⚠ Not marked in Jobber (add them by hand): ${missing.map(p => p.name).join(', ')}.` : null,
    'Please approve this quote in Jobber and book the work.',
  ].filter(Boolean).join('\n')
  const note = await jobberGraphQLPatient<{ data?: { quoteCreateNote?: { userErrors: GqlErrors } }; errors?: GqlErrors }>(
    jobberUser,
    `mutation HubQuoteNote($quoteId: EncodedId!, $input: QuoteCreateNoteInput!) { quoteCreateNote(quoteId: $quoteId, input: $input) { userErrors { message } } }`,
    { quoteId: q.jobber_quote_id, input: { message, pinned: true } },
  ).catch(e => ({ errors: [{ message: e instanceof Error ? e.message : 'Jobber request failed' }] }) as { data?: undefined; errors: GqlErrors })
  const noteErr = errText(note.data?.quoteCreateNote?.userErrors, note.errors)
  if (noteErr) return fail(`Add-ons marked, but the approval note didn’t save in Jobber: ${noteErr}`)
  await record(admin, quoteId, companyId, { jobber_synced_at: new Date().toISOString(), jobber_sync_error: null }, { kind: 'jobber_synced', meta: { step: 'approval', addOns: picked.length } })
  return null
}
