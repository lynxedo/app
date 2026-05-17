import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { callHeroesTool } from '@/lib/hub-claude'

function parseJobberClients(text: string): Array<{ id: string; name: string; phone?: string; email?: string }> {
  const clients: Array<{ id: string; name: string; phone?: string; email?: string }> = []
  const blocks = text.split(/\n(?=\d+\. )/)
  for (const block of blocks) {
    const nameMatch = block.match(/^\d+\.\s+(.+)/)
    if (!nameMatch) continue
    const name = nameMatch[1].trim()
    const id = block.match(/Client ID\s*:\s*(.+)/)?.[1]?.trim() ?? ''
    const email = block.match(/Email\s*:\s*(.+)/)?.[1]?.trim()
    const phone = block.match(/Phone\s*:\s*(.+)/)?.[1]?.trim()
    if (name) clients.push({ id, name, phone, email })
  }
  return clients
}

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

  // Call Jobber via MCP — search_term: '' returns all clients, limit: 500 gets them in one shot
  let rawResult = ''
  try {
    rawResult = await callHeroesTool('search_clients', { search_term: searchTerm, limit: 500 })
  } catch (e) {
    return NextResponse.json({ error: `MCP call failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }

  // MCP returns formatted text — parse it with regex
  const clients = parseJobberClients(rawResult)

  if (clients.length === 0) {
    return NextResponse.json({ synced: 0, skipped: 0, total: 0, message: 'No clients found in Jobber response', raw: rawResult.slice(0, 500) })
  }

  // Filter clients that have a phone number
  const withPhone = clients.filter(c => c.phone)

  if (withPhone.length === 0) {
    return NextResponse.json({ synced: 0, skipped: clients.length, total: clients.length, message: 'No clients with phone numbers found' })
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
