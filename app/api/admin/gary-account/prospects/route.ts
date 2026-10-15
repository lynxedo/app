import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { getGarySettings, saveGarySettings } from '@/lib/gary'
import { PROSPECT_COLUMNS, findApartments, importHoas, prospectCities, readCertificates } from '@/lib/gary-prospects'

// Admin → AI → Gary's account → Prospects (session 5). Finding commercial
// prospects from free sources; nothing here contacts anyone.

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function guard() {
  const auth = await requireAdminArea('ai')
  if (!auth.ok || !auth.company_id || !auth.user) return null
  return { companyId: auth.company_id, userId: auth.user.id }
}

export async function GET() {
  const g = await guard()
  if (!g) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createAdminClient()
  const settings = await getGarySettings(admin, g.companyId)
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('gary_prospects')
      .select(PROSPECT_COLUMNS)
      .eq('company_id', g.companyId)
      .order('name')
      .range(from, from + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    rows.push(...((data ?? []) as Record<string, unknown>[]))
    if (!data || data.length < 1000) break
  }
  const cities = await prospectCities(admin, g.companyId, settings.prospectZips)
  return NextResponse.json({ zips: settings.prospectZips, cities, prospects: rows })
}

export async function POST(request: Request) {
  const g = await guard()
  if (!g) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => null)) as {
    action?: string
    count?: unknown
    city?: unknown
    id?: unknown
    status?: unknown
    zips?: unknown
  } | null
  const admin = createAdminClient()
  try {
    switch (body?.action) {
      case 'import_hoas':
        return NextResponse.json(await importHoas(admin, g.companyId))
      case 'read_certificates':
        return NextResponse.json(await readCertificates(admin, g.companyId, Number(body.count) || 10))
      case 'find_apartments':
        return NextResponse.json(await findApartments(admin, g.companyId, typeof body.city === 'string' ? body.city : ''))
      case 'set_status': {
        const status = body.status === 'not_a_fit' ? 'not_a_fit' : 'new'
        if (typeof body.id !== 'string') return NextResponse.json({ error: 'id required' }, { status: 400 })
        const { data: row } = await admin.from('gary_prospects').select('researched_at, research_error').eq('id', body.id).eq('company_id', g.companyId).maybeSingle()
        if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
        // Back from "not a fit" → "researched" when Gary already read it.
        const next = status === 'not_a_fit' ? 'not_a_fit' : row.researched_at && !row.research_error ? 'researched' : 'new'
        await admin.from('gary_prospects').update({ status: next, updated_at: new Date().toISOString() }).eq('id', body.id).eq('company_id', g.companyId)
        return NextResponse.json({ ok: true, status: next })
      }
      case 'set_zips':
        await saveGarySettings(admin, g.companyId, g.userId, { prospectZips: body.zips })
        return NextResponse.json({ ok: true })
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) {
    console.error('[gary-prospects] action failed', body?.action, e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'That didn’t work just now.' }, { status: 500 })
  }
}
