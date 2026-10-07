import { createAdminClient } from '@/lib/supabase/admin'
import { enrollLeadInStageCampaigns, exitEnrollmentsForLead } from '@/lib/drip'

// Move a Lead Tracker card to the company's stage for a pipeline role — the
// same effects as dragging it there (PATCH /api/tracker/leads/[id]): stamps
// stage_changed_at, enrolls stage-triggered drips, and a Won/Lost stage exits
// any active drip. Used by Quotes (Phase 4, session 5): sent → 'quoted',
// approved → 'won'.
//
// Forward only: a card already in a later role (or in a stage with no role
// the caller lists as movable) is left where it is, so a quote never drags a
// won or lost lead backwards. A company with no stage marked for the role
// (Tracker settings → stage → pipeline role) moves nothing.

type Admin = ReturnType<typeof createAdminClient>
type Role = 'new' | 'responded' | 'quoted' | 'won' | 'lost'

const MOVABLE_FROM: Record<'quoted' | 'won', (Role | null)[]> = {
  quoted: [null, 'new', 'responded'],
  won: [null, 'new', 'responded', 'quoted'],
}

export async function moveLeadToRole(admin: Admin, companyId: string, leadId: string, role: 'quoted' | 'won'): Promise<{ moved: boolean; stage?: string; reason?: string }> {
  try {
    const { data: stages } = await admin.from('tracker_stages').select('key, label, system_role, sort_order').eq('company_id', companyId).order('sort_order')
    const target = (stages ?? []).find(s => s.system_role === role)
    if (!target) return { moved: false, reason: `no stage is marked “${role}”` }
    const { data: lead } = await admin.from('leads').select('id, stage').eq('company_id', companyId).eq('id', leadId).maybeSingle()
    if (!lead) return { moved: false, reason: 'lead not found' }
    if (lead.stage === target.key) return { moved: false, reason: 'already there' }
    const current = (stages ?? []).find(s => s.key === lead.stage)
    const currentRole = (current?.system_role ?? null) as Role | null
    if (!MOVABLE_FROM[role].includes(currentRole)) return { moved: false, reason: `card is already ${currentRole}` }

    const { error } = await admin.from('leads').update({ stage: target.key, stage_changed_at: new Date().toISOString() }).eq('id', leadId).eq('company_id', companyId)
    if (error) return { moved: false, reason: error.message }
    try {
      await enrollLeadInStageCampaigns(admin, { companyId, leadId, stageKey: target.key as string })
      if (role === 'won') await exitEnrollmentsForLead(admin, { companyId, leadId })
    } catch (err) {
      console.warn('[lead-stage] drip stage-trigger failed', err)
    }
    return { moved: true, stage: target.label as string }
  } catch (err) {
    console.warn('[lead-stage] move failed', err)
    return { moved: false, reason: 'error' }
  }
}
