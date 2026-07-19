import { NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/auth/jobber/disconnect
 * Disconnects the CALLER'S COMPANY from Jobber by deleting every jobber_tokens
 * row for that company — not just the caller's own row.
 *
 * Jobber is a company-level integration (any admin's token serves the whole
 * company), so the old per-user delete left other admins' rows behind: the
 * Integrations card kept reading "connected" and could never be reset, even
 * after the tokens went dead. Service-role client because we delete rows owned
 * by other users in the company (RLS would block that from a user client).
 *
 * Gated to integration admins to match the Admin → Integrations page. Jobber
 * exposes no token-revocation endpoint, so deleting our copy is all we can do;
 * the OAuth grant on Jobber's side is unusable without our refresh token, and a
 * Reconnect issues a fresh grant.
 */
export async function POST() {
  const check = await requireAdminArea('integrations')
  if (!check.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!check.company_id) return NextResponse.json({ error: 'No company' }, { status: 403 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('jobber_tokens')
    .delete()
    .eq('company_id', check.company_id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
