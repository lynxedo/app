import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyByTwilioNumber } from '@/lib/txt-company'
import { ENV_PHONE_COMPANY_ID } from '@/lib/phone-company'

/**
 * Which company a Twilio voice webhook belongs to (SaaS Launch Gate Session 3).
 *   1. the company that owns the dialed number (`To` / `Called`) — every leg of
 *      an inbound call carries it;
 *   2. else the company on the call's own row (by ParentCallSid / CallSid);
 *   3. else the env-default company (Heroes) — exactly today's behaviour, so a
 *      lookup miss is never worse than before.
 * Never throws.
 */
export async function companyForCall(params: URLSearchParams): Promise<string> {
  try {
    for (const key of ['To', 'Called']) {
      const n = params.get(key) || ''
      if (n && !n.startsWith('client:')) {
        const resolved = await resolveCompanyByTwilioNumber(n)
        if (resolved) return resolved.companyId
      }
    }
    const sids = [params.get('ParentCallSid'), params.get('CallSid')].filter((s): s is string => !!s)
    if (sids.length) {
      const { data } = await createAdminClient()
        .from('calls')
        .select('company_id')
        .in('twilio_call_sid', sids)
        .limit(1)
        .maybeSingle()
      if (data?.company_id) return data.company_id as string
    }
  } catch {
    // fall through to the env-default company
  }
  return ENV_PHONE_COMPANY_ID
}
