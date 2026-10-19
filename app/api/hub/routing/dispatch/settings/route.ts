import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { geocodeAddress } from '@/lib/geocode'
import { normalizeDispatchSettings } from '@/lib/dispatch'

// Admin → Routing → Dispatch. Read by anyone with Routing; written only by the
// same people who can edit the rest of Routing settings (admin role or
// can_admin_routing — see app/api/admin/routing-settings).
//
// The depot and service minutes are NOT here: Dispatch reuses the Route
// Optimizer's own (company_routing_settings depot_* + duration_rules), so the
// two tools can never disagree about where the shop is or how long a stop takes.

async function canAdminRouting(auth: { role: string | null; userId: string; supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>> }): Promise<boolean> {
  if (auth.role === 'admin') return true
  const { data } = await auth.supabase.from('user_profiles').select('can_admin_routing').eq('id', auth.userId).maybeSingle()
  return data?.can_admin_routing === true
}

export async function GET() {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const admin = createAdminClient()
  const [{ data: s }, { data: techs }] = await Promise.all([
    admin.from('company_routing_settings').select('depot_address, dispatch_settings').eq('company_id', auth.companyId).maybeSingle(),
    admin.from('dispatch_tech_settings').select('*').eq('company_id', auth.companyId),
  ])
  return NextResponse.json({
    settings: normalizeDispatchSettings(s?.dispatch_settings),
    depotAddress: (s?.depot_address as string | null) ?? null,
    techSettings: techs ?? [],
    canEdit: await canAdminRouting(auth),
  })
}

interface TechInput {
  jobber_user_id: string
  start_kind: 'depot' | 'address'
  start_address?: string | null
  end_kind: 'depot' | 'address'
  end_address?: string | null
}

export async function PUT(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  if (!(await canAdminRouting(auth))) return NextResponse.json({ error: 'Only routing admins can change Dispatch settings' }, { status: 403 })
  const { companyId, userId } = auth

  const body = await request.json().catch(() => null) as { settings?: unknown; tech?: TechInput; removeTech?: string } | null
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const admin = createAdminClient()

  if (body.settings !== undefined) {
    const settings = normalizeDispatchSettings(body.settings)
    const { error } = await admin.from('company_routing_settings')
      .upsert({ company_id: companyId, dispatch_settings: settings, updated_at: new Date().toISOString(), updated_by: userId }, { onConflict: 'company_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ settings })
  }

  if (body.removeTech) {
    await admin.from('dispatch_tech_settings').delete().eq('company_id', companyId).eq('jobber_user_id', body.removeTech)
    return NextResponse.json({ ok: true })
  }

  if (body.tech?.jobber_user_id) {
    const t = body.tech
    const geo = async (kind: string, addr?: string | null) => {
      if (kind !== 'address') return { address: null, lat: null, lng: null }
      const a = (addr ?? '').trim()
      if (!a) throw new Error('Enter an address, or choose the shop')
      const c = await geocodeAddress(a)
      if (!c) throw new Error(`Couldn't find "${a}" on the map`)
      return { address: a, lat: c.lat, lng: c.lng }
    }
    try {
      const [st, en] = await Promise.all([geo(t.start_kind, t.start_address), geo(t.end_kind, t.end_address)])
      const { data, error } = await admin.from('dispatch_tech_settings').upsert({
        company_id: companyId,
        jobber_user_id: t.jobber_user_id,
        start_kind: t.start_kind === 'address' ? 'address' : 'depot',
        start_address: st.address, start_lat: st.lat, start_lng: st.lng,
        end_kind: t.end_kind === 'address' ? 'address' : 'depot',
        end_address: en.address, end_lat: en.lat, end_lng: en.lng,
        updated_by: userId, updated_at: new Date().toISOString(),
      }, { onConflict: 'company_id,jobber_user_id' }).select('*').single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ tech: data })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not save' }, { status: 400 })
    }
  }

  return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })
}
