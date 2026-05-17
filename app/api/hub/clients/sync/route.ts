import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { callHeroesTool } from '@/lib/hub-claude'

// Admin-only: search Jobber for clients and upsert into hub_contacts
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  if (profile.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const searchTerm = (body.search ?? '').trim()

  // Call Jobber via MCP to get clients
  let rawResult = ''
  try {
    rawResult = await callHeroesTool('search_clients', { searchTerm, first: 50 })
  } catch (e) {
    return NextResponse.json({ error: `MCP call failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }

  // MCP returns text — parse JSON if possible, otherwise return raw
  let clients: Array<{ id: string; name: string; phone?: string; email?: string }> = []
  try {
    const parsed = JSON.parse(rawResult)
    // search_clients returns { clients: [...] } or array directly
    clients = Array.isArray(parsed) ? parsed : (parsed.clients ?? parsed.nodes ?? [])
  } catch {
    return NextResponse.json({ error: 'Could not parse Jobber response', raw: rawResult }, { status: 502 })
  }

  // Filter clients that have a phone number
  const withPhone = clients.filter(c => c.phone)

  if (withPhone.length === 0) {
    return NextResponse.json({ synced: 0, skipped: clients.length, message: 'No clients with phone numbers found' })
  }

  const admin = createAdminClient()
  let synced = 0
  let failed = 0

  for (const client of withPhone) {
    const normalizedPhone = client.phone!.replace(/\D/g, '')
    const { error } = await admin
      .from('hub_contacts')
      .upsert({
        company_id: profile.company_id,
        jobber_client_id: client.id,
        name: client.name,
        phone: normalizedPhone,
        email: client.email ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'company_id,phone' })

    if (error) { failed++ } else { synced++ }
  }

  return NextResponse.json({
    synced,
    failed,
    skipped: clients.length - withPhone.length,
    total: clients.length,
  })
}
