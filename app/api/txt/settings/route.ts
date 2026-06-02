import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const HEROES_COMPANY_ID =
  process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

// GET /api/txt/settings
// Returns company-level Txt settings the composer needs (currently just the
// On-My-Way template). Any logged-in company member can read; RLS on
// txt_settings scopes the row to the caller's company.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('txt_settings')
    .select('on_my_way_template')
    .eq('company_id', HEROES_COMPANY_ID)
    .maybeSingle()

  return NextResponse.json({ on_my_way_template: data?.on_my_way_template ?? null })
}
