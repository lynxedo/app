// Sending identities: a company can have more than one verified From/domain
// (e.g. heroeslawncare.com for important mail, send.lynxedo.com for the rest to
// build Lynxedo's domain reputation). Campaigns and automations carry an
// optional identity_id; this module resolves it — falling back to the company
// default, then to the legacy single identity on email_settings — and merges in
// the company-level CAN-SPAM physical_address that every send needs.
//
// All reads here use the service-role admin client (RLS on the table is a
// read-only company-scoped policy; writes happen in the gated /api/admin routes).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EmailSendIdentity } from '@/lib/email-campaigns'

type Admin = SupabaseClient<any, any, any>

export type SendingIdentity = {
  id: string
  label: string
  from_name: string | null
  from_email: string
  reply_to: string | null
  sending_domain: string | null
  resend_domain_id: string | null
  domain_verified: boolean
  is_default: boolean
}

export const IDENTITY_SELECT =
  'id, label, from_name, from_email, reply_to, sending_domain, resend_domain_id, domain_verified, is_default'

/** All of a company's sending identities, default first then oldest-first. */
export async function listSendingIdentities(admin: Admin, companyId: string): Promise<SendingIdentity[]> {
  const { data } = await admin
    .from('email_sending_identities')
    .select(IDENTITY_SELECT)
    .eq('company_id', companyId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
  return (data ?? []) as SendingIdentity[]
}

/**
 * Validate an identity_id from a request before persisting it: returns the id
 * only if it's a real identity owned by this company, else null (→ use default).
 * Guards against a stale/cross-company id and against a malformed (non-uuid)
 * value that would otherwise error the FK insert.
 */
export async function validIdentityId(
  admin: Admin,
  companyId: string,
  identityId?: string | null,
): Promise<string | null> {
  if (!identityId || typeof identityId !== 'string') return null
  const { data } = await admin
    .from('email_sending_identities')
    .select('id')
    .eq('company_id', companyId)
    .eq('id', identityId)
    .maybeSingle()
  return data ? identityId : null
}

/**
 * The identity row a send should use: the explicit id (when it belongs to the
 * company), else the company default, else null. Callers that need to warn about
 * an unverified domain read domain_verified off the returned row.
 */
export async function resolveIdentityRow(
  admin: Admin,
  companyId: string,
  identityId?: string | null,
): Promise<SendingIdentity | null> {
  if (identityId) {
    const { data } = await admin
      .from('email_sending_identities')
      .select(IDENTITY_SELECT)
      .eq('company_id', companyId)
      .eq('id', identityId)
      .maybeSingle()
    if (data) return data as SendingIdentity
  }
  const { data: def } = await admin
    .from('email_sending_identities')
    .select(IDENTITY_SELECT)
    .eq('company_id', companyId)
    .eq('is_default', true)
    .maybeSingle()
  return (def as SendingIdentity) ?? null
}

/**
 * Resolve the full EmailSendIdentity used by renderAndSendEmail: the chosen (or
 * default) identity's From/Reply-To plus the company's physical mailing address
 * for the CAN-SPAM footer. Returns null only when nothing is configured at all
 * (no identities AND no legacy email_settings.from_email) so callers can HOLD.
 */
export async function resolveSendIdentity(
  admin: Admin,
  companyId: string,
  identityId?: string | null,
): Promise<EmailSendIdentity | null> {
  // Physical address is company-level (not per identity) — read it once.
  const { data: settings } = await admin
    .from('email_settings')
    .select('physical_address, from_name, from_email, reply_to')
    .eq('company_id', companyId)
    .maybeSingle()
  const physical = settings?.physical_address ?? null

  const row = await resolveIdentityRow(admin, companyId, identityId)
  if (row) {
    return {
      from_name: row.from_name,
      from_email: row.from_email,
      reply_to: row.reply_to,
      physical_address: physical,
    }
  }

  // Back-compat: no identities table rows yet → fall back to the legacy single
  // identity that used to live on email_settings.
  if (!settings?.from_email) return null
  return {
    from_name: settings.from_name ?? null,
    from_email: settings.from_email,
    reply_to: settings.reply_to ?? null,
    physical_address: physical,
  }
}
