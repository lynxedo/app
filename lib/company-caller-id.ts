import type { SupabaseClient } from '@supabase/supabase-js'
import { voiceCallerId } from '@/lib/twilio-voice'
import { mayUseEnvPhoneLines } from '@/lib/phone-company'

/**
 * The number a company's outbound calls show as caller ID. The env-default
 * company (Heroes) keeps today's env caller ID exactly; every other company uses
 * its own default txt_phone_numbers line, or null when it has none — callers
 * then refuse the call rather than ring a customer from Heroes' number.
 */
export async function companyCallerId(admin: SupabaseClient, companyId: string): Promise<string | null> {
  if (mayUseEnvPhoneLines(companyId)) return voiceCallerId() || null
  const { data } = await admin
    .from('txt_phone_numbers')
    .select('twilio_number')
    .eq('company_id', companyId)
    .eq('is_default', true)
    .limit(1)
    .maybeSingle()
  return (data?.twilio_number as string | undefined) ?? null
}
