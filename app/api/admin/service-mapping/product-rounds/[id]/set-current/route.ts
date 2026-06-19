import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gateServiceMapping } from '@/lib/service-mapping-server'

export const dynamic = 'force-dynamic'

// POST { current: boolean } — mark this round as the program's active round
// (exclusive: at most one current per program — enforced by a partial unique
// index). We clear the whole program first, then set this one, so the index
// can't trip on a transient two-current state.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await gateServiceMapping()
  if ('error' in ctx) return ctx.error
  const { id } = await params

  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { /* empty body = set current */ }
  const makeCurrent = body.current === undefined ? true : !!body.current

  const admin = createAdminClient()

  // Find the round's program (and confirm it belongs to this company).
  const { data: round, error: findErr } = await admin
    .from('product_rounds')
    .select('id, program')
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .is('deleted_at', null)
    .single()
  if (findErr || !round) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Clear every round in this program first (covers "switch current" and "unset").
  const { error: clearErr } = await admin
    .from('product_rounds')
    .update({ is_current: false, updated_at: new Date().toISOString() })
    .eq('company_id', ctx.companyId)
    .eq('program', round.program)
    .is('deleted_at', null)
  if (clearErr) return NextResponse.json({ error: clearErr.message }, { status: 500 })

  if (makeCurrent) {
    const { error: setErr } = await admin
      .from('product_rounds')
      .update({ is_current: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .is('deleted_at', null)
    if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, program: round.program, current: makeCurrent ? id : null })
}
