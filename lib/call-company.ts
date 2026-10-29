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

/**
 * Which company a request from the voice service (or Amber-over-text's loopback)
 * belongs to. Same "never worse than before" rule as companyForCall:
 *   1. an explicit companyId (the voice service echoes the one /brain returned —
 *      these routes are VOICE_SERVICE_SECRET-authenticated);
 *   2. the company that owns the dialed number (`to`);
 *   3. a `txt:<conversation id>` callSid (Amber over text) → that conversation;
 *   4. the call's own row (by callSid);
 *   5. the env-default company (Heroes).
 * Never throws.
 */
export async function companyForVoiceRequest(body: {
  companyId?: string | null
  to?: string | null
  callSid?: string | null
}): Promise<string> {
  try {
    const explicit = (body.companyId || '').trim()
    if (explicit) return explicit
    const to = (body.to || '').trim()
    if (to && !to.startsWith('client:')) {
      const resolved = await resolveCompanyByTwilioNumber(to)
      if (resolved) return resolved.companyId
    }
    const sid = (body.callSid || '').trim()
    if (sid.startsWith('txt:')) {
      const { data } = await createAdminClient()
        .from('txt_conversations')
        .select('company_id')
        .eq('id', sid.slice('txt:'.length))
        .maybeSingle()
      if (data?.company_id) return data.company_id as string
    } else if (sid) {
      const { data } = await createAdminClient()
        .from('calls')
        .select('company_id')
        .eq('twilio_call_sid', sid)
        .limit(1)
        .maybeSingle()
      if (data?.company_id) return data.company_id as string
    }
  } catch {
    // fall through to the env-default company
  }
  return ENV_PHONE_COMPANY_ID
}
