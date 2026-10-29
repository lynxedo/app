import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { companyIdForUser } from '@/lib/company-auth'

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
  const companyId = await companyIdForUser(supabase, user.id)
  if (!companyId) return NextResponse.json({ error: 'No company' }, { status: 403 })

  const { data } = await supabase
    .from('txt_settings')
    .select('on_my_way_template')
    .eq('company_id', companyId)
    .maybeSingle()

  return NextResponse.json({ on_my_way_template: data?.on_my_way_template ?? null })
}
