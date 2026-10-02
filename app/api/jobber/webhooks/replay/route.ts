import { NextRequest, NextResponse } from 'next/server'
import { processJobberWebhookEvent } from '@/lib/jobber-sync'

// POST /api/jobber/webhooks/replay  (x-cron-secret only — an operator tool)
//
// Re-run the mirror's handling of a Jobber event as if the webhook had just
// arrived, without touching the durable queue (so a prod drain can't race it and
// the code that runs is the code deployed HERE). Used Oct 2 2026 to replay
// JOB_UPDATE for every archived recurring job so their ghost visits are
// tombstoned (see syncVisitsForJob), and for any later "Jobber says X, the
// mirror says Y" investigation.
//
// body: { topic: 'JOB_UPDATE' | 'VISIT_UPDATE' | …, itemId: string, companyId?: string }
//   or  { topic, itemIds: string[], companyId? }  — up to 200, processed in order.

const FALLBACK_COMPANY_ID = process.env.JOBBER_COMPANY_ID || '00000000-0000-0000-0000-000000000002'
const TOPICS = new Set([
  'CLIENT_CREATE', 'CLIENT_UPDATE', 'JOB_CREATE', 'JOB_UPDATE', 'JOB_DESTROY',
  'VISIT_CREATE', 'VISIT_UPDATE', 'VISIT_COMPLETE', 'VISIT_DESTROY',
  'INVOICE_CREATE', 'INVOICE_UPDATE', 'INVOICE_DESTROY',
])

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = (await req.json().catch(() => ({}))) as { topic?: unknown; itemId?: unknown; itemIds?: unknown; companyId?: unknown }
  const topic = typeof body.topic === 'string' ? body.topic : ''
  if (!TOPICS.has(topic)) return NextResponse.json({ error: `topic must be one of ${[...TOPICS].join(', ')}` }, { status: 400 })
  const companyId = typeof body.companyId === 'string' && body.companyId ? body.companyId : FALLBACK_COMPANY_ID
  const ids = Array.isArray(body.itemIds)
    ? body.itemIds.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, 200)
    : typeof body.itemId === 'string' && body.itemId ? [body.itemId] : []
  if (ids.length === 0) return NextResponse.json({ error: 'itemId or itemIds required' }, { status: 400 })

  const results: { itemId: string; ok: boolean; error?: string }[] = []
  for (const itemId of ids) {
    try {
      await processJobberWebhookEvent({ topic, itemId, companyId, occurredAt: new Date().toISOString() })
      results.push({ itemId, ok: true })
    } catch (e) {
      results.push({ itemId, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return NextResponse.json({ ok: results.every(r => r.ok), processed: results.length, results })
}
