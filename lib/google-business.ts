// Google Business Profile API helpers — OAuth + post publishing.
// Three Google APIs are involved:
//   1. https://oauth2.googleapis.com/token             — token exchange
//   2. https://mybusinessaccountmanagement.googleapis.com/v1/accounts             — list accounts
//   3. https://mybusinessbusinessinformation.googleapis.com/v1/{account}/locations — list locations
//   4. https://mybusiness.googleapis.com/v4/{account}/locations/{loc}/localPosts   — publish a post (v4, still active)

const SCOPE = 'https://www.googleapis.com/auth/business.manage'

// ---------------------------------------------------------------------------
// OAuth helpers
// ---------------------------------------------------------------------------

export function buildGoogleOAuthUrl(clientId: string, callbackUrl: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function exchangeCodeForRefreshToken(opts: {
  code: string
  clientId: string
  clientSecret: string
  callbackUrl: string
}): Promise<{ refreshToken: string; accessToken: string; expiresIn: number } | { error: string }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.callbackUrl,
      grant_type: 'authorization_code',
    }),
  })
  const data = await res.json() as Record<string, unknown>
  if (!res.ok || data.error) {
    const msg = (data.error_description as string | undefined) ?? (data.error as string | undefined) ?? `HTTP ${res.status}`
    return { error: msg }
  }
  const refreshToken = data.refresh_token as string | undefined
  if (!refreshToken) return { error: 'Google did not return a refresh_token. Try disconnecting the app at myaccount.google.com/permissions and reconnecting.' }
  return {
    refreshToken,
    accessToken: data.access_token as string,
    expiresIn: (data.expires_in as number) ?? 3600,
  }
}

export async function exchangeRefreshTokenForAccessToken(opts: {
  refreshToken: string
  clientId: string
  clientSecret: string
}): Promise<{ accessToken: string; expiresIn: number } | { error: string }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      refresh_token: opts.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json() as Record<string, unknown>
  if (!res.ok || data.error) {
    const msg = (data.error_description as string | undefined) ?? (data.error as string | undefined) ?? `HTTP ${res.status}`
    return { error: msg }
  }
  return {
    accessToken: data.access_token as string,
    expiresIn: (data.expires_in as number) ?? 3600,
  }
}

// ---------------------------------------------------------------------------
// Account + Location discovery
// ---------------------------------------------------------------------------

export type GbpAccountLocation = {
  accountId: string         // numeric — e.g. "123456789012345"
  accountName: string       // human label — e.g. "Heroes Lawn Care"
  locationId: string        // numeric — e.g. "987654321098765"
  locationTitle: string     // store name — e.g. "Heroes Lawn Care of The Woodlands"
}

// Fetches the first account + first location the user owns/manages. GBP API
// often returns one of each for small businesses; if the user has multiple,
// they'll need to pick one (future enhancement — for now we just take the first).
export async function fetchFirstAccountAndLocation(accessToken: string): Promise<GbpAccountLocation | { error: string }> {
  // 1. List accounts
  const accRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const accData = await accRes.json() as {
    accounts?: Array<{ name: string; accountName?: string }>
    error?: { message: string; status?: string }
  }
  if (!accRes.ok || accData.error) {
    const msg = accData.error?.message ?? `HTTP ${accRes.status}`
    const hint = msg.toLowerCase().includes('not been used') || msg.toLowerCase().includes('disabled')
      ? ' — enable the Business Profile APIs in Google Cloud Console for your project'
      : ''
    return { error: `Accounts fetch failed: ${msg}${hint}` }
  }
  const firstAccount = accData.accounts?.[0]
  if (!firstAccount) return { error: 'No Google Business accounts found for this Google user' }

  const accountId = firstAccount.name.replace(/^accounts\//, '')

  // 2. List locations for that account. Business Information API requires readMask.
  const locUrl = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${accountId}/locations`)
  locUrl.searchParams.set('readMask', 'name,title')
  const locRes = await fetch(locUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const locData = await locRes.json() as {
    locations?: Array<{ name: string; title?: string }>
    error?: { message: string }
  }
  if (!locRes.ok || locData.error) {
    return { error: `Locations fetch failed: ${locData.error?.message ?? `HTTP ${locRes.status}`}` }
  }
  const firstLocation = locData.locations?.[0]
  if (!firstLocation) return { error: 'No locations found under this Google Business account' }

  const locationId = firstLocation.name.replace(/^locations\//, '')

  return {
    accountId,
    accountName: firstAccount.accountName ?? `Account ${accountId}`,
    locationId,
    locationTitle: firstLocation.title ?? `Location ${locationId}`,
  }
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

// Publishes a "What's New" local post on the given GBP location. Returns the
// resulting post name on success ("accounts/123/locations/456/localPosts/789").
// Note: GBP posts expire after 7 days and disappear from the profile.
export async function publishGoogleBusinessPost(opts: {
  accessToken: string
  accountId: string
  locationId: string
  caption: string
  imageUrl?: string
}): Promise<{ postId: string } | { error: string }> {
  const { accessToken, accountId, locationId, caption, imageUrl } = opts

  const body: Record<string, unknown> = {
    languageCode: 'en-US',
    summary: caption,
    topicType: 'STANDARD', // What's New
  }
  if (imageUrl) {
    body.media = [{ mediaFormat: 'PHOTO', sourceUrl: imageUrl }]
  }

  const url = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/localPosts`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json() as Record<string, unknown>
  // DEBUG — log full Google response so we can diagnose publish issues
  console.log('[GBP publish] status:', res.status, 'body:', JSON.stringify(data))
  if (!res.ok || data.error) {
    const errObj = data.error as { message?: string; status?: string } | undefined
    const raw = errObj?.message ?? `HTTP ${res.status}`
    const hint = /verif/i.test(raw)
      ? ' — your Business Profile may need to be verified in Google Cloud Console before posts can be created'
      : ''
    return { error: `${raw}${hint}` }
  }
  return { postId: (data.name as string) ?? '' }
}
