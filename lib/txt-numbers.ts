import type { SupabaseClient } from '@supabase/supabase-js'

// Resolves the Twilio "From" number for an outbound message.
// Precedence: per-conversation override → caller's per-user default → company default
// → process.env.TWILIO_PHONE_NUMBER (handled by sendSms itself when no fromNumber arg).
// Returns null when nothing is configured at any tier — caller should fall back to env.
export async function resolveFromNumber(
  supabase: SupabaseClient,
  opts: { conversationId?: string | null; userId?: string | null; companyId: string }
): Promise<string | null> {
  const { conversationId, userId, companyId } = opts

  if (conversationId) {
    const { data: conv } = await supabase
      .from('txt_conversations')
      .select('phone_number_id, number:txt_phone_numbers!txt_conversations_phone_number_id_fkey ( twilio_number )')
      .eq('id', conversationId)
      .maybeSingle()
    const num = Array.isArray(conv?.number) ? conv?.number[0] : conv?.number
    if (num?.twilio_number) return num.twilio_number as string
  }

  if (userId) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('txt_default_number_id, number:txt_phone_numbers!user_profiles_txt_default_number_id_fkey ( twilio_number )')
      .eq('id', userId)
      .maybeSingle()
    const num = Array.isArray(profile?.number) ? profile?.number[0] : profile?.number
    if (num?.twilio_number) return num.twilio_number as string
  }

  const { data: companyDefault } = await supabase
    .from('txt_phone_numbers')
    .select('twilio_number')
    .eq('company_id', companyId)
    .eq('is_default', true)
    .maybeSingle()
  if (companyDefault?.twilio_number) return companyDefault.twilio_number as string

  return null
}
