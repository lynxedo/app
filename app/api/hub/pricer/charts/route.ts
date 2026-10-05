import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadLivePrograms, type LiveProgram } from '@/lib/pricer-charts'

export const dynamic = 'force-dynamic'

// GET /api/hub/pricer/charts
// Returns the live program price charts for the staff Pricer (/hub/pricer).
// Read rule (Master PRD §8.5 / Session 5): for each program_key, the PUBLISHED
// version with the latest effective_from that is <= today. Drafts/archived never
// surface; a future-dated published version waits until its date. A null
// effective_from is treated as "always effective". Gated to admins OR
// can_access_pricer. Presentation (category + sort_order) lives on the chart row.

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, role, can_access_pricer')
    .eq('id', user.id)
    .single()
  if (!profile?.company_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  if (profile.role !== 'admin' && !profile.can_access_pricer) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let programs: LiveProgram[]
  try {
    programs = await loadLivePrograms(supabase, profile.company_id)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load price charts' }, { status: 500 })
  }

  const res = NextResponse.json({ programs })
  // Published charts change only when an admin republishes — let the browser
  // reuse a recent response for 5 min.
  res.headers.set('Cache-Control', 'private, max-age=300')
  return res
}
