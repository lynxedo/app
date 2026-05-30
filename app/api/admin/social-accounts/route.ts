import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { buildMetaOAuthUrl } from '@/lib/meta-graph'

// GET  — list social accounts for the company
// POST — save a manually-entered account (for testing without OAuth)
export async function GET() {
  const check = await requireAdminArea('marketing')
  if (!check.ok || !check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('social_accounts')
    .select('id, platform, account_name, external_id, ig_user_id, active, token_expires_at, created_at')
    .eq('company_id', check.company_id)
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ accounts: data ?? [] })
}

// GET /api/admin/social-accounts?action=oauth_url — returns the Meta OAuth URL
export async function POST(request: Request) {
  const check = await requireAdminArea('marketing')
  if (!check.ok || !check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({})) as Record<string, unknown>

  if (body.action === 'oauth_url') {
    const appId = process.env.META_APP_ID
    if (!appId) return NextResponse.json({ error: 'META_APP_ID not configured' }, { status: 501 })
    const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/admin/social-accounts/meta-callback`
    const configId = process.env.META_OAUTH_CONFIG_ID
    return NextResponse.json({ url: buildMetaOAuthUrl(appId, callbackUrl, configId) })
  }

  // Manual account entry (for testing)
  const { platform, account_name, external_id, access_token, ig_user_id } = body as {
    platform?: string
    account_name?: string
    external_id?: string
    access_token?: string
    ig_user_id?: string
  }
  if (!platform || !account_name || !external_id || !access_token) {
    return NextResponse.json({ error: 'platform, account_name, external_id, access_token are required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('social_accounts')
    .insert({
      company_id: check.company_id,
      platform,
      account_name,
      external_id,
      access_token,
      ig_user_id: ig_user_id ?? null,
      active: true,
    })
    .select('id, platform, account_name, external_id, ig_user_id, active, token_expires_at, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ account: data }, { status: 201 })
}
