import { NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { normaliseJobberApp } from '@/lib/jobber-apps'
import { recordJobberDisconnect, revokeJobberGrant } from '@/lib/jobber-disconnect'

/**
 * POST /api/auth/jobber/disconnect
 * Disconnects the CALLER'S COMPANY from Jobber.
 *
 * Jobber is a company-level integration (one jobber_tokens row per company), so
 * this removes the company's connection, not just the caller's.
 *
 * Servanto Starter Session 2: it now also tells Jobber to drop the grant
 * (appDisconnect, best effort) and records the disconnect, which for a
 * Servanto-app company schedules the deletion of its copied Jobber data in 30
 * days (lib/jobber-disconnect.ts). Heroes' data is never scheduled for deletion.
 *
 * Gated to integration admins to match the Admin → Integrations page.
 */
export async function POST() {
  const check = await requireAdminArea('integrations')
  if (!check.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!check.company_id) return NextResponse.json({ error: 'No company' }, { status: 403 })

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('jobber_tokens')
    .select('jobber_app, account_id')
    .eq('company_id', check.company_id)
    .maybeSingle()
  if (!row) return NextResponse.json({ ok: true, purgeAfter: null })

  await revokeJobberGrant(check.company_id)

  const res = await recordJobberDisconnect({
    companyId: check.company_id,
    app: normaliseJobberApp(row.jobber_app),
    accountId: row.account_id,
    source: 'servanto_button',
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 })

  return NextResponse.json({ ok: true, purgeAfter: res.purgeAfter })
}
