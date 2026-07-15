import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

// Per-tenant OneStepGPS API key. The subscriber pastes their own key; it's
// validated against OneStepGPS, then stored on company_integrations (config,
// service-role only) so lib/onestepgps.ts resolves it per company. Heroes (no
// row) keeps using the shared env key.
const ONESTEP_ENDPOINT = 'https://track.onestepgps.com/v3/api/public/device'

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
        provider: 'onestepgps',
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
    if (!key) return NextResponse.json({ error: 'Enter your OneStepGPS API key.' }, { status: 400 })

    // Validate the key by calling OneStepGPS with it before we store it.
    try {
      const res = await fetch(
        `${ONESTEP_ENDPOINT}?api-key=${encodeURIComponent(key)}&latest_point=true`,
        { cache: 'no-store', signal: AbortSignal.timeout(10000) },
      )
      if (!res.ok) {
        return NextResponse.json(
          { error: `OneStepGPS rejected that key (${res.status}). Double-check it and try again.` },
          { status: 400 },
        )
      }
    } catch {
      return NextResponse.json(
        { error: 'Could not reach OneStepGPS to verify the key. Try again in a moment.' },
        { status: 502 },
      )
    }

    await admin.from('company_integrations').upsert(
      {
        company_id: check.company_id,
        provider: 'onestepgps',
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
