import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminArea } from '@/lib/admin-auth'
import { exchangeForLongLivedToken } from '@/lib/meta-graph'

// POST /api/admin/social-accounts/[id]/refresh-token
// Accepts a short-lived user token from Graph API Explorer,
// exchanges it for a 60-day long-lived token, re-derives the page token,
// and saves both to the DB so auto-refresh can keep rolling it forward.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = await requireAdminArea('marketing')
  if (!check.ok || !check.company_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const userToken = typeof body.userToken === 'string' ? body.userToken.trim() : ''

  if (!userToken) return NextResponse.json({ error: 'userToken is required' }, { status: 400 })

  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) return NextResponse.json({ error: 'META_APP_ID/SECRET not configured' }, { status: 501 })

  const admin = createAdminClient()
  const { data: account } = await admin
    .from('social_accounts')
    .select('id, external_id')
    .eq('id', id)
    .eq('company_id', check.company_id)
    .single()

  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  // Exchange the user token for a 60-day long-lived user token
  const longResult = await exchangeForLongLivedToken({ shortToken: userToken, appId, appSecret })
  if ('error' in longResult) return NextResponse.json({ error: longResult.error }, { status: 400 })

  // Derive the page access token from the long-lived user token
  const pageRes = await fetch(
    `https://graph.facebook.com/v19.0/${account.external_id}?fields=id,name,access_token&access_token=${longResult.token}`
  )
  const pageData = await pageRes.json() as Record<string, unknown>
  if (!pageRes.ok || pageData.error) {
    const msg = (pageData.error as { message?: string } | undefined)?.message ?? 'Failed to fetch page token'
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const pageToken = pageData.access_token as string
  const expiresAt = new Date(Date.now() + longResult.expiresIn * 1000).toISOString()

  const { data: updated, error } = await admin
    .from('social_accounts')
    .update({
      access_token: pageToken,
      user_token: longResult.token,
      token_expires_at: expiresAt,
    })
    .eq('id', id)
    .eq('company_id', check.company_id)
    .select('id, platform, account_name, external_id, ig_user_id, active, token_expires_at, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ account: updated })
}
