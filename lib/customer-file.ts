import type { SupabaseClient } from '@supabase/supabase-js'
import { customerFilePath } from './customer-file-href'

/* The ONE mapping from a Jobber customer to their Lynxedo customer file.
 *
 * Two id systems have to meet here, and getting it wrong opens the WRONG
 * customer's account — which is why every caller goes through this file instead of
 * writing its own join:
 *
 *   - the Jobber mirror keys customers by `clients.id` (a Lynxedo uuid) and carries
 *     Jobber's own encoded id in `clients.external_id`;
 *   - the customer file at /hub/contacts/[id] keys off `txt_contacts.id`, and the
 *     directory records its Jobber link in `txt_contacts.jobber_client_id`.
 *
 * The bridge is `clients.external_id === txt_contacts.jobber_client_id`. Measured
 * on Heroes' live book (Aug 13, 2026): 1,672 live Jobber customers, 1,635 resolve
 * to exactly one directory record, 37 to none, 0 to more than one.
 *
 * ⚠⚠ MATCHING IS ON THE JOBBER ID, NEVER ON EMAIL OR PHONE. Two customer records
 * routinely share an email address (a duplicate, a renamed account, two people at
 * one address) and Heroes has three such pairs today — so an email match can and
 * does resolve to the wrong person. Two rows carrying the same Jobber client id, by
 * contrast, ARE the same Jobber customer, so a tie there is a duplicate to fold,
 * not an ambiguity to fear.
 *
 * ⚠ THERE IS NO UNIQUE INDEX on (company_id, jobber_client_id). Today's clean
 * one-to-one is the data being tidy, not a constraint — so the tie-break below is
 * load-bearing, not defensive dressing. It is deterministic (oldest record wins,
 * broken by id) for the same reason the at-risk-recurring list picks the oldest
 * record: a link that resolves to a different account depending on row order is
 * worse than one that is consistently the older of two duplicates.
 */

// The URL builders live in their own import-free file so the widget metrics (which
// end up in a client bundle) can use them without pulling `Buffer` in. Re-exported
// here so a server caller has one place to import from.
export { customerFileHref, customerFilePath } from './customer-file-href'

/** Rebuild Jobber's encoded client id, so the lookup is an exact indexed match. */
export function jobberEncodedClientId(numeric: string): string {
  return Buffer.from(`gid://Jobber/Client/${numeric}`).toString('base64')
}

/**
 * The directory record for a Jobber client id, or null when there isn't one.
 *
 * `supabase` must be the CALLER'S client: RLS scopes both tables to their company,
 * so another tenant's Jobber id simply does not resolve.
 */
export async function contactIdForJobberClient(
  supabase: SupabaseClient,
  encodedClientId: string,
): Promise<string | null> {
  // ⚠ Ordered + limited rather than .maybeSingle(): maybeSingle THROWS when two
  // rows come back, so a single duplicated link would turn every customer-file
  // click into an error page. Take the oldest, consistently.
  const { data } = await supabase
    .from('txt_contacts')
    .select('id')
    .eq('jobber_client_id', encodedClientId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1)

  return data?.[0]?.id ?? null
}

/**
 * Where a click on a customer name in a report should land.
 *
 * `clientId` is a `clients.id` uuid from the Jobber mirror — the id the report
 * payloads already carry.
 */
export async function resolveCustomerFileTarget(
  supabase: SupabaseClient,
  clientId: string,
): Promise<
  | { kind: 'contact'; path: string }
  /** A real Jobber customer with no directory record — 37 of Heroes' 1,672. */
  | { kind: 'no-record'; name: string | null }
  /** Not a customer of this company (or deleted). */
  | { kind: 'unknown' }
> {
  const { data: client } = await supabase
    .from('clients')
    .select('name, external_id')
    .eq('id', clientId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!client?.external_id) return { kind: 'unknown' }

  const contactId = await contactIdForJobberClient(supabase, client.external_id as string)
  if (contactId) return { kind: 'contact', path: customerFilePath(contactId) }

  return { kind: 'no-record', name: (client.name as string | null) ?? null }
}
