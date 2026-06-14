// Meta Graph API v19.0 helpers for Facebook and Instagram publishing.
const BASE = 'https://graph.facebook.com/v19.0'

// ---------------------------------------------------------------------------
// OAuth helpers
// ---------------------------------------------------------------------------

export function buildMetaOAuthUrl(appId: string, callbackUrl: string, configId?: string): string {
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: callbackUrl,
    response_type: 'code',
  })
  if (configId) {
    params.set('config_id', configId)
  } else {
    params.set('scope', [
      'pages_manage_posts',
      'pages_read_engagement',
      'pages_show_list',
      'instagram_basic',
      'instagram_content_publish',
    ].join(','))
  }
  return `https://www.facebook.com/v19.0/dialog/oauth?${params}`
}

export async function exchangeCodeForUserToken(opts: {
  code: string
  appId: string
  appSecret: string
  callbackUrl: string
}): Promise<{ token: string } | { error: string }> {
  const params = new URLSearchParams({
    client_id: opts.appId,
    redirect_uri: opts.callbackUrl,
    client_secret: opts.appSecret,
    code: opts.code,
  })
  const res = await fetch(`${BASE}/oauth/access_token?${params}`)
  const data = await res.json() as Record<string, unknown>
  if (!res.ok || data.error) {
    const msg = (data.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`
    return { error: msg }
  }
  return { token: data.access_token as string }
}

export async function exchangeForLongLivedToken(opts: {
  shortToken: string
  appId: string
  appSecret: string
}): Promise<{ token: string; expiresIn: number } | { error: string }> {
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: opts.appId,
    client_secret: opts.appSecret,
    fb_exchange_token: opts.shortToken,
  })
  const res = await fetch(`${BASE}/oauth/access_token?${params}`)
  const data = await res.json() as Record<string, unknown>
  if (!res.ok || data.error) {
    const msg = (data.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`
    return { error: msg }
  }
  return { token: data.access_token as string, expiresIn: (data.expires_in as number) ?? 5184000 }
}

export type MetaPageInfo = {
  id: string
  name: string
  access_token: string
  ig_user_id: string | null
}

export async function fetchPagesWithIg(userToken: string): Promise<MetaPageInfo[] | { error: string }> {
  const res = await fetch(
    `${BASE}/me/accounts?access_token=${userToken}&fields=id,name,access_token`
  )
  const data = await res.json() as {
    data?: Array<{ id: string; name: string; access_token: string }>
    error?: { message: string }
  }
  if (!res.ok || data.error) {
    return { error: data.error?.message ?? 'Failed to fetch pages' }
  }

  const pages: MetaPageInfo[] = []
  for (const page of data.data ?? []) {
    const igRes = await fetch(
      `${BASE}/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`
    )
    const igData = await igRes.json() as { instagram_business_account?: { id: string } }
    pages.push({
      id: page.id,
      name: page.name,
      access_token: page.access_token,
      ig_user_id: igData.instagram_business_account?.id ?? null,
    })
  }
  return pages
}

// ---------------------------------------------------------------------------
// Publishing helpers
// ---------------------------------------------------------------------------

export async function publishFacebookPost(opts: {
  pageId: string
  accessToken: string
  caption: string
  imageUrl?: string
}): Promise<{ postId: string } | { error: string }> {
  const { pageId, accessToken, caption, imageUrl } = opts
  const endpoint = imageUrl ? `${BASE}/${pageId}/photos` : `${BASE}/${pageId}/feed`
  const body = imageUrl
    ? { url: imageUrl, caption, access_token: accessToken }
    : { message: caption, access_token: accessToken }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json() as Record<string, unknown>
  if (!res.ok || data.error) {
    const msg = (data.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`
    return { error: msg }
  }
  return { postId: ((data.id ?? data.post_id) as string) ?? '' }
}

/**
 * Poll an Instagram media container until it finishes processing (MSC-IGstatus).
 * Meta uploads the image asynchronously; calling media_publish before the container
 * reports status_code=FINISHED intermittently fails on larger photos. We wait up to
 * ~20s (10 × 2s) and surface ERROR/EXPIRED/timeout as a clean error.
 */
async function waitForIgContainerReady(
  creationId: string,
  accessToken: string,
  attempts = 10,
  delayMs = 2000,
): Promise<{ ok: true } | { error: string }> {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${BASE}/${creationId}?fields=status_code&access_token=${accessToken}`)
    const data = await res.json() as { status_code?: string; error?: { message?: string } }
    if (!res.ok || data.error) {
      const msg = data.error?.message ?? `HTTP ${res.status}`
      return { error: `IG container status check failed: ${msg}` }
    }
    if (data.status_code === 'FINISHED') return { ok: true }
    if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') {
      return { error: `IG image processing ${data.status_code.toLowerCase()}. Please try again.` }
    }
    // IN_PROGRESS — wait and re-check.
    await new Promise(r => setTimeout(r, delayMs))
  }
  return { error: 'IG image processing timed out. Please try again.' }
}

export async function publishInstagramPost(opts: {
  igUserId: string
  accessToken: string
  caption: string
  imageUrl: string
}): Promise<{ postId: string } | { error: string }> {
  const { igUserId, accessToken, caption, imageUrl } = opts

  const containerRes = await fetch(`${BASE}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: accessToken }),
  })
  const containerData = await containerRes.json() as Record<string, unknown>
  if (!containerRes.ok || containerData.error) {
    const msg = (containerData.error as { message?: string } | undefined)?.message ?? `HTTP ${containerRes.status}`
    return { error: `IG container create failed: ${msg}` }
  }
  const creationId = containerData.id as string | undefined
  if (!creationId) return { error: 'IG container create returned no id' }

  // Wait for Meta to finish processing the image before publishing (MSC-IGstatus).
  const ready = await waitForIgContainerReady(creationId, accessToken)
  if ('error' in ready) return ready

  const publishRes = await fetch(`${BASE}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
  })
  const publishData = await publishRes.json() as Record<string, unknown>
  if (!publishRes.ok || publishData.error) {
    const msg = (publishData.error as { message?: string } | undefined)?.message ?? `HTTP ${publishRes.status}`
    return { error: `IG publish failed: ${msg}` }
  }
  return { postId: (publishData.id as string) ?? '' }
}
