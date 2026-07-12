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
  DEFAULT_TITLE_SERVICE_MAP,
  buildVoiceReceptionistPrompt,
  buildWelcomeGreeting,
  clampReceptionistLevel,
  type ReceptionistLevel,
  type TitleServiceRule,
} from '@/lib/voice-receptionist'

// How Amber reaches a live person for a business-hours transfer.
//   off       — transfers disabled (take a message / voicemail only)
//   softphone — ring the transfer-list users' Dialer softphones
//   cell      — ring their cell (from user_profiles.phone) with a press-1 screen
//   dm        — park the caller; Hub DM/push the users; whoever accepts is bridged
export type TransferMethod = 'off' | 'cell' | 'softphone' | 'dm'

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
  transfer_method: string | null
  transfer_user_ids: string[] | null
  transfer_cell_numbers: Record<string, string> | null
  title_service_map: TitleServiceRule[] | null
  updated_at: string
  updated_by: string | null
}

// Columns to select for the settings row (kept in one place so the page loader,
// admin route, and call-time endpoints stay in sync).
export const VOICE_RECEPTIONIST_COLUMNS =
  'company_id, enabled, level, receptionist_name, greeting, greeting_business_hours, greeting_after_hours, instructions, voice_id, recap_text_enabled, transfer_method, transfer_user_ids, transfer_cell_numbers, title_service_map, updated_at, updated_by'

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
  /** How Amber reaches a live person for a transfer ('off' disables it). */
  transferMethod: TransferMethod
  /** Hub user ids that receive transfer attempts. */
  transferUserIds: string[]
  /** For the 'cell' method: map of Hub user id -> the E.164 cell to ring. */
  transferCellNumbers: Record<string, string>
  /** Configurable rules mapping a Jobber visit-title code -> a spoken service phrase. */
  titleServiceMap: TitleServiceRule[]
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
    transferMethod: (['off', 'cell', 'softphone', 'dm'].includes(row?.transfer_method || '')
      ? (row!.transfer_method as TransferMethod)
      : 'off'),
    transferUserIds: Array.isArray(row?.transfer_user_ids) ? row!.transfer_user_ids : [],
    transferCellNumbers: normalizeCellNumberMap(row?.transfer_cell_numbers),
    titleServiceMap: normalizeTitleServiceMap(row?.title_service_map),
  }
}

/** Coerce the stored title_service_map jsonb into clean {match, say} rules,
 *  dropping malformed entries. Falls back to the built-in default when the row
 *  has no usable rules — so the receptionist always has a service vocabulary. */
function normalizeTitleServiceMap(raw: unknown): TitleServiceRule[] {
  if (!Array.isArray(raw)) return DEFAULT_TITLE_SERVICE_MAP
  const rules = raw
    .map((r) => {
      const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
      return {
        match: typeof o.match === 'string' ? o.match.trim() : '',
        say: typeof o.say === 'string' ? o.say.trim() : '',
      }
    })
    .filter((r) => r.match && r.say)
  return rules.length ? rules : DEFAULT_TITLE_SERVICE_MAP
}

/** Coerce the stored transfer_cell_numbers jsonb into a clean { userId: E.164 }
 *  map — keep only string keys with non-empty string values. */
function normalizeCellNumberMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  return out
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

/**
 * The company's configured voicemail greeting (recorded audio takes priority
 * over typed TTS), read from dialer_settings. Lets the receptionist's voicemail
 * play the SAME greeting as a normal missed call instead of a robotic default.
 */
export async function getCompanyVoicemailGreeting(
  admin: SupabaseClient,
  companyId: string,
): Promise<{ url: string | null; tts: string | null }> {
  try {
    const { data } = await admin
      .from('dialer_settings')
      .select('fallback_voicemail_url, fallback_voicemail_tts')
      .eq('company_id', companyId)
      .maybeSingle()
    const url = typeof data?.fallback_voicemail_url === 'string' ? data.fallback_voicemail_url.trim() : ''
    const tts = typeof data?.fallback_voicemail_tts === 'string' ? data.fallback_voicemail_tts.trim() : ''
    return { url: url || null, tts: tts || null }
  } catch {
    return { url: null, tts: null }
  }
}
