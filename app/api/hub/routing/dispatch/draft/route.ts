import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { DraftChange } from '@/lib/dispatch'

// The unsent Dispatch draft for one day (one per company per day, shared — the
// screen shows "Ben has 3 unsent changes" to whoever else opens that day). Saved
// on every move so closing the tab loses nothing. Send to Jobber clears it.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/
const MAX_CHANGES = 200

function validChange(c: unknown): c is DraftChange {
  if (!c || typeof c !== 'object') return false
  const x = c as Record<string, unknown>
  return typeof x.id === 'string' && x.id.length > 0
    && ['visit', 'assessment', 'task'].includes(x.kind as string)
    && typeof x.toStart === 'string' && LOCAL_RE.test(x.toStart)
    && typeof x.toEnd === 'string' && LOCAL_RE.test(x.toEnd)
    && typeof x.toTechId === 'string' && x.toTechId.length > 0
    && Array.isArray(x.fromTechIds)
}

export async function PUT(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const { companyId, userId } = auth

  const body = await request.json().catch(() => null) as { date?: string; changes?: unknown[] } | null
  if (!body?.date || !DATE_RE.test(body.date)) return NextResponse.json({ error: 'date is required' }, { status: 400 })
  const changes = Array.isArray(body.changes) ? body.changes : []
  if (changes.length > MAX_CHANGES) return NextResponse.json({ error: 'Too many changes in one draft' }, { status: 400 })
  if (!changes.every(validChange)) return NextResponse.json({ error: 'A change in the draft is malformed' }, { status: 400 })

  const admin = createAdminClient()
  if (changes.length === 0) {
    await admin.from('dispatch_drafts').delete().eq('company_id', companyId).eq('draft_date', body.date)
    return NextResponse.json({ ok: true, cleared: true })
  }
  const now = new Date().toISOString()
  const { error } = await admin.from('dispatch_drafts').upsert({
    company_id: companyId,
    draft_date: body.date,
    changes,
    created_by: userId,
    updated_by: userId,
    updated_at: now,
  }, { onConflict: 'company_id,draft_date' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
