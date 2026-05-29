import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exchangeForLongLivedToken } from '@/lib/meta-graph'

// POST /api/hub/social/refresh-tokens
// Weekly cron job — automatically renews Meta page tokens before they expire.
// Requires x-cron-secret header. Add to VPS crontab:
//   0 9 * * 1 curl -s -X POST https://lynxedo.com/api/hub/social/refresh-tokens -H "x-cron-secret: $CRON_SECRET" >/dev/null 2>&1
// (Mondays 9am UTC — well before any 60-day window closes)
export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) {
    return NextResponse.json({ error: 'META_APP_ID/SECRET not configured' }, { status: 501 })
  }

  const admin = createAdminClient()

  // Find active accounts with a stored user_token expiring within 45 days
  // (45-day window = refresh on the next weekly run well before 60-day expiry)
  const { data: accounts, error } = await admin
    .from('social_accounts')
    .select('id, company_id, external_id, account_name, user_token, token_expires_at')
    .not('user_token', 'is', null)
    .lt('token_expires_at', new Date(Date.now() + 45 * 86400000).toISOString())
    .eq('active', true)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ refreshed: 0, message: 'No tokens due for refresh' })
  }

  let refreshed = 0
  const failures: string[] = []

  for (const account of accounts) {
    if (!account.user_token) continue

    // Re-exchange the stored long-lived user token for another 60-day token
    const longResult = await exchangeForLongLivedToken({
      shortToken: account.user_token,
      appId,
      appSecret,
    })
    if ('error' in longResult) {
      failures.push(`${account.account_name}: ${longResult.error}`)
      continue
    }

    // Re-derive the page token
    const pageRes = await fetch(
      `https://graph.facebook.com/v19.0/${account.external_id}?fields=access_token&access_token=${longResult.token}`
    )
    const pageData = await pageRes.json() as Record<string, unknown>
    if (!pageRes.ok || pageData.error) {
      const msg = (pageData.error as { message?: string } | undefined)?.message ?? 'Failed to fetch page token'
      failures.push(`${account.account_name}: ${msg}`)
      continue
    }

    const expiresAt = new Date(Date.now() + longResult.expiresIn * 1000).toISOString()
    const { error: updateError } = await admin
      .from('social_accounts')
      .update({
        access_token: pageData.access_token as string,
        user_token: longResult.token,
        token_expires_at: expiresAt,
      })
      .eq('id', account.id)

    if (updateError) {
      failures.push(`${account.account_name}: DB update failed`)
    } else {
      refreshed++
    }
  }

  return NextResponse.json({ refreshed, failures, checked: accounts.length })
}
