// AI Voice Receptionist — per-company settings loader + fallback resolver.
//
// The greeting, behavior instructions (prompt), voice id, and on/off switch now
// live in the `voice_receptionist_settings` DB table (one row per company),
// editable in Admin -> Dialer -> AI Receptionist. This module reads that row and
// resolves the EFFECTIVE values, falling back to the code constants in
// lib/voice-receptionist.ts and the VOICE_ELEVENLABS_VOICE_ID env when a field
// is blank — so the receptionist keeps working exactly as before if nothing has
// been customized (or before the seed migration is applied).

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  VOICE_RECEPTIONIST_PROMPT,
  buildWelcomeGreeting,
} from '@/lib/voice-receptionist'

export type VoiceReceptionistSettingsRow = {
  company_id: string
  enabled: boolean
  greeting: string | null
  instructions: string | null
  voice_id: string | null
  updated_at: string
  updated_by: string | null
}

export type EffectiveVoiceReceptionistSettings = {
  enabled: boolean
  greeting: string
  instructions: string
  voiceId: string
}

/**
 * Fetch the raw settings row for a company, or null when no row exists yet.
 * Uses the passed-in admin/service client (RLS-bypassing) — the same client the
 * call-time endpoints and the Dialer admin page already create.
 */
export async function getVoiceReceptionistSettings(
  admin: SupabaseClient,
  companyId: string
): Promise<VoiceReceptionistSettingsRow | null> {
  const { data } = await admin
    .from('voice_receptionist_settings')
    .select('company_id, enabled, greeting, instructions, voice_id, updated_at, updated_by')
    .eq('company_id', companyId)
    .maybeSingle()
  return (data as VoiceReceptionistSettingsRow | null) ?? null
}

/**
 * Resolve the EFFECTIVE settings from a row (or null), applying per-field
 * fallbacks:
 *   greeting     -> row.greeting?.trim()     || buildWelcomeGreeting()
 *   instructions -> row.instructions?.trim() || VOICE_RECEPTIONIST_PROMPT
 *   voiceId      -> row.voice_id?.trim()     || process.env.VOICE_ELEVENLABS_VOICE_ID
 *   enabled      -> row.enabled  (when a row exists)
 *
 * "No row yet" default: when NO row exists at all we treat enabled as TRUE
 * (fail-open). This preserves the previous hardcoded behavior — the receptionist
 * answered whenever AI_RECEPTIONIST_ENABLED/VOICE_WSS_URL were set, with no DB
 * gate — so nothing breaks in the window before the seed migration runs. Once a
 * row exists (including the Heroes seed), its explicit `enabled` flag is honored,
 * so the Admin on/off toggle is authoritative from then on.
 */
export function resolveVoiceReceptionistSettings(
  row: VoiceReceptionistSettingsRow | null
): EffectiveVoiceReceptionistSettings {
  return {
    enabled: row ? row.enabled : true,
    greeting: row?.greeting?.trim() || buildWelcomeGreeting(),
    instructions: row?.instructions?.trim() || VOICE_RECEPTIONIST_PROMPT,
    voiceId: row?.voice_id?.trim() || process.env.VOICE_ELEVENLABS_VOICE_ID || '',
  }
}

/**
 * Convenience: fetch + resolve in one call. Used by the call-time endpoints
 * (brain + TwiML) which just want the effective values.
 */
export async function getEffectiveVoiceReceptionistSettings(
  admin: SupabaseClient,
  companyId: string
): Promise<EffectiveVoiceReceptionistSettings> {
  const row = await getVoiceReceptionistSettings(admin, companyId)
  return resolveVoiceReceptionistSettings(row)
}
