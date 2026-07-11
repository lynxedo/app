// AI Voice Receptionist — per-company settings loader + fallback resolver.
//
// The persona name, greetings (business-hours + after-hours), behavior
// instructions (prompt), voice id, capability level, recap-text toggle, and
// on/off switch live in the `voice_receptionist_settings` DB table (one row per
// company), editable in Admin → AI → Receptionist. This module reads that row
// and resolves the EFFECTIVE values, falling back to the code builders in
// lib/voice-receptionist.ts and the VOICE_ELEVENLABS_VOICE_ID env when a field
// is blank — so the receptionist keeps working exactly as before if nothing has
// been customized (or before the seed migration is applied).

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  DEFAULT_RECEPTIONIST_NAME,
  buildVoiceReceptionistPrompt,
  buildWelcomeGreeting,
  clampReceptionistLevel,
  type ReceptionistLevel,
} from '@/lib/voice-receptionist'

export type VoiceReceptionistSettingsRow = {
  company_id: string
  enabled: boolean
  level: number | null
  receptionist_name: string | null
  greeting: string | null
  greeting_business_hours: string | null
  greeting_after_hours: string | null
  instructions: string | null
  voice_id: string | null
  recap_text_enabled: boolean | null
  updated_at: string
  updated_by: string | null
}

// Columns to select for the settings row (kept in one place so the page loader,
// admin route, and call-time endpoints stay in sync).
export const VOICE_RECEPTIONIST_COLUMNS =
  'company_id, enabled, level, receptionist_name, greeting, greeting_business_hours, greeting_after_hours, instructions, voice_id, recap_text_enabled, updated_at, updated_by'

export type EffectiveVoiceReceptionistSettings = {
  enabled: boolean
  /** The admin-chosen level (1–4) after the plan cap, before implementation clamping. */
  level: ReceptionistLevel
  /** The level actually driving behavior (level 4 clamps to 3 until built). */
  effectiveLevel: 1 | 2 | 3
  /** Persona name spoken to callers. */
  receptionistName: string
  /** Greeting for a call during business hours (team busy with others). */
  greetingBusinessHours: string
  /** Greeting for a call outside business hours (team unavailable). */
  greetingAfterHours: string
  /** Back-compat single greeting == greetingAfterHours (the primary trigger today). */
  greeting: string
  instructions: string
  voiceId: string
  /** Whether the assistant offers + we send an end-of-call recap text. */
  recapTextEnabled: boolean
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
 * call-time endpoints and the AI admin page already create.
 */
export async function getVoiceReceptionistSettings(
  admin: SupabaseClient,
  companyId: string
): Promise<VoiceReceptionistSettingsRow | null> {
  const { data } = await admin
    .from('voice_receptionist_settings')
    .select(VOICE_RECEPTIONIST_COLUMNS)
    .eq('company_id', companyId)
    .maybeSingle()
  return (data as VoiceReceptionistSettingsRow | null) ?? null
}

/**
 * Resolve the EFFECTIVE settings from a row (or null), applying per-field
 * fallbacks:
 *   level         -> min(row.level ?? 2, plan cap); behavior additionally
 *                    clamps to the highest implemented level (4 -> 3 for now)
 *   receptionistName          -> row.receptionist_name?.trim() || 'Amber'
 *   greetingAfterHours        -> row.greeting_after_hours || row.greeting (legacy)
 *                                 || buildWelcomeGreeting(level, after_hours)
 *   greetingBusinessHours     -> row.greeting_business_hours
 *                                 || buildWelcomeGreeting(level, business_hours)
 *   instructions  -> row.instructions?.trim() || buildVoiceReceptionistPrompt(level, {name, recap})
 *   voiceId       -> row.voice_id?.trim()     || process.env.VOICE_ELEVENLABS_VOICE_ID
 *   recapTextEnabled -> row.recap_text_enabled !== false (default true)
 *   enabled       -> row.enabled  (when a row exists)
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
  const receptionistName = row?.receptionist_name?.trim() || DEFAULT_RECEPTIONIST_NAME
  const recapTextEnabled = row ? row.recap_text_enabled !== false : true

  const greetingAfterHours =
    row?.greeting_after_hours?.trim() ||
    row?.greeting?.trim() || // legacy single-greeting column
    buildWelcomeGreeting(effectiveLevel, { context: 'after_hours', name: receptionistName })
  const greetingBusinessHours =
    row?.greeting_business_hours?.trim() ||
    buildWelcomeGreeting(effectiveLevel, { context: 'business_hours', name: receptionistName })

  return {
    enabled: row ? row.enabled : true,
    level: chosen,
    effectiveLevel,
    receptionistName,
    greetingBusinessHours,
    greetingAfterHours,
    greeting: greetingAfterHours,
    instructions:
      row?.instructions?.trim() ||
      buildVoiceReceptionistPrompt(effectiveLevel, { name: receptionistName, recapEnabled: recapTextEnabled }),
    voiceId: row?.voice_id?.trim() || process.env.VOICE_ELEVENLABS_VOICE_ID || '',
    recapTextEnabled,
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
