import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// PUT /api/contacts/:id/tags — replaces the entire set of tag assignments
// for this contact with the provided list. Open to any Hub user with access
// to the contact (RLS-gated); tag CRUD is admin-only via the separate
// /api/admin/contact-tags routes.
export async function PUT(
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

  // Confirm caller can see this contact (and it's same company)
  const { data: target } = await supabase
    .from('txt_contacts')
    .select('id, company_id')
    .eq('id', id)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (target.company_id !== profile.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const requested: string[] = Array.isArray(body.tag_ids)
    ? body.tag_ids.filter((x: unknown) => typeof x === 'string')
    : []

  const admin = createAdminClient()

  // Validate requested tags belong to caller's company — drop forgeries silently.
  let validIds: string[] = []
  if (requested.length > 0) {
    const { data: validTags } = await admin
      .from('contact_tags')
      .select('id')
      .eq('company_id', profile.company_id)
      .in('id', requested)
    validIds = (validTags ?? []).map(t => t.id)
  }

  // Replace-set semantics: delete current assignments, insert new ones. Doing
  // this as two queries (not a transaction) is fine — the window where a
  // contact has zero tags is sub-millisecond and no consumer cares.
  await admin.from('contact_tag_assignments').delete().eq('contact_id', id)

  if (validIds.length > 0) {
    const { error } = await admin
      .from('contact_tag_assignments')
      .insert(validIds.map(tag_id => ({ contact_id: id, tag_id, assigned_by: user.id })))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, tag_ids: validIds })
}
