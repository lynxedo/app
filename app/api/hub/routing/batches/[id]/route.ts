import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireCompany } from '@/lib/company-auth'

// Session 73.2 — single holding-area batch: delete (un-hold its stops) or mark
// a send channel complete. Both verify the batch belongs to the caller's company
// before mutating via the admin client.

// DELETE — remove a batch. Its stops reappear on the live map/list client-side.
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { companyId } = auth

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
  const auth = await requireCompany()
  if ('error' in auth) return auth.error
  const { companyId } = auth

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
