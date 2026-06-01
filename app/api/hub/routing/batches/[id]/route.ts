import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Session 73.2 — single holding-area batch: delete (un-hold its stops) or mark
// a send channel complete. Both verify the batch belongs to the caller's company
// before mutating via the admin client.

async function resolveCompany(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) {
    return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) }
  }
  return { companyId: profile.company_id as string }
}

// DELETE — remove a batch. Its stops reappear on the live map/list client-side.
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const { companyId, error } = await resolveCompany(request)
  if (error) return error

  const admin = createAdminClient()
  const { error: delErr } = await admin
    .from('route_batches')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId)   // scope: can only delete own company's batches
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// PATCH — stamp a send channel as completed (non-destructive; batch stays).
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const { companyId, error } = await resolveCompany(request)
  if (error) return error

  let body: { channel?: string }
  try {
    body = (await request.json()) as { channel?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const updates: Record<string, string> = {}
  if (body.channel === 'jobber') updates.sent_to_jobber_at = new Date().toISOString()
  else if (body.channel === 'daily_log') updates.sent_to_daily_log_at = new Date().toISOString()
  else return NextResponse.json({ error: "channel must be 'jobber' or 'daily_log'" }, { status: 400 })

  const admin = createAdminClient()
  const { data, error: updErr } = await admin
    .from('route_batches')
    .update(updates)
    .eq('id', id)
    .eq('company_id', companyId)
    .select('*')
    .single()
  if (updErr || !data) {
    return NextResponse.json({ error: updErr?.message ?? 'Batch not found' }, { status: 500 })
  }
  return NextResponse.json({ batch: data })
}
