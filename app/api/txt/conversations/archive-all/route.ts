import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/txt/conversations/archive-all
//
// Per-user BULK archive: archives every active conversation the caller currently
// OWNS (assigned_to = them) — and ONLY those. Threads they merely collaborate on
// (a member row, not owner) or don't touch at all are left untouched.
//
// Mirrors the per-thread archive route's "fresh start" behavior: each archived
// thread has its owner cleared (assigned_to → null) and all member rows removed,
// so when the customer texts back it reopens clean in the Queue rather than
// carrying the old owner forward (see the archive route + the inbound webhook
// reopen path).
//
// Body: { preview: true } → returns { count } WITHOUT writing (drives the
// confirm-with-count dialog). Default → archives and returns { archived }.
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const preview: boolean = body.preview === true

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, can_admin_txt, can_assign_txt_threads, can_access_txt, company_id')
    .eq('id', user.id)
    .single()
  const isManager =
    profile?.role === 'admin' ||
    profile?.can_admin_txt === true ||
    profile?.can_assign_txt_threads === true
  const isTxtUser = isManager || profile?.can_access_txt === true
  if (!isTxtUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const companyId = profile?.company_id
  if (!companyId) return NextResponse.json({ error: 'No company' }, { status: 400 })

  const admin = createAdminClient()

  // Conversations the caller OWNS that are still active. assigned_to is the cached
  // owner pointer (kept in sync with the single role='owner' member row); scoped to
  // the caller's own company as a safety belt even though the pointer is enough.
  const { data: owned, error: findErr } = await admin
    .from('txt_conversations')
    .select('id')
    .eq('company_id', companyId)
    .eq('assigned_to', user.id)
    .neq('status', 'archived')
  if (findErr) {
    return NextResponse.json({ error: findErr.message }, { status: 500 })
  }

  const ids = (owned ?? []).map((c) => c.id)
  if (preview) return NextResponse.json({ count: ids.length })
  if (ids.length === 0) return NextResponse.json({ ok: true, archived: 0 })

  // Fresh-start archive in batches (a busy owner can hold hundreds of threads, and
  // PostgREST `.in()` lives in the URL): hide the thread, record who archived it,
  // clear the owner, then drop every member off so a reopen starts clean.
  const CHUNK = 100
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK)
    const { error: updErr } = await admin
      .from('txt_conversations')
      .update({ status: 'archived', archived_by: user.id, assigned_to: null })
      .in('id', batch)
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }
    const { error: delErr } = await admin
      .from('txt_conversation_members')
      .delete()
      .in('conversation_id', batch)
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, archived: ids.length })
}
