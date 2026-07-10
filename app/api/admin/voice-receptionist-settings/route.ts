import { NextRequest, NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  MAX_IMPLEMENTED_LEVEL,
  buildVoiceReceptionistPrompt,
  buildWelcomeGreeting,
} from '@/lib/voice-receptionist'
import {
  getPlanMaxReceptionistLevel,
  getVoiceReceptionistSettings,
  resolveVoiceReceptionistSettings,
} from '@/lib/voice-receptionist-settings'

// Admin editor for the AI Voice Receptionist's greeting, behavior instructions
// (prompt), voice, and on/off toggle. Gated identically to the Responder /
// Dialer admin routes (requireAdminArea('dialer')). Mirrors that GET/upsert
// shape; all reads/writes use the service-role admin client.

// Trim a text input; treat an empty string as NULL so the call-time resolver
// falls back to the code default for that field.
function normalizeText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function GET() {
  const auth = await requireAdminArea('dialer')
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
    greeting: row?.greeting ?? '',
    instructions: row?.instructions ?? '',
    voice_id: row?.voice_id ?? '',
    greeting_default: buildWelcomeGreeting(effective.effectiveLevel),
    instructions_default: buildVoiceReceptionistPrompt(effective.effectiveLevel),
    voice_id_default: process.env.VOICE_ELEVENLABS_VOICE_ID || '',
    effective,
  })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminArea('dialer')
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
    // Level 4 (full receptionist / live scheduling) isn't built yet.
    if (lvl > MAX_IMPLEMENTED_LEVEL) {
      return NextResponse.json({ error: 'Level 4 is coming soon' }, { status: 400 })
    }
    const cap = getPlanMaxReceptionistLevel(auth.company_id!)
    if (lvl > cap) {
      return NextResponse.json({ error: `Your plan allows up to level ${cap}` }, { status: 400 })
    }
    update.level = lvl
  }
  if ('greeting' in body) update.greeting = normalizeText(body.greeting)
  if ('instructions' in body) update.instructions = normalizeText(body.instructions)
  if ('voice_id' in body) update.voice_id = normalizeText(body.voice_id)

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('voice_receptionist_settings')
    .upsert(update, { onConflict: 'company_id' })
    .select('company_id, enabled, level, greeting, instructions, voice_id, updated_at, updated_by')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    settings: data,
    effective: resolveVoiceReceptionistSettings(data, getPlanMaxReceptionistLevel(auth.company_id!)),
  })
}
