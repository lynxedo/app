import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/contacts/:id/archive   body: { archived: boolean }
// Manual contact archive — hides the contact from the active directory (reversible).
// archived:true → archived_at = now(); archived:false → null (unarchive). Distinct
// from delete (deleted_at). Gate mirrors the edit/delete routes: auth → company match.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const archived = body.archived === true

  const { data: target } = await supabase
    .from('txt_contacts')
    .select('id, company_id')
    .eq('id', id)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (target.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('txt_contacts')
    .update({ archived_at: archived ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, archived })
}
