import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { validateRachioKey } from '@/lib/rachio'

export const dynamic = 'force-dynamic'

// Per-company Rachio API key (Import from Rachio on the irrigation inspection).
// The admin pastes the key; it's checked against Rachio, then stored on
// company_integrations (config, service-role only). Same shape as the
// VoiceDrop / OneStepGPS key routes.

export async function POST(request: Request) {
  const check = await requireAdminArea('integrations')
  if (!check.ok || !check.user || !check.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = (await request.json().catch(() => ({}))) as { action?: string; api_key?: string }
  const admin = createAdminClient()

  if (body.action === 'clear') {
    await admin.from('company_integrations').upsert(
      { company_id: check.company_id, provider: 'rachio', status: 'not_connected', enabled: false, config: {}, updated_at: new Date().toISOString() },
      { onConflict: 'company_id,provider' },
    )
    return NextResponse.json({ ok: true, status: 'not_connected' })
  }

  if (body.action === 'save') {
    const key = (body.api_key ?? '').trim()
    if (!key) return NextResponse.json({ error: 'Enter your Rachio API key.' }, { status: 400 })
    const v = await validateRachioKey(key)
    if (!v.reachable) return NextResponse.json({ error: 'Could not reach Rachio to verify the key. Try again in a moment.' }, { status: 502 })
    if (!v.ok) return NextResponse.json({ error: `Rachio rejected that key (${v.status ?? 'invalid'}). Double-check it and try again.` }, { status: 400 })
    await admin.from('company_integrations').upsert(
      {
        company_id: check.company_id,
        provider: 'rachio',
        status: 'connected',
        enabled: true,
        config: { api_key: key, api_key_prefix: key.slice(0, 6) + '…', account: v.account ?? null },
        connected_by: check.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,provider' },
    )
    return NextResponse.json({ ok: true, status: 'connected' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
