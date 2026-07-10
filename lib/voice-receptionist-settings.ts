// AI Voice Receptionist — per-company settings loader + fallback resolver.
//
// The greeting, behavior instructions (prompt), voice id, capability level, and
// on/off switch live in the `voice_receptionist_settings` DB table (one row per
// company), editable in Admin -> Dialer -> AI Receptionist. This module reads
// that row and resolves the EFFECTIVE values, falling back to the code builders
// in lib/voice-receptionist.ts and the VOICE_ELEVENLABS_VOICE_ID env when a
// field is blank — so the receptionist keeps working exactly as before if
// nothing has been customized (or before the seed migration is applied).

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildVoiceReceptionistPrompt,
  buildWelcomeGreeting,
  clampReceptionistLevel,
  type ReceptionistLevel,
} from '@/lib/voice-receptionist'

export type VoiceReceptionistSettingsRow = {
  company_id: string
  enabled: boolean
  level: number | null
  greeting: string | null
  instructions: string | null
  voice_id: string | null
  updated_at: string
  updated_by: string | null
}

export type EffectiveVoiceReceptionistSettings = {
  enabled: boolean
  /** The admin-chosen level (1–4) after the plan cap, before implementation clamping. */
  level: ReceptionistLevel
  /** The level actually driving behavior (level 4 clamps to 3 until built). */
  effectiveLevel: 1 | 2 | 3
  greeting: string
  instructions: string
  voiceId: string
}

/**
 * The subscription plan's maximum receptionist level for a company.
 *
 * SaaS hook: when subscription plans exist, resolve the company's plan here and
 * return its cap (Level 1 tier -> 1, ... premium -> 4). Until then every company
 * is uncapped. The effective level is always min(admin-chosen, this cap).
 */
export function getPlanMaxReceptionistLevel(_companyId: string): ReceptionistLevel {
  // TODO(SaaS): look up the company's subscription plan -> max level.
  return 4
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
    .select('company_id, enabled, level, greeting, instructions, voice_id, updated_at, updated_by')
    .eq('company_id', companyId)
    .maybeSingle()
  return (data as VoiceReceptionistSettingsRow | null) ?? null
}

/**
 * Resolve the EFFECTIVE settings from a row (or null), applying per-field
 * fallbacks:
 *   level        -> min(row.level ?? 2, plan cap); behavior additionally
 *                   clamps to the highest implemented level (4 -> 3 for now)
 *   greeting     -> row.greeting?.trim()     || buildWelcomeGreeting(level)
 *   instructions -> row.instructions?.trim() || buildVoiceReceptionistPrompt(level)
 *   voiceId      -> row.voice_id?.trim()     || process.env.VOICE_ELEVENLABS_VOICE_ID
 *   enabled      -> row.enabled  (when a row exists)
 *
 * "No row yet" default: when NO row exists at all we treat enabled as TRUE
 * (fail-open) at Level 2. This preserves the pre-settings behavior so nothing
 * breaks in the window before the seed migration runs. Once a row exists
 * (including the Heroes seed), its explicit flags are authoritative.
 */
export function resolveVoiceReceptionistSettings(
  row: VoiceReceptionistSettingsRow | null,
  planMaxLevel: ReceptionistLevel = 4
): EffectiveVoiceReceptionistSettings {
  const chosen = Math.max(1, Math.min(Math.round(row?.level ?? 2), planMaxLevel)) as ReceptionistLevel
  const effectiveLevel = clampReceptionistLevel(chosen)
  return {
    enabled: row ? row.enabled : true,
    level: chosen,
    effectiveLevel,
    greeting: row?.greeting?.trim() || buildWelcomeGreeting(effectiveLevel),
    instructions: row?.instructions?.trim() || buildVoiceReceptionistPrompt(effectiveLevel),
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
  return resolveVoiceReceptionistSettings(row, getPlanMaxReceptionistLevel(companyId))
}
