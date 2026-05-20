import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyHubApiKey } from '@/lib/hub-api-key'

// PATCH /api/hub/social-queue/[id]/used
// Hub API key authenticated. Marks a file as consumed by the social poster.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyHubApiKey(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('hub_files')
    .update({ social_used_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', auth.context.companyId)
    .select('id, social_used_at')
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'File not found in this company' }, { status: 404 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, file: data })
}
