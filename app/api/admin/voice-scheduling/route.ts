import { NextRequest, NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getSchedulableServices,
  getSchedulingEnabled,
  sanitizeSchedulableService,
  type SchedulableServiceInput,
} from '@/lib/voice-scheduling'

// Admin editor for the AI Receptionist's Level 4 scheduling config: the
// per-company master switch (scheduling_enabled) + the list of schedulable
// services (one row per Jobber line item the owner turns on). Gated
// requireAdminArea('ai') to match the AI admin page + the sibling
// voice-receptionist-settings route; all reads/writes use the service-role
// admin client. Does not touch call behavior — the availability engine +
// Jobber writes are separate build increments.

export async function GET() {
  const auth = await requireAdminArea('ai')
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const admin = createAdminClient()
  const [scheduling_enabled, services] = await Promise.all([
    getSchedulingEnabled(admin, auth.company_id!),
    getSchedulableServices(admin, auth.company_id!),
  ])
  return NextResponse.json({ scheduling_enabled, services })
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdminArea('ai')
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const companyId = auth.company_id!
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const admin = createAdminClient()

  // Master switch — upsert onto the shared receptionist settings row.
  if ('scheduling_enabled' in body) {
    const { error } = await admin.from('voice_receptionist_settings').upsert(
      {
        company_id: companyId,
        scheduling_enabled: Boolean(body.scheduling_enabled),
        updated_at: new Date().toISOString(),
        updated_by: auth.user?.id ?? null,
      },
      { onConflict: 'company_id' },
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Services list — sanitize + dedupe by line item, upsert, then delete any the
  // owner removed. Deletes target ids (never string-matched names) so odd line
  // item names can't break the filter. No cross-row FKs → a partial failure is
  // recoverable by re-saving (same posture as the other config editors).
  if ('services' in body) {
    const raw: unknown[] = Array.isArray(body.services) ? body.services : []
    const seen = new Set<string>()
    const clean = raw
      .map((s, i) => sanitizeSchedulableService(s, companyId, i))
      .filter((s): s is SchedulableServiceInput => {
        if (!s) return false
        const key = s.line_item.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

    const { data: existing } = await admin
      .from('voice_scheduling_services')
      .select('id, line_item')
      .eq('company_id', companyId)

    if (clean.length > 0) {
      const { error: upErr } = await admin
        .from('voice_scheduling_services')
        .upsert(clean, { onConflict: 'company_id,line_item' })
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
    }

    const keep = new Set(clean.map((s) => s.line_item.toLowerCase()))
    const idsToDelete = ((existing as { id: string; line_item: string }[] | null) ?? [])
      .filter((r) => !keep.has((r.line_item ?? '').toLowerCase()))
      .map((r) => r.id)
    if (idsToDelete.length > 0) {
      const { error: delErr } = await admin
        .from('voice_scheduling_services')
        .delete()
        .in('id', idsToDelete)
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
    }
  }

  const [scheduling_enabled, services] = await Promise.all([
    getSchedulingEnabled(admin, companyId),
    getSchedulableServices(admin, companyId),
  ])
  return NextResponse.json({ scheduling_enabled, services })
}
