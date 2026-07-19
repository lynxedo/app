import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/phone'

// Multi-tenant Track 3 — inbound routing by destination number.
//
// Resolve which company an inbound Twilio SMS / voice call belongs to from the
// DESTINATION number (the webhook's `To`), via the globally-unique
// txt_phone_numbers.twilio_number → company_id mapping.
//
// This is the REVERSE of lib/txt-numbers.ts::resolveFromNumber (which picks the
// outbound From). Because twilio_number carries a UNIQUE constraint, the lookup
// is an unambiguous 1:1 — one row per Twilio number, mapping to exactly one
// company and one txt_phone_numbers.id.
//
// Returns null when the number isn't in the table. Callers at the true inbound
// entry points MUST treat null as "fall back to the env-pinned default company"
// (TXT_COMPANY_ID / DIALER_COMPANY_ID) so a missing/unlisted number can never
// drop or misroute live traffic — it degrades to today's single-tenant behavior.
//
// `to` is normalized to E.164 the same way the rest of the codebase does
// (lib/phone.ts::toE164) before matching, since twilio_number is stored E.164.
// Twilio already sends `To` in E.164 for US numbers, so for the existing tenant
// (Heroes) the normalize is a no-op and the resolved company id is identical to
// what the env pin produced before.
export async function resolveCompanyByTwilioNumber(
  to: string
): Promise<{ companyId: string; phoneNumberId: string } | null> {
  const normalized = toE164(to || '')
  if (!normalized) return null

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('txt_phone_numbers')
    .select('id, company_id')
    .eq('twilio_number', normalized)
    .limit(1)
    .maybeSingle()

  if (error || !data?.company_id) return null
  return { companyId: data.company_id as string, phoneNumberId: data.id as string }
}
