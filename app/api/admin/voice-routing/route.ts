import { NextRequest, NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getRoutingDirectory,
  normalizeTransferMissBehavior,
  sanitizeRoutingEntry,
  type RoutingEntryInput,
} from '@/lib/voice-routing'

// Admin editor for the AI Receptionist's Level 5 frontline routing: the
// per-company routing directory (who/what Amber can send callers to) plus two
// settings on the shared receptionist row — the AI-averse-escape ring group and
// the transfer-miss behavior. Gated requireAdminArea('ai') to match the AI admin
// page + the sibling voice-receptionist-settings / voice-scheduling routes; all
// reads/writes use the service-role admin client. Does not touch call behavior —
// the front-door branch + call-time routing are separate build increments and
// only fire at (not-yet-selectable) Level 5.

async function loadState(admin: ReturnType<typeof createAdminClient>, companyId: string) {
  // Return the directory + the two settings AND the destination catalogs (ring
  // groups + Hub users) so the RoutingPanel is fully self-contained and gated
  // purely on 'ai' — no cross-fetch to the dialer admin area.
  const [{ data: settingsRow }, directory, { data: ringGroups }, { data: users }] =
    await Promise.all([
      admin
        .from('voice_receptionist_settings')
        .select('escape_ring_group, transfer_miss_behavior')
        .eq('company_id', companyId)
        .maybeSingle(),
      getRoutingDirectory(admin, companyId),
      admin
        .from('dialer_ring_groups')
        .select('id, name')
        .eq('company_id', companyId)
        .order('name'),
      admin
        .from('user_profiles')
        .select('id, full_name, dialer_extension')
        .eq('company_id', companyId)
        .order('full_name'),
    ])
  return {
    escape_ring_group: (settingsRow?.escape_ring_group as string | null) ?? null,
    transfer_miss_behavior: normalizeTransferMissBehavior(settingsRow?.transfer_miss_behavior),
    directory,
    ring_groups: (ringGroups as { id: string; name: string }[] | null) ?? [],
    users:
      (users as { id: string; full_name: string | null; dialer_extension: string | null }[] | null) ??
      [],
  }
}

export async function GET() {
  const auth = await requireAdminArea('ai')
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const admin = createAdminClient()
  return NextResponse.json(await loadState(admin, auth.company_id!))
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdminArea('ai')
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const companyId = auth.company_id!
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const admin = createAdminClient()

  // Settings fields — upsert onto the shared receptionist settings row. Only
  // touch a field when it's present in the body (so a partial save can't blank
  // the other one). escape_ring_group: '' → null (bypass unavailable).
  const settingsPatch: Record<string, unknown> = {}
  if ('escape_ring_group' in body) {
    const v = typeof body.escape_ring_group === 'string' ? body.escape_ring_group.trim() : ''
    settingsPatch.escape_ring_group = v || null
  }
  if ('transfer_miss_behavior' in body) {
    settingsPatch.transfer_miss_behavior = normalizeTransferMissBehavior(body.transfer_miss_behavior)
  }
  if (Object.keys(settingsPatch).length > 0) {
    const { error } = await admin.from('voice_receptionist_settings').upsert(
      {
        company_id: companyId,
        ...settingsPatch,
        updated_at: new Date().toISOString(),
        updated_by: auth.user?.id ?? null,
      },
      { onConflict: 'company_id' },
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Directory — sanitize + dedupe by label, upsert, then delete any the owner
  // removed. Deletes target ids (never string-matched labels) so odd labels
  // can't break the filter. No cross-row FKs → a partial failure is recoverable
  // by re-saving (same posture as the scheduling editor).
  if ('directory' in body) {
    const raw: unknown[] = Array.isArray(body.directory) ? body.directory : []
    const seen = new Set<string>()
    const clean = raw
      .map((e, i) => sanitizeRoutingEntry(e, companyId, i))
      .filter((e): e is RoutingEntryInput => {
        if (!e) return false
        const key = e.label.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

    const { data: existing } = await admin
      .from('voice_routing_directory')
      .select('id, label')
      .eq('company_id', companyId)

    if (clean.length > 0) {
      const { error: upErr } = await admin
        .from('voice_routing_directory')
        .upsert(clean, { onConflict: 'company_id,label' })
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
    }

    const keep = new Set(clean.map((e) => e.label.toLowerCase()))
    const idsToDelete = ((existing as { id: string; label: string }[] | null) ?? [])
      .filter((r) => !keep.has((r.label ?? '').toLowerCase()))
      .map((r) => r.id)
    if (idsToDelete.length > 0) {
      const { error: delErr } = await admin
        .from('voice_routing_directory')
        .delete()
        .in('id', idsToDelete)
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
    }
  }

  const admin2 = createAdminClient()
  return NextResponse.json(await loadState(admin2, companyId))
}
