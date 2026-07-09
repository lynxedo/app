import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireBetaAccess } from '@/lib/beta-auth'
import { listAvailableBetaFeatures } from '@/lib/beta-flags'

// Per-feature beta feedback → a task on the Development board (board task ONLY,
// no Guardian DM / push — Ben's call). Reuses the /api/hub/feedback board-write
// pattern with the service-role admin client so any teammate can file to the
// private board. Same env-overridable board id as Report an Issue.
const FEEDBACK_BOARD_ID =
  process.env.HUB_FEEDBACK_BOARD_ID || 'e72a725b-3b1b-4741-b610-a6cd8763e399'

export async function POST(request: Request) {
  const gate = await requireBetaAccess()
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const raw = (await request.json().catch(() => null)) as {
    feature_key?: string
    message?: string
  } | null
  const message = (raw?.message ?? '').trim()
  if (!raw?.feature_key || !message)
    return NextResponse.json({ error: 'Please add your feedback.' }, { status: 400 })

  const admin = createAdminClient()
  const feature = (await listAvailableBetaFeatures(admin, gate.companyId)).find(
    (f) => f.key === raw.feature_key,
  )
  if (!feature) return NextResponse.json({ error: 'Unknown feature' }, { status: 404 })

  const { data: reporter } = await admin
    .from('hub_users')
    .select('display_name')
    .eq('id', gate.userId)
    .single()
  const reporterName = reporter?.display_name?.trim() || 'A teammate'

  // Task = one-line "Beta feedback: <feature>" for the board scan.
  const { data: item, error: itemErr } = await admin
    .from('board_items')
    .insert({
      board_id: FEEDBACK_BOARD_ID,
      company_id: gate.companyId,
      content: `🧪 Beta feedback: ${feature.label}`.slice(0, 500),
      priority: 'low',
      recurrence: 'none',
      created_by: gate.userId,
    })
    .select('id')
    .single<{ id: string }>()
  if (itemErr || !item) {
    console.error('[beta-feedback] board_items insert failed:', itemErr)
    return NextResponse.json({ error: 'Could not submit — please try again.' }, { status: 500 })
  }

  // Note = the feature + who + their write-up.
  await admin.from('board_item_comments').insert({
    board_item_id: item.id,
    company_id: gate.companyId,
    content: [`Beta feature: ${feature.label} (${feature.key})`, `From: ${reporterName}`, '', message].join('\n'),
    created_by: gate.userId,
  })

  return NextResponse.json({ ok: true, item_id: item.id }, { status: 201 })
}
