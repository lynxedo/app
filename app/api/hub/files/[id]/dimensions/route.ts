import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Lazy backfill of image dimensions. Called by FileAttachment's onImgLoad
// for legacy rows (uploaded before Session 47 image-dims shipped) where
// width_px/height_px are null. Idempotent: only writes when the existing
// row has null dimensions AND the caller has SELECT access (same-company).
// Uses the admin client for the write because the user-session client
// might be RLS-blocked from updating files rows depending on policy.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const body = await request.json().catch(() => null) as { width_px?: unknown; height_px?: unknown } | null
  const width = typeof body?.width_px === 'number' && body.width_px > 0 && body.width_px < 100000 ? Math.round(body.width_px) : null
  const height = typeof body?.height_px === 'number' && body.height_px > 0 && body.height_px < 100000 ? Math.round(body.height_px) : null
  if (!width || !height) return NextResponse.json({ error: 'Invalid dimensions' }, { status: 400 })

  // Verify the caller can see this file under their company. Using the
  // user-session client here enforces RLS — if they can't SELECT, they
  // can't backfill, which is correct.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { data: file } = await supabase
    .from('files')
    .select('id, width_px, height_px')
    .eq('id', id)
    .eq('company_id', profile.company_id)
    .single()
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Already backfilled — no-op.
  if (file.width_px != null && file.height_px != null) {
    return NextResponse.json({ ok: true, already_set: true })
  }

  const admin = createAdminClient()
  await admin.from('files').update({ width_px: width, height_px: height }).eq('id', id)

  return NextResponse.json({ ok: true })
}
