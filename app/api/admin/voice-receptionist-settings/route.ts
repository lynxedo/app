import { NextRequest, NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/phone'
import {
  DEFAULT_RECEPTIONIST_NAME,
  DEFAULT_TITLE_SERVICE_MAP,
  MAX_SELECTABLE_LEVEL,
  buildVoiceReceptionistPrompt,
  buildWelcomeGreeting,
} from '@/lib/voice-receptionist'
import {
  VOICE_RECEPTIONIST_COLUMNS,
  getPlanMaxReceptionistLevel,
  getVoiceReceptionistSettings,
  resolveVoiceReceptionistSettings,
} from '@/lib/voice-receptionist-settings'

// Admin editor for the AI Voice Receptionist's greeting, behavior instructions
// (prompt), voice, and on/off toggle. Gated identically to the Responder /
// AI admin routes (requireAdminArea('ai')). Mirrors that GET/upsert
// shape; all reads/writes use the service-role admin client.

// Trim a text input; treat an empty string as NULL so the call-time resolver
// falls back to the code default for that field.
function normalizeText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function GET() {
  const auth = await requireAdminArea('ai')
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const admin = createAdminClient()
  const row = await getVoiceReceptionistSettings(admin, auth.company_id!)
  const planMaxLevel = getPlanMaxReceptionistLevel(auth.company_id!)
  const effective = resolveVoiceReceptionistSettings(row, planMaxLevel)

  // Return the stored values for the form (empty string when unset so the
  // textareas show their placeholder), the code/env defaults used as placeholders
  // + call-time fallbacks, and the fully-resolved effective values. No row is
  // created here — a GET stays side-effect free; the first PATCH upserts one.
  return NextResponse.json({
    enabled: effective.enabled,
    level: effective.level,
    plan_max_level: planMaxLevel,
    receptionist_name: row?.receptionist_name ?? '',
    greeting_business_hours: row?.greeting_business_hours ?? '',
    greeting_after_hours: row?.greeting_after_hours ?? row?.greeting ?? '',
    instructions: row?.instructions ?? '',
    voice_id: row?.voice_id ?? '',
    recap_text_enabled: effective.recapTextEnabled,
    transfer_method: effective.transferMethod,
    transfer_user_ids: effective.transferUserIds,
    transfer_cell_numbers: effective.transferCellNumbers,
    title_service_map: effective.titleServiceMap,
    title_service_map_default: DEFAULT_TITLE_SERVICE_MAP,
    receptionist_name_default: DEFAULT_RECEPTIONIST_NAME,
    greeting_business_hours_default: buildWelcomeGreeting(effective.effectiveLevel, {
      context: 'business_hours',
      name: effective.receptionistName,
    }),
    greeting_after_hours_default: buildWelcomeGreeting(effective.effectiveLevel, {
      context: 'after_hours',
      name: effective.receptionistName,
    }),
    instructions_default: buildVoiceReceptionistPrompt(effective.effectiveLevel, {
      name: effective.receptionistName,
      recapEnabled: effective.recapTextEnabled,
    }),
    voice_id_default: process.env.VOICE_ELEVENLABS_VOICE_ID || '',
    effective,
  })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminArea('ai')
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))

  const update: Record<string, unknown> = {
    company_id: auth.company_id,
    updated_at: new Date().toISOString(),
    updated_by: auth.user?.id ?? null,
  }
  if ('enabled' in body) update.enabled = Boolean(body.enabled)
  if ('level' in body) {
    const lvl = Number(body.level)
    if (!Number.isInteger(lvl) || lvl < 1 || lvl > 4) {
      return NextResponse.json({ error: 'level must be 1–4' }, { status: 400 })
    }
    if (lvl > MAX_SELECTABLE_LEVEL) {
      return NextResponse.json({ error: `level must be 1–${MAX_SELECTABLE_LEVEL}` }, { status: 400 })
    }
    const cap = getPlanMaxReceptionistLevel(auth.company_id!)
    if (lvl > cap) {
      return NextResponse.json({ error: `Your plan allows up to level ${cap}` }, { status: 400 })
    }
    update.level = lvl
  }
  if ('receptionist_name' in body) update.receptionist_name = normalizeText(body.receptionist_name)
  if ('greeting_business_hours' in body) update.greeting_business_hours = normalizeText(body.greeting_business_hours)
  if ('greeting_after_hours' in body) update.greeting_after_hours = normalizeText(body.greeting_after_hours)
  if ('greeting' in body) update.greeting = normalizeText(body.greeting) // legacy single greeting
  if ('instructions' in body) update.instructions = normalizeText(body.instructions)
  if ('voice_id' in body) update.voice_id = normalizeText(body.voice_id)
  if ('recap_text_enabled' in body) update.recap_text_enabled = Boolean(body.recap_text_enabled)
  if ('transfer_method' in body) {
    const m = String(body.transfer_method || 'off')
    if (!['off', 'cell', 'softphone', 'dm'].includes(m)) {
      return NextResponse.json({ error: 'invalid transfer method' }, { status: 400 })
    }
    update.transfer_method = m
  }
  if ('transfer_user_ids' in body) {
    const ids = Array.isArray(body.transfer_user_ids) ? body.transfer_user_ids : []
    update.transfer_user_ids = ids.filter(
      (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x),
    )
  }
  // Per-recipient cell numbers for the 'cell' transfer method — a map of
  // { hub_user_id: cell }. Keep only uuid keys whose value normalizes to a valid
  // E.164 number; a blank/invalid entry is dropped (that recipient just isn't
  // dialed). Never throws on junk input.
  if ('transfer_cell_numbers' in body) {
    const raw = body.transfer_cell_numbers
    const clean: Record<string, string> = {}
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (!/^[0-9a-f-]{36}$/i.test(k)) continue
        const e164 = typeof v === 'string' ? toE164(v) : null
        if (e164) clean[k] = e164
      }
    }
    update.transfer_cell_numbers = clean
  }
  // Editable Jobber-title → spoken-service map. Keep only rows with both a code
  // and a phrase; store NULL when empty so the resolver falls back to the code
  // default (the receptionist always has a service vocabulary).
  if ('title_service_map' in body) {
    const raw = Array.isArray(body.title_service_map) ? body.title_service_map : []
    const rules = raw
      .map((r: unknown) => {
        const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
        return {
          match: typeof o.match === 'string' ? o.match.trim() : '',
          say: typeof o.say === 'string' ? o.say.trim() : '',
        }
      })
      .filter((r: { match: string; say: string }) => r.match && r.say)
    update.title_service_map = rules.length ? rules : null
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('voice_receptionist_settings')
    .upsert(update, { onConflict: 'company_id' })
    .select(VOICE_RECEPTIONIST_COLUMNS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    settings: data,
    effective: resolveVoiceReceptionistSettings(data, getPlanMaxReceptionistLevel(auth.company_id!)),
  })
}
