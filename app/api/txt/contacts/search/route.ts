import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { callHeroesTool } from '@/lib/hub-claude'
import { requireTxtUser } from '@/lib/txt-permissions'

// The company the legacy Heroes MCP (callHeroesTool) belongs to.
const HEROES_COMPANY_ID = '00000000-0000-0000-0000-000000000002'

// Search Jobber via Heroes MCP. Returns parsed clients.
function parseJobberClients(
  text: string
): Array<{ id: string; name: string; phone?: string; email?: string }> {
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

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const txtAuth = await requireTxtUser(supabase, user.id)
  if ('error' in txtAuth) return txtAuth.error
  // Searches through the legacy Heroes-only Jobber MCP — so only Heroes' own Txt
  // users may reach it. Every other company gets no Jobber results (never Heroes'
  // clients) until a per-tenant Jobber search exists.
  if (txtAuth.companyId !== HEROES_COMPANY_ID) return NextResponse.json({ results: [] })

  const url = new URL(request.url)
  const q = (url.searchParams.get('q') || '').trim()
  if (!q) return NextResponse.json({ results: [] })

  let raw = ''
  try {
    raw = await callHeroesTool('search_clients', { search_term: q, limit: 25 })
  } catch (e) {
    return NextResponse.json(
      { error: `MCP call failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    )
  }

  const results = parseJobberClients(raw).filter((c) => c.phone)
  return NextResponse.json({ results })
}
