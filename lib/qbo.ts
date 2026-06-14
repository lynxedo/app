import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

const ALGORITHM = 'aes-256-cbc'

function getKey() {
  return Buffer.from(process.env.QBO_TOKEN_ENCRYPTION_KEY!, 'hex')
}

export function encrypt(text: string): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}

export function decrypt(data: string): string {
  const [ivHex, encHex] = data.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const encrypted = Buffer.from(encHex, 'hex')
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

function qboCredentials() {
  return Buffer.from(
    `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
  ).toString('base64')
}

export async function exchangeAuthCode(code: string): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
}> {
  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${qboCredentials()}`,
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.QBO_REDIRECT_URI!,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })
  const intuitTid = res.headers.get('intuit_tid')
  if (!res.ok) {
    const text = await res.text()
    console.error('QBO token exchange failed', { status: res.status, intuit_tid: intuitTid, error: text })
    throw new Error(`QBO token exchange failed: ${res.status}`)
  }
  return res.json()
}

export async function revokeToken(refreshToken: string): Promise<void> {
  const res = await fetch('https://developer.api.intuit.com/v2/oauth2/tokens/revoke', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${qboCredentials()}`,
    },
    body: new URLSearchParams({ token: refreshToken }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })
  const intuitTid = res.headers.get('intuit_tid')
  if (!res.ok) {
    console.error('QBO revoke failed', { status: res.status, intuit_tid: intuitTid })
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
}> {
  const credentials = Buffer.from(
    `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
  ).toString('base64')

  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })

  const intuitTid = res.headers.get('intuit_tid')

  if (!res.ok) {
    const text = await res.text()
    console.error('QBO token refresh failed', { status: res.status, intuit_tid: intuitTid, error: text })
    throw new Error(`Token refresh failed: ${res.status}`)
  }

  return res.json()
}

export async function getQBOToken(): Promise<{ accessToken: string; realmId: string }> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('qbo_tokens')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) throw new Error('No QBO tokens found. Connect QuickBooks first.')

  const expiresAt = new Date(data.expires_at).getTime()
  const now = Date.now()
  const SIXTY_SECONDS = 60 * 1000

  let accessToken = decrypt(data.access_token)

  // Auto-refresh if expiring within 60 seconds
  if (expiresAt - now < SIXTY_SECONDS) {
    const refreshToken = decrypt(data.refresh_token)
    const refreshed = await refreshAccessToken(refreshToken)

    const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
    await supabase
      .from('qbo_tokens')
      .update({
        access_token: encrypt(refreshed.access_token),
        refresh_token: encrypt(refreshed.refresh_token),
        expires_at: newExpiry,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.id)

    accessToken = refreshed.access_token
  }

  return { accessToken, realmId: data.realm_id }
}

export async function qboFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const { accessToken, realmId } = await getQBOToken()
  const base = 'https://quickbooks.api.intuit.com'
  const url = `${base}/v3/company/${realmId}${path}`

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(options.headers ?? {}),
    },
    next: { revalidate: 14400 },
    signal: options.signal ?? AbortSignal.timeout(15000),
  })

  const intuitTid = res.headers.get('intuit_tid')

  if (!res.ok) {
    const text = await res.text()
    console.error('QBO API error', { status: res.status, intuit_tid: intuitTid, path, error: text })
    throw new Error(`QBO API error ${res.status} on ${path} (intuit_tid: ${intuitTid})`)
  }

  return res
}
