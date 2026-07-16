import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { validateVoiceDropKey } from '@/lib/voicedrop'

export const dynamic = 'force-dynamic'

// Per-tenant VoiceDrop API key (ringless voicemail for Drip Marketing). The
// subscriber pastes their own key; it's validated against VoiceDrop, then stored
// on company_integrations (config, service-role only) so lib/voicedrop.ts
// resolves it per company. Clone of the OneStepGPS key route — same shape, same
// company_integrations upsert on (company_id, provider).

export async function POST(request: Request) {
  const check = await requireAdminArea('integrations')
  if (!check.ok || !check.user || !check.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = (await request.json().catch(() => ({}))) as { action?: string; api_key?: string }
  const admin = createAdminClient()

  if (body.action === 'clear') {
    await admin.from('company_integrations').upsert(
      {
        company_id: check.company_id,
        provider: 'voicedrop',
        status: 'not_connected',
        enabled: false,
        config: {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,provider' },
    )
    return NextResponse.json({ ok: true, status: 'not_connected' })
  }

  if (body.action === 'save') {
    const key = (body.api_key ?? '').trim()
    if (!key) return NextResponse.json({ error: 'Enter your VoiceDrop API key.' }, { status: 400 })

    // Validate the key by calling VoiceDrop with it before we store it.
    const check2 = await validateVoiceDropKey(key)
    if (!check2.reachable) {
      return NextResponse.json(
        { error: 'Could not reach VoiceDrop to verify the key. Try again in a moment.' },
        { status: 502 },
      )
    }
    if (!check2.ok) {
      return NextResponse.json(
        { error: `VoiceDrop rejected that key (${check2.status ?? 'invalid'}). Double-check it and try again.` },
        { status: 400 },
      )
    }

    await admin.from('company_integrations').upsert(
      {
        company_id: check.company_id,
        provider: 'voicedrop',
        status: 'connected',
        enabled: true,
        config: { api_key: key, api_key_prefix: key.slice(0, 6) + '…' },
        connected_by: check.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,provider' },
    )
    return NextResponse.json({ ok: true, status: 'connected' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
