import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkOrderStop } from '@/lib/work-order-access'
import { loadStopLineItems } from '@/lib/work-order-line-items'
import { suggestForStop } from '@/lib/work-order-suggestions'

// POST /api/hub/work-orders/stops/[id]/suggest — run the office's inspection
// rules against this stop's final irrigation inspection and add the matches as
// PROPOSED line items (the tech taps Add or ✕). Work Orders Phase 2, Part 2.

const MESSAGES: Record<string, string> = {
  no_inspection: 'No saved inspection on this stop yet — finish the inspection first.',
  no_rules: 'No inspection rules are set up yet (Work Orders → Office → Inspection rules).',
  no_matches: 'Nothing in the inspection matches a rule.',
  already_suggested: 'Everything the inspection matches has already been suggested.',
  locked: 'This stop is finished — reopen it to change line items.',
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const r = await resolveWorkOrderStop(id)
  if ('error' in r) return r.error
  const { admin, stop, companyId, userId } = r
  try {
    const res = await suggestForStop(admin, companyId, stop.id, userId)
    return NextResponse.json({
      added: res.added,
      message: res.reason === 'ok' ? null : MESSAGES[res.reason],
      items: await loadStopLineItems(admin, companyId, stop),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not suggest' }, { status: 500 })
  }
}
