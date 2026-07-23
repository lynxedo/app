// Shared identity for AI / automated outbound texts (the "Amber" text bot).
//
// Several surfaces send customer texts on the company's behalf without a human
// author: the AI voice-receptionist recap (app/api/voice/wrapup), the Responder
// missed-call auto-text (lib/responder) and the Responder AI voicemail reply
// (lib/responder-ai). These must sign with the AI persona's name (e.g.
// "- Amber, Heroes Lawn Care") — NOT a staff member's name — so a customer never
// sees an inconsistent "This is Amber … - Ben" text.
//
// The persona's Hub user id lives on voice_receptionist_settings.text_bot_user_id
// (the same bot user the Drip engine already sends as). This module resolves that
// id and renders the outbound signature for it exactly like lib/txt-send.ts does
// for a human sender, so all three surfaces stay consistent with the company's
// editable Txt signature template.

import type { SupabaseClient } from '@supabase/supabase-js'
import { renderTemplate } from '@/lib/txt-templates'

/**
 * The company's AI text-bot Hub user id (Amber), or null when the company hasn't
 * configured one. Callers fall back to their prior behavior when null.
 */
export async function getAiTextBotUserId(
  admin: SupabaseClient,
  companyId: string
): Promise<string | null> {
  const { data } = await admin
    .from('voice_receptionist_settings')
    .select('text_bot_user_id')
    .eq('company_id', companyId)
    .maybeSingle()
  return ((data as { text_bot_user_id?: string | null } | null)?.text_bot_user_id) ?? null
}

/**
 * Render the outbound-text signature line for the company's AI text bot, mirroring
 * lib/txt-send.ts's resolution: prefer the bot's personal txt_signature (bots
 * normally have none) and otherwise the company default signature template,
 * rendered with the bot's display name (so `{my_first_name}` / `{my_name}` become
 * the persona name). Returns '' when there is no bot user or no signature
 * configured — in which case callers append nothing (unchanged behavior).
 *
 * `botUserId` may be passed to reuse an already-resolved id.
 */
export async function renderAiTextSignature(
  admin: SupabaseClient,
  companyId: string,
  botUserId?: string | null
): Promise<string> {
  const userId = botUserId ?? (await getAiTextBotUserId(admin, companyId))
  if (!userId) return ''

  const [{ data: sender }, { data: company }, { data: profile }, { data: txtSettings }] =
    await Promise.all([
      admin.from('hub_users').select('display_name').eq('id', userId).maybeSingle(),
      admin.from('companies').select('name').eq('id', companyId).maybeSingle(),
      admin.from('user_profiles').select('txt_signature').eq('id', userId).maybeSingle(),
      admin
        .from('txt_settings')
        .select('company_default_signature, allow_user_signatures')
        .eq('company_id', companyId)
        .maybeSingle(),
    ])

  const settings = txtSettings as
    | { company_default_signature?: string | null; allow_user_signatures?: boolean | null }
    | null
  const allowUserSig = settings?.allow_user_signatures !== false
  const personalSig = ((profile as { txt_signature?: string | null } | null)?.txt_signature || '').trim()
  const companySig = (settings?.company_default_signature || '').trim()
  const signature = allowUserSig && personalSig ? personalSig : companySig
  if (!signature) return ''

  return renderTemplate(signature, {
    senderName: (sender as { display_name?: string | null } | null)?.display_name || null,
    companyName: (company as { name?: string | null } | null)?.name || null,
  })
}
