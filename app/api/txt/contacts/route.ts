import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// GET /api/txt/contacts?search=...&limit=200&include_do_not_text=0
//
// Lists txt_contacts for the caller's company. Used by the broadcast and
// group-conversation composers. By default excludes do_not_text contacts
// — pass include_do_not_text=1 to see them (admin contact-management
// contexts use this).
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const search = (url.searchParams.get('search') || '').trim()
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1000)
  const includeBlocked = url.searchParams.get('include_do_not_text') === '1'

  let query = supabase
    .from('txt_contacts')
    .select('id, name, phone, email, do_not_text, notes, jobber_client_id')
    .eq('company_id', HEROES_COMPANY_ID)
    .order('name', { ascending: true })
    .limit(limit)

  if (!includeBlocked) query = query.eq('do_not_text', false)
  if (search) {
    const pattern = `%${search.replace(/[%_]/g, '\\$&')}%`
    query = query.or(`name.ilike.${pattern},phone.ilike.${pattern}`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ contacts: data ?? [] })
}
