// Email engagement events (Session 5). Shared helpers for the Resend webhook
// receiver and the unsubscribe handlers. Events land in email_events and match
// back to a campaign send via provider_message_id -> email_campaign_recipients.
import type { SupabaseClient } from '@supabase/supabase-js'

type Admin = SupabaseClient<any, any, any>

export type NormalizedEventType =
  | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'delivery_delayed' | 'unsubscribed'

// Resend event type -> our normalized type. Unknown types return null (ignored).
const RESEND_TYPE_MAP: Record<string, NormalizedEventType> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
}

export function mapResendType(t: string | undefined | null): NormalizedEventType | null {
  if (!t) return null
  return RESEND_TYPE_MAP[t] ?? null
}

/**
 * Log an 'unsubscribed' event attributed to a campaign (best-effort, never
 * throws). Called from the unsubscribe handlers when the link carried a campaign
 * id, so per-campaign analytics can show unsubscribes.
 */
export async function recordUnsubscribeEvent(
  admin: Admin,
  companyId: string,
  campaignId: string | null | undefined,
  email: string,
): Promise<void> {
  if (!campaignId || !email) return
  try {
    const { data: rec } = await admin
      .from('email_campaign_recipients')
      .select('id')
      .eq('campaign_id', campaignId)
      .ilike('email', email)
      .maybeSingle()
    await admin.from('email_events').insert({
      company_id: companyId,
      campaign_id: campaignId,
      recipient_id: rec?.id ?? null,
      email: email.toLowerCase(),
      type: 'unsubscribed',
      occurred_at: new Date().toISOString(),
    })
  } catch {
    /* analytics is best-effort; never block the unsubscribe itself */
  }
}
