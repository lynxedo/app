import { NextResponse } from 'next/server'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { addDays, changeDate, todayLocal, type DraftChange } from '@/lib/dispatch'

// The unsent Dispatch draft — ONE draft for the company, across every day
// (Oct 20 2026: a stop dragged from Monday to Wednesday in Month view has to
// show as moved on both days, and Send to Jobber sends it from any view).
// Stored one row per landing day in dispatch_drafts (company, draft_date), but
// read and written as a whole. Saved on every move so closing the tab loses
// nothing; shared, so the next person sees "3 unsent changes — started by Ben".

const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/
const MAX_CHANGES = 300

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

export async function GET() {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const admin = createAdminClient()
  // Old leftovers (a draft for a day long past) are ignored, not deleted.
  const { data, error } = await admin.from('dispatch_drafts')
    .select('draft_date, changes, updated_by, updated_at')
    .eq('company_id', auth.companyId)
    .gte('draft_date', addDays(todayLocal(), -7))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = data ?? []
  const changes = rows.flatMap(r => (Array.isArray(r.changes) ? r.changes : []) as DraftChange[]).filter(validChange)
  const latest = rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0]
  let updatedByName: string | null = null
  if (latest?.updated_by) {
    const { data: hu } = await admin.from('hub_users').select('display_name').eq('id', latest.updated_by).maybeSingle()
    updatedByName = (hu?.display_name as string | undefined) ?? null
  }
  return NextResponse.json({
    changes,
    updatedByName,
    updatedAt: latest?.updated_at ?? null,
    mine: latest?.updated_by === auth.userId,
  })
}

export async function PUT(request: Request) {
  const auth = await requireCompany({ grant: 'can_access_routing' })
  if ('error' in auth) return auth.error
  const { companyId, userId } = auth

  const body = await request.json().catch(() => null) as { changes?: unknown[] } | null
  const changes = Array.isArray(body?.changes) ? body!.changes : []
  if (changes.length > MAX_CHANGES) return NextResponse.json({ error: 'Too many changes in one draft' }, { status: 400 })
  if (!changes.every(validChange)) return NextResponse.json({ error: 'A change in the draft is malformed' }, { status: 400 })

  const byDate = new Map<string, DraftChange[]>()
  for (const c of changes as DraftChange[]) byDate.set(changeDate(c), [...(byDate.get(changeDate(c)) ?? []), c])

  const admin = createAdminClient()
  const now = new Date().toISOString()
  // Replace the whole draft: drop days that no longer have changes, upsert the rest.
  const { data: existing } = await admin.from('dispatch_drafts').select('draft_date').eq('company_id', companyId)
  const stale = (existing ?? []).map(r => r.draft_date as string).filter(d => !byDate.has(d))
  if (stale.length) await admin.from('dispatch_drafts').delete().eq('company_id', companyId).in('draft_date', stale)
  if (byDate.size) {
    const { error } = await admin.from('dispatch_drafts').upsert(
      [...byDate.entries()].map(([d, list]) => ({
        company_id: companyId, draft_date: d, changes: list, created_by: userId, updated_by: userId, updated_at: now,
      })),
      { onConflict: 'company_id,draft_date' },
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
